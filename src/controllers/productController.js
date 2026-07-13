import Product from '../models/product.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const parsePositiveInt = (value) => {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return null;
  return parsed;
};

const parseBoolean = (value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true')  return true;
    if (value.toLowerCase() === 'false') return false;
  }
  return null;
};

const parseMoney = (value) => {
  const parsed = Number.parseFloat(value);
  return Number.isNaN(parsed) ? null : parsed;
};

const parseStock = (value) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
};

// ─── CSV helpers ──────────────────────────────────────────────────────────────

// Deduplicación: primero por SKU (si viene), luego por nombre
const IMPORT_REQUIRED = ['nombre', 'precio'];
const IMPORT_COLUMNS  = ['nombre', 'descripcion', 'sku', 'categoria', 'precio', 'stock', 'stock_minimo', 'activo'];

// Columnas que se exportan al CSV (sin id, created_at, updated_at)
// Cada entrada: { col: nombre en BD, label: cabecera en CSV }
const CSV_EXPORT_FIELDS = [
  { col: 'nombre',       label: 'NOMBRE'       },
  { col: 'descripcion',  label: 'DESCRIPCION'  },
  { col: 'sku',          label: 'SKU'          },
  { col: 'categoria',    label: 'CATEGORIA'    },
  { col: 'precio',       label: 'PRECIO'       },
  { col: 'stock',        label: 'STOCK'        },
  { col: 'stock_minimo', label: 'STOCK_MINIMO' },
  { col: 'activo',       label: 'ACTIVO'       },
];

/**
 * Escapa un valor para CSV:
 * - null/undefined → cadena vacía
 * - strings con comas, comillas o saltos de línea → entre comillas dobles
 */
const escapeCsvValue = (value) => {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

/**
 * Convierte un array de filas de BD a string CSV.
 * Cabeceras en mayúsculas, sin id/created_at/updated_at.
 */
const rowsToCsv = (rows) => {
  const header = CSV_EXPORT_FIELDS.map((f) => f.label).join(',');
  const lines  = rows.map((row) =>
    CSV_EXPORT_FIELDS.map((f) => escapeCsvValue(row[f.col])).join(',')
  );
  return [header, ...lines].join('\r\n');
};

/**
 * Parsea un string CSV a un array de objetos usando la primera fila como cabeceras.
 * Soporta valores entrecomillados con comas internas.
 * @returns {{ headers: string[], records: object[] }}
 */
const parseCsv = (text) => {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(Boolean);
  if (lines.length < 2) return { headers: [], records: [] };

  const splitLine = (line) => {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  };

  const headers = splitLine(lines[0]).map((h) => h.toLowerCase().trim());
  const records = lines.slice(1).map((line) => {
    const values = splitLine(line);
    return headers.reduce((obj, header, i) => {
      obj[header] = values[i] ?? '';
      return obj;
    }, {});
  });

  return { headers, records };
};

// ─── Controllers existentes ───────────────────────────────────────────────────

export const createProduct = async (req, res, next) => {
  try {
    const { nombre, descripcion, sku, categoria, precio, stock, stockMinimo, activo } = req.body;

    const parsedPrecio      = parseMoney(precio);
    const parsedStock       = stock        === undefined ? 0     : parseStock(stock);
    const parsedStockMinimo = stockMinimo  === undefined ? 0     : parseStock(stockMinimo);
    const parsedActivo      = activo       === undefined ? true  : parseBoolean(activo);

    if (!nombre || typeof nombre !== 'string' || nombre.trim().length < 2)
      return res.status(400).json({ message: 'Nombre de producto invalido' });
    if (parsedPrecio      === null || parsedPrecio      < 0) return res.status(400).json({ message: 'Precio invalido' });
    if (parsedStock       === null || parsedStock       < 0) return res.status(400).json({ message: 'Stock invalido' });
    if (parsedStockMinimo === null || parsedStockMinimo < 0) return res.status(400).json({ message: 'Stock minimo invalido' });
    if (parsedActivo      === null)                          return res.status(400).json({ message: 'Activo invalido. Usa true o false' });

    const product = await Product.create({
      nombre:      nombre.trim(),
      descripcion: typeof descripcion === 'string' ? descripcion.trim() : null,
      sku:         typeof sku         === 'string' ? sku.trim()         : null,
      categoria:   typeof categoria   === 'string' ? categoria.trim()   : null,
      precio:      parsedPrecio,
      stock:       parsedStock,
      stockMinimo: parsedStockMinimo,
      activo:      parsedActivo,
    });

    res.status(201).json({ message: 'Producto creado correctamente', data: product });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ message: 'El SKU ya existe' });
    next(error);
  }
};

