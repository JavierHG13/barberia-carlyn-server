import { pool } from '../config/database.js';

const SALE_SELECT = `
  v.id,
  v.metodo_pago,
  v.cliente_nombre,
  v.notas,
  v.total,
  v.vendida_por,
  COALESCE(u.nombre, 'Sistema') AS vendida_por_nombre,
  v.fecha_venta,
  v.created_at
`;

class Sale {
  static async findById(id) {
    const saleResult = await pool.query(
      `SELECT ${SALE_SELECT}
       FROM tbl_ventas v
       LEFT JOIN usuarios u ON u.id = v.vendida_por
       WHERE v.id = $1`,
      [id]
    );

    const sale = saleResult.rows[0];
    if (!sale) {
      return null;
    }

    const detailResult = await pool.query(
      `SELECT
         id,
         venta_id,
         producto_id,
         producto_nombre,
         cantidad,
         precio_unitario,
         subtotal
       FROM tbl_ventas_detalle
       WHERE venta_id = $1
       ORDER BY id ASC`,
      [id]
    );

    return {
      ...sale,
      detalles: detailResult.rows,
    };
  }

  static async create({ items, metodoPago, clienteNombre, notas, vendidaPor }) {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const detalles = [];
      let total = 0;

      for (const item of items) {
        const productoId = Number.parseInt(item.productoId, 10);
        const cantidad = Number.parseInt(item.cantidad, 10);

        const productResult = await client.query(
          `SELECT id, nombre, precio, stock, activo
           FROM tbl_productos
           WHERE id = $1
           FOR UPDATE`,
          [productoId]
        );

        const product = productResult.rows[0];

        if (!product) {
          throw { statusCode: 404, message: `Producto ${productoId} no encontrado` };
        }

        if (!product.activo) {
          throw { statusCode: 400, message: `El producto ${product.nombre} esta inactivo` };
        }

        if (product.stock < cantidad) {
          throw {
            statusCode: 409,
            message: `Stock insuficiente para ${product.nombre}. Disponible: ${product.stock}`,
          };
        }

        const precioUnitario = Number.parseFloat(product.precio);
        const subtotal = Number.parseFloat((precioUnitario * cantidad).toFixed(2));

        total += subtotal;

        await client.query(
          `UPDATE tbl_productos
           SET stock = stock - $1,
               updated_at = NOW()
           WHERE id = $2`,
          [cantidad, productoId]
        );

        detalles.push({
          productoId,
          productoNombre: product.nombre,
          cantidad,
          precioUnitario,
          subtotal,
        });
      }

      const totalFinal = Number.parseFloat(total.toFixed(2));

      const saleResult = await client.query(
        `INSERT INTO tbl_ventas
          (metodo_pago, cliente_nombre, notas, total, vendida_por)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [metodoPago, clienteNombre || null, notas || null, totalFinal, vendidaPor || null]
      );

      const saleId = saleResult.rows[0].id;

      for (const detalle of detalles) {
        await client.query(
          `INSERT INTO tbl_ventas_detalle
            (venta_id, producto_id, producto_nombre, cantidad, precio_unitario, subtotal)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            saleId,
            detalle.productoId,
            detalle.productoNombre,
            detalle.cantidad,
            detalle.precioUnitario,
            detalle.subtotal,
          ]
        );
      }

      await client.query('COMMIT');

      return await this.findById(saleId);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  static async getHistoryByRange({ from, to }) {
    const result = await pool.query(
      `SELECT
         ${SALE_SELECT},
         COALESCE(
           json_agg(
             json_build_object(
               'id', d.id,
               'venta_id', d.venta_id,
               'producto_id', d.producto_id,
               'producto_nombre', d.producto_nombre,
               'cantidad', d.cantidad,
               'precio_unitario', d.precio_unitario,
               'subtotal', d.subtotal
             )
           ) FILTER (WHERE d.id IS NOT NULL),
           '[]'::json
         ) AS detalles
       FROM tbl_ventas v
       LEFT JOIN usuarios u ON u.id = v.vendida_por
       LEFT JOIN tbl_ventas_detalle d ON d.venta_id = v.id
       WHERE v.fecha_venta >= $1::timestamp
         AND v.fecha_venta < $2::timestamp
       GROUP BY v.id, u.nombre
       ORDER BY v.fecha_venta DESC`,
      [from, to]
    );

    return result.rows;
  }


  static async getHistoryByDay(dayLabel) {
    const result = await pool.query(
      `SELECT
         ${SALE_SELECT},
         COALESCE(
           json_agg(
             json_build_object(
               'id', d.id,
               'venta_id', d.venta_id,
               'producto_id', d.producto_id,
               'producto_nombre', d.producto_nombre,
               'cantidad', d.cantidad,
               'precio_unitario', d.precio_unitario,
               'subtotal', d.subtotal
             )
           ) FILTER (WHERE d.id IS NOT NULL),
           '[]'::json
         ) AS detalles
       FROM tbl_ventas v
       LEFT JOIN usuarios u ON u.id = v.vendida_por
       LEFT JOIN tbl_ventas_detalle d ON d.venta_id = v.id
       WHERE DATE(v.fecha_venta) = $1::date
       GROUP BY v.id, u.nombre
       ORDER BY v.fecha_venta DESC`,
      [dayLabel]
    );

    return result.rows;
  }
  static async getCashCutSummary({ from, to }) {
    const result = await pool.query(
      `SELECT
         COUNT(*)::INT AS total_transacciones,
         COALESCE(SUM(total), 0)::NUMERIC(12, 2) AS total_ventas,
         COALESCE(SUM(CASE WHEN metodo_pago = 'efectivo' THEN total ELSE 0 END), 0)::NUMERIC(12, 2) AS total_efectivo,
         COALESCE(SUM(CASE WHEN metodo_pago = 'transferencia' THEN total ELSE 0 END), 0)::NUMERIC(12, 2) AS total_transferencia,
         COALESCE(SUM(CASE WHEN metodo_pago = 'tarjeta' THEN total ELSE 0 END), 0)::NUMERIC(12, 2) AS total_tarjeta
       FROM tbl_ventas
       WHERE fecha_venta >= $1::timestamp
         AND fecha_venta < $2::timestamp`,
      [from, to]
    );

    return result.rows[0];
  }

  static async createCashCut({ from, to, generadoPor }) {
    const summary = await this.getCashCutSummary({ from, to });

    const insertResult = await pool.query(
      `INSERT INTO tbl_cortes_caja
        (fecha_inicio, fecha_fin, total_transacciones, total_ventas, total_efectivo, total_transferencia, total_tarjeta, generado_por)
       VALUES ($1::timestamp, $2::timestamp, $3, $4, $5, $6, $7, $8)
       RETURNING
         id,
         fecha_inicio,
         fecha_fin,
         total_transacciones,
         total_ventas,
         total_efectivo,
         total_transferencia,
         total_tarjeta,
         generado_por,
         created_at`,
      [
        from,
        to,
        summary.total_transacciones,
        summary.total_ventas,
        summary.total_efectivo,
        summary.total_transferencia,
        summary.total_tarjeta,
        generadoPor || null,
      ]
    );

    return {
      ...insertResult.rows[0],
      resumen: summary,
    };
  }
}

export default Sale;





