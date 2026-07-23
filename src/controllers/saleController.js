import Sale from '../models/sale.js';

const ALLOWED_PAYMENT_METHODS = ['efectivo', 'transferencia', 'tarjeta'];

const pad2 = (value) => String(value).padStart(2, '0');

const formatLocalDate = (date) => {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
};

const formatLocalTimestamp = (date) => {
  return `${formatLocalDate(date)} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
};

const parseDateValue = (value) => {
  if (!value) return null;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    const datePrefixPattern = /^(\d{4}-\d{2}-\d{2})(T.*)?$/;
    const match = trimmed.match(datePrefixPattern);

    if (match) {
      const [year, month, day] = match[1].split('-').map((num) => Number.parseInt(num, 10));
      const parsedLocalDate = new Date(year, month - 1, day);
      if (Number.isNaN(parsedLocalDate.getTime())) {
        return null;
      }
      return parsedLocalDate;
    }
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
};

const getDayRange = (fecha) => {
  const start = new Date(fecha);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  return {
    start,
    end,
    startSql: formatLocalTimestamp(start),
    endSql: formatLocalTimestamp(end),
    dayLabel: formatLocalDate(start),
  };
};

export const registerSale = async (req, res, next) => {
  try {
    const { items, metodoPago, clienteNombre, notas } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'La venta debe incluir al menos un producto' });
    }

    const paymentMethod = (metodoPago || 'efectivo').toString().toLowerCase();
    if (!ALLOWED_PAYMENT_METHODS.includes(paymentMethod)) {
      return res.status(400).json({
        message: 'Metodo de pago invalido. Usa efectivo, transferencia o tarjeta',
      });
    }

    for (const item of items) {
      const productoId = Number.parseInt(item.productoId, 10);
      const cantidad = Number.parseInt(item.cantidad, 10);

      if (Number.isNaN(productoId) || productoId <= 0) {
        return res.status(400).json({ message: 'productoId invalido en detalle' });
      }

      if (Number.isNaN(cantidad) || cantidad <= 0) {
        return res.status(400).json({ message: 'cantidad invalida en detalle' });
      }
    }

    const sale = await Sale.create({
      items,
      metodoPago: paymentMethod,
      clienteNombre: typeof clienteNombre === 'string' ? clienteNombre.trim() : null,
      notas: typeof notas === 'string' ? notas.trim() : null,
      vendidaPor: req.user.id,
    });

    res.status(201).json({
      message: 'Venta registrada correctamente',
      data: sale,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }

    next(error);
  }
};

export const getSalesHistoryByDay = async (req, res, next) => {
  try {
    const selectedDate = req.query.fecha ? parseDateValue(req.query.fecha) : new Date();
    if (!selectedDate) {
      return res.status(400).json({ message: 'fecha invalida. Usa formato YYYY-MM-DD' });
    }

    const range = getDayRange(selectedDate);
    const sales = await Sale.getHistoryByDay(range.dayLabel);

    const totalVentasDia = sales.reduce((acc, sale) => acc + Number.parseFloat(sale.total || 0), 0);

    res.json({
      message: 'Historial de ventas obtenido correctamente',
      date: range.dayLabel,
      totalTransacciones: sales.length,
      totalVentasDia: Number.parseFloat(totalVentasDia.toFixed(2)),
      data: sales,
    });
  } catch (error) {
    next(error);
  }
};

export const generateCashCut = async (req, res, next) => {
  try {
    const selectedDate = req.body.fecha ? parseDateValue(req.body.fecha) : new Date();
    if (!selectedDate) {
      return res.status(400).json({ message: 'fecha invalida. Usa formato YYYY-MM-DD' });
    }

    const range = getDayRange(selectedDate);

    const cashCut = await Sale.createCashCut({
      from: range.startSql,
      to: range.endSql,
      generadoPor: req.user.id,
    });

    res.status(201).json({
      message: 'Corte de caja generado correctamente',
      data: cashCut,
    });
  } catch (error) {
    next(error);
  }
};