export const listProducts = async (req, res, next) => {
  try {
    const page      = parsePositiveInt(req.query.page)  || 1;
    const limit     = parsePositiveInt(req.query.limit) || 10;
    const safeLimit = Math.min(limit, 100);
    const offset    = (page - 1) * safeLimit;

    const activeFilter = req.query.activo === undefined ? null : parseBoolean(req.query.activo);
    if (req.query.activo !== undefined && activeFilter === null)
      return res.status(400).json({ message: 'activo invalido. Usa true o false' });

    const filters = {
      q:         typeof req.query.q         === 'string' ? req.query.q.trim()         : '',
      categoria: typeof req.query.categoria === 'string' ? req.query.categoria.trim() : '',
      activo:    activeFilter,
    };

    const [products, total] = await Promise.all([
      Product.findAll({ ...filters, limit: safeLimit, offset }),
      Product.countAll(filters),
    ]);

    res.json({
      message: 'Productos obtenidos correctamente',
      data: products,
      pagination: { page, limit: safeLimit, total, totalPages: Math.max(1, Math.ceil(total / safeLimit)) },
    });
  } catch (error) {
    next(error);
  }
};

export const getProductById = async (req, res, next) => {
  try {
    const productId = parsePositiveInt(req.params.id);
    if (!productId) return res.status(400).json({ message: 'ID de producto invalido' });

    const product = await Product.findById(productId);
    if (!product) return res.status(404).json({ message: 'Producto no encontrado' });

    res.json({ message: 'Producto obtenido correctamente', data: product });
  } catch (error) {
    next(error);
  }
};

export const updateProduct = async (req, res, next) => {
  try {
    const productId = parsePositiveInt(req.params.id);
    if (!productId) return res.status(400).json({ message: 'ID de producto invalido' });

    const existing = await Product.findById(productId);
    if (!existing) return res.status(404).json({ message: 'Producto no encontrado' });

    const updates = {};

    if (req.body.nombre !== undefined) {
      if (typeof req.body.nombre !== 'string' || req.body.nombre.trim().length < 2)
        return res.status(400).json({ message: 'Nombre de producto invalido' });
      updates.nombre = req.body.nombre.trim();
    }

    if (req.body.descripcion !== undefined)
      updates.descripcion = req.body.descripcion === null ? null : String(req.body.descripcion).trim() || null;

    if (req.body.sku !== undefined)
      updates.sku = req.body.sku === null ? null : String(req.body.sku).trim() || null;

    if (req.body.categoria !== undefined)
      updates.categoria = req.body.categoria === null ? null : String(req.body.categoria).trim() || null;

    if (req.body.precio !== undefined) {
      const p = parseMoney(req.body.precio);
      if (p === null || p < 0) return res.status(400).json({ message: 'Precio invalido' });
      updates.precio = p;
    }

    if (req.body.stock !== undefined) {
      const s = parseStock(req.body.stock);
      if (s === null || s < 0) return res.status(400).json({ message: 'Stock invalido' });
      updates.stock = s;
    }

    if (req.body.stockMinimo !== undefined) {
      const sm = parseStock(req.body.stockMinimo);
      if (sm === null || sm < 0) return res.status(400).json({ message: 'Stock minimo invalido' });
      updates.stockMinimo = sm;
    }

    if (req.body.activo !== undefined) {
      const a = parseBoolean(req.body.activo);
      if (a === null) return res.status(400).json({ message: 'Activo invalido. Usa true o false' });
      updates.activo = a;
    }

    if (Object.keys(updates).length === 0)
      return res.status(400).json({ message: 'No hay cambios para actualizar' });

    const updatedProduct = await Product.updateById(productId, updates);
    res.json({ message: 'Producto actualizado correctamente', data: updatedProduct });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ message: 'El SKU ya existe' });
    next(error);
  }
};

export const deleteProduct = async (req, res, next) => {
  try {
    const productId = parsePositiveInt(req.params.id);
    if (!productId) return res.status(400).json({ message: 'ID de producto invalido' });

    const deleted = await Product.deleteById(productId);
    if (!deleted) return res.status(404).json({ message: 'Producto no encontrado' });

    res.json({ message: 'Producto eliminado correctamente' });
  } catch (error) {
    next(error);
  }
};

// ─── Exportar CSV ─────────────────────────────────────────────────────────────

/**
 * GET /api/productos/export
 * Descarga un archivo CSV con todos los productos (respeta los mismos
 * filtros de búsqueda: q, categoria, activo).
 */
