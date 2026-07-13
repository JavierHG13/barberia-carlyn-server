import { pool } from '../config/database.js';

const PRODUCT_SELECT = `
  id,
  nombre,
  descripcion,
  sku,
  categoria,
  precio,
  stock,
  stock_minimo,
  activo,
  created_at,
  updated_at
`;

const PRODUCT_UPDATE_MAP = {
  nombre: 'nombre',
  descripcion: 'descripcion',
  sku: 'sku',
  categoria: 'categoria',
  precio: 'precio',
  stock: 'stock',
  stockMinimo: 'stock_minimo',
  activo: 'activo',
};

const buildWhereClause = ({ q, categoria, activo }, startIndex = 1) => {
  const conditions = [];
  const values = [];
  let index = startIndex;

  if (q) {
    conditions.push(`(nombre ILIKE $${index} OR COALESCE(sku, '') ILIKE $${index})`);
    values.push(`%${q}%`);
    index += 1;
  }

  if (categoria) {
    conditions.push(`categoria ILIKE $${index}`);
    values.push(`%${categoria}%`);
    index += 1;
  }

  if (activo !== undefined && activo !== null) {
    conditions.push(`activo = $${index}`);
    values.push(activo);
    index += 1;
  }

  return {
    whereClause: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    values,
    nextIndex: index,
  };
};

class Product {
  static async create({ nombre, descripcion, sku, categoria, precio, stock, stockMinimo, activo }) {
    const result = await pool.query(
      `INSERT INTO tbl_productos
        (nombre, descripcion, sku, categoria, precio, stock, stock_minimo, activo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING ${PRODUCT_SELECT}`,
      [
        nombre,
        descripcion || null,
        sku || null,
        categoria || null,
        precio,
        stock,
        stockMinimo,
        activo,
      ]
    );

    return result.rows[0];
  }

  static async findById(id) {
    const result = await pool.query(
      `SELECT ${PRODUCT_SELECT}
       FROM tbl_productos
       WHERE id = $1`,
      [id]
    );

    return result.rows[0];
  }

  static async findAll({ q = '', categoria = '', activo = null, limit = 10, offset = 0 }) {
    const filters = buildWhereClause({ q, categoria, activo });

    const values = [...filters.values, limit, offset];
    const limitIndex = filters.nextIndex;
    const offsetIndex = filters.nextIndex + 1;

    const result = await pool.query(
      `SELECT ${PRODUCT_SELECT}
       FROM tbl_productos
       ${filters.whereClause}
       ORDER BY created_at DESC
       LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
      values
    );

    return result.rows;
  }

  static async countAll({ q = '', categoria = '', activo = null }) {
    const filters = buildWhereClause({ q, categoria, activo });

    const result = await pool.query(
      `SELECT COUNT(*)::INT AS total
       FROM tbl_productos
       ${filters.whereClause}`,
      filters.values
    );

    return result.rows[0].total;
  }

  static async updateById(id, updates) {
    const fields = [];
    const values = [];
    let index = 1;

    for (const [key, value] of Object.entries(updates)) {
      if (!(key in PRODUCT_UPDATE_MAP)) {
        continue;
      }

      fields.push(`${PRODUCT_UPDATE_MAP[key]} = $${index}`);
      values.push(value);
      index += 1;
    }

    if (fields.length === 0) {
      return this.findById(id);
    }

    fields.push('updated_at = NOW()');
    values.push(id);

    const result = await pool.query(
      `UPDATE tbl_productos
       SET ${fields.join(', ')}
       WHERE id = $${index}
       RETURNING ${PRODUCT_SELECT}`,
      values
    );

    return result.rows[0];
  }

  static async deleteById(id) {
    const result = await pool.query(
      'DELETE FROM tbl_productos WHERE id = $1 RETURNING id',
      [id]
    );

    return result.rows[0];
  }

  // ─── CSV / Import ──────────────────────────────────────────────────────────

  /**
   * Devuelve TODOS los productos que coincidan con los filtros,
   * sin paginación, para construir el CSV.
   */
  static async exportAll({ q = '', categoria = '', activo = null } = {}) {
    const filters = buildWhereClause({ q, categoria, activo });

    const result = await pool.query(
      `SELECT ${PRODUCT_SELECT}
       FROM tbl_productos
       ${filters.whereClause}
       ORDER BY id ASC`,
      filters.values
    );

    return result.rows;
  }

  /**
   * Busca un producto por SKU exacto (case-insensitive).
   */
  static async findBySku(sku) {
    const result = await pool.query(
      `SELECT ${PRODUCT_SELECT}
       FROM tbl_productos
       WHERE LOWER(sku) = LOWER($1)
       LIMIT 1`,
      [sku]
    );
    return result.rows[0] ?? null;
  }

  /**
   * Busca un producto por nombre exacto (case-insensitive).
   */
  static async findByNombre(nombre) {
    const result = await pool.query(
      `SELECT ${PRODUCT_SELECT}
       FROM tbl_productos
       WHERE LOWER(nombre) = LOWER($1)
       LIMIT 1`,
      [nombre]
    );
    return result.rows[0] ?? null;
  }

  /**
   * Procesa un array de filas CSV ya validadas.
   *
   * Prioridad de búsqueda por fila:
   *  1. Si la fila trae SKU  → busca primero por SKU.
   *  2. Si no hay SKU o no coincide → busca por nombre (LOWER match).
   *  3. Si no existe por ninguna clave → INSERT.
   *  4. Si existe y hay cambios en sku, precio, descripcion, categoria,
   *     stock, stock_minimo o activo → UPDATE solo esos campos.
   *  5. Si existe y no hay cambios → se omite (skipped++).
   *
   * Todo ocurre en una transacción. Los errores por fila se capturan
   * individualmente para no abortar el resto.
   *
   * @param {object[]} rows
   * @returns {{ created, updated, skipped, changes, errors }}
   */
  static async bulkUpsert(rows) {
    const client = await pool.connect();
    let created = 0;
    let updated = 0;
    let skipped = 0;
    const changes = [];
    const errors  = [];

    // Campos a comparar: incluye sku
    const COMPARABLE_FIELDS = [
      { key: 'sku',         col: 'sku',          parse: (v) => v ?? null       },
      { key: 'precio',      col: 'precio',        parse: (v) => parseFloat(v)  },
      { key: 'descripcion', col: 'descripcion',   parse: (v) => v ?? null      },
      { key: 'categoria',   col: 'categoria',     parse: (v) => v ?? null      },
      { key: 'stock',       col: 'stock',         parse: (v) => parseInt(v, 10)},
      { key: 'stockMinimo', col: 'stock_minimo',  parse: (v) => parseInt(v, 10)},
      { key: 'activo',      col: 'activo',        parse: (v) => v              },
    ];

    const COL_MAP = {
      sku:         'sku',
      precio:      'precio',
      descripcion: 'descripcion',
      categoria:   'categoria',
      stock:       'stock',
      stock_minimo:'stock_minimo',
      activo:      'activo',
    };

    try {
      await client.query('BEGIN');

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        try {
          // ── 1. Buscar producto existente: primero por SKU, luego por nombre ──
          let existingRow = null;
          let matchedBy   = null;

          if (row.sku) {
            const res = await client.query(
              `SELECT ${PRODUCT_SELECT} FROM tbl_productos WHERE LOWER(sku) = LOWER($1) LIMIT 1`,
              [row.sku]
            );
            if (res.rows[0]) { existingRow = res.rows[0]; matchedBy = 'sku'; }
          }

          if (!existingRow) {
            const res = await client.query(
              `SELECT ${PRODUCT_SELECT} FROM tbl_productos WHERE LOWER(nombre) = LOWER($1) LIMIT 1`,
              [row.nombre]
            );
            if (res.rows[0]) { existingRow = res.rows[0]; matchedBy = 'nombre'; }
          }

          if (!existingRow) {
            // ── INSERT ────────────────────────────────────────────────────────
            await client.query(
              `INSERT INTO tbl_productos
                 (nombre, descripcion, sku, categoria, precio, stock, stock_minimo, activo)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
              [
                row.nombre,
                row.descripcion ?? null,
                row.sku         ?? null,
                row.categoria   ?? null,
                row.precio,
                row.stock,
                row.stockMinimo,
                row.activo,
              ]
            );
            created += 1;
          } else {
            // ── Detectar cambios ──────────────────────────────────────────────
            const current    = existingRow;
            const diff       = {};
            const diffLabels = [];

            for (const field of COMPARABLE_FIELDS) {
              const incomingVal = field.parse(row[field.key]);
              const currentVal  = field.parse(current[field.col]);

              const hasChanged = typeof incomingVal === 'number'
                ? Math.abs(incomingVal - currentVal) > 0.001
                : String(incomingVal ?? '') !== String(currentVal ?? '');

              if (hasChanged) {
                diff[field.col] = { from: currentVal, to: incomingVal };
                diffLabels.push(field.col);
              }
            }

            if (Object.keys(diff).length === 0) {
              skipped += 1;
              continue;
            }

            // ── UPDATE solo campos que cambiaron ─────────────────────────────
            const setClauses = [];
            const vals       = [];
            let   idx        = 1;

            for (const [col, { to }] of Object.entries(diff)) {
              setClauses.push(`${COL_MAP[col]} = $${idx++}`);
              vals.push(to);
            }
            setClauses.push(`updated_at = NOW()`);
            vals.push(current.id);

            await client.query(
              `UPDATE tbl_productos SET ${setClauses.join(', ')} WHERE id = $${idx}`,
              vals
            );

            updated += 1;
            changes.push({
              id:         current.id,
              nombre:     current.nombre,
              matchedBy,
              cambios:    diffLabels,
              detalle:    diff,
            });
          }
        } catch (rowError) {
          errors.push({ fila: i + 2, nombre: row.nombre, sku: row.sku || '—', error: rowError.message });
        }
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    return { created, updated, skipped, changes, errors };
  }
}

export default Product;