export const exportProductsCsv = async (req, res, next) => {
  try {
    const activeFilter = req.query.activo === undefined ? null : parseBoolean(req.query.activo);
    if (req.query.activo !== undefined && activeFilter === null)
      return res.status(400).json({ message: 'activo invalido. Usa true o false' });

    const filters = {
      q:         typeof req.query.q         === 'string' ? req.query.q.trim()         : '',
      categoria: typeof req.query.categoria === 'string' ? req.query.categoria.trim() : '',
      activo:    activeFilter,
    };

    const products = await Product.exportAll(filters);
    const csv      = rowsToCsv(products);

    const filename = `productos_${new Date().toISOString().slice(0, 10)}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    // BOM para que Excel abra correctamente caracteres especiales
    res.send('\uFEFF' + csv);
  } catch (error) {
    next(error);
  }
};

// ─── Importar CSV ─────────────────────────────────────────────────────────────

/**
 * POST /api/productos/import
 * Recibe un archivo CSV en el campo "file" (multipart/form-data) o
 * texto plano CSV en el body (Content-Type: text/csv).
 *
 * Columnas esperadas (orden libre, cabeceras en primera fila):
 *   nombre*, descripcion, categoria, precio*, stock, stock_minimo, activo
 *   (* obligatorio)
 *
 * Lógica por fila:
 *   1. Si trae SKU → busca primero por SKU.
 *   2. Si no hay SKU o no coincide → busca por nombre (case-insensitive).
 *   3. Si no existe por ninguna clave → INSERT.
 *   4. Si existe y hay cambios en sku/precio/descripcion/categoria/stock/activo → UPDATE.
 *   5. Si existe y no hay cambios → se omite.
 */
export const importProductsCsv = async (req, res, next) => {
  try {
    // Aceptar archivo multipart (campo "file") o body text/csv directo
    let csvText = '';

    if (req.file) {
      csvText = req.file.buffer.toString('utf-8');
    } else if (typeof req.body === 'string' && req.body.length > 0) {
      csvText = req.body;
    } else {
      return res.status(400).json({
        message: 'No se recibió ningún archivo CSV. Envía un archivo con el campo "file" o el CSV como texto plano',
      });
    }

    // Eliminar BOM (Excel)
    csvText = csvText.replace(/^\uFEFF/, '');

    const { headers, records } = parseCsv(csvText);

    if (records.length === 0) {
      return res.status(400).json({ message: 'El archivo CSV está vacío o no tiene filas de datos' });
    }

    // Verificar columnas obligatorias
    const missingHeaders = IMPORT_REQUIRED.filter((col) => !headers.includes(col));
    if (missingHeaders.length > 0) {
      return res.status(400).json({
        message: `Faltan columnas obligatorias en el CSV: ${missingHeaders.join(', ')}`,
      });
    }

    // ── Validar y transformar cada fila ──────────────────────────────────────
    const validRows = [];
    const rowErrors = [];

    records.forEach((record, i) => {
      const rowNum      = i + 2; // fila 1 = cabecera
      const fieldErrors = [];

      // nombre — clave de deduplicación secundaria
      const nombre = typeof record.nombre === 'string' ? record.nombre.trim() : '';
      if (nombre.length < 2)
        fieldErrors.push('nombre es obligatorio y debe tener al menos 2 caracteres');

      // sku — clave de deduplicación prioritaria (opcional)
      const sku = typeof record.sku === 'string' ? record.sku.trim() || null : null;

      // precio
      const precio = parseMoney(record.precio);
      if (precio === null || precio < 0)
        fieldErrors.push('precio inválido (debe ser un número >= 0)');

      // stock (opcional, default 0)
      const stock = parseStock(
        record.stock !== undefined && record.stock !== '' ? record.stock : '0'
      );
      if (stock === null || stock < 0)
        fieldErrors.push('stock inválido (debe ser un entero >= 0)');

      // stock_minimo (opcional, default 0)
      const stockMinimo = parseStock(
        record.stock_minimo !== undefined && record.stock_minimo !== '' ? record.stock_minimo : '0'
      );
      if (stockMinimo === null || stockMinimo < 0)
        fieldErrors.push('stock_minimo inválido (debe ser un entero >= 0)');

      // activo (opcional, default true)
      const activo = parseBoolean(
        record.activo !== undefined && record.activo !== '' ? record.activo : 'true'
      );
      if (activo === null)
        fieldErrors.push('activo inválido (usa true o false)');

      if (fieldErrors.length > 0) {
        rowErrors.push({ fila: rowNum, nombre: nombre || '—', errores: fieldErrors });
        return;
      }

      validRows.push({
        nombre,
        descripcion: typeof record.descripcion === 'string' ? record.descripcion.trim() || null : null,
        sku,
        categoria:   typeof record.categoria   === 'string' ? record.categoria.trim()   || null : null,
        precio,
        stock,
        stockMinimo,
        activo,
      });
    });

    if (validRows.length === 0) {
      return res.status(422).json({
        message: 'Ninguna fila pudo procesarse. Revisa los errores',
        errors: rowErrors,
      });
    }

    const result = await Product.bulkUpsert(validRows);

    // Consolidar todos los errores (validación previa + errores de BD)
    const allErrors = [...rowErrors, ...result.errors];
    const status    = allErrors.length > 0 ? 207 : 200;

    res.status(status).json({
      message: [
        `Importación completada:`,
        `${result.created} creado(s),`,
        `${result.updated} actualizado(s),`,
        `${result.skipped} sin cambios,`,
        `${allErrors.length} con error`,
      ].join(' '),
      created:  result.created,
      updated:  result.updated,
      skipped:  result.skipped,
      errors:   allErrors,
      // Detalle de qué cambió en cada producto actualizado
      changes:  result.changes,
    });
  } catch (error) {
    next(error);
  }
};