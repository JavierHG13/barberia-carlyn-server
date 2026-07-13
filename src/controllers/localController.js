import LocalModel from '../models/local.js';

// GET /api/locales?activo=true
export const listarLocales = async (req, res) => {
  try {
    const { activo } = req.query;
    const filtro = activo === undefined ? null : activo === 'true';
    const locales = await LocalModel.getAll(filtro);
    res.json({ ok: true, data: locales, total: locales.length });
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, mensaje: 'Error al obtener locales' });
  }
};

// GET /api/locales/:id
export const getLocalById = async (req, res) => {
  try {
    const local = await LocalModel.getById(req.params.id);
    if (!local) {
      return res.status(404).json({ ok: false, mensaje: 'Local no encontrado' });
    }
    res.json({ ok: true, data: local });
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, mensaje: 'Error al obtener local' });
  }
};

// POST /api/locales
export const crearLocal = async (req, res) => {
  try {
    const { nombre, direccion } = req.body;
    if (!nombre || !direccion) {
      return res.status(400).json({ ok: false, mensaje: 'nombre y direccion son obligatorios' });
    }

    const local = await LocalModel.create(req.body);
    res.status(201).json({ ok: true, data: local });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ ok: false, mensaje: 'Ya existe un local marcado como principal' });
    }
    console.error(error);
    res.status(500).json({ ok: false, mensaje: 'Error al crear local' });
  }
};

// PUT /api/locales/:id
export const actualizarLocal = async (req, res) => {
  try {
    const local = await LocalModel.update(req.params.id, req.body);
    if (!local) {
      return res.status(404).json({ ok: false, mensaje: 'Local no encontrado o sin cambios' });
    }
    res.json({ ok: true, data: local });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ ok: false, mensaje: 'Ya existe un local marcado como principal' });
    }
    console.error(error);
    res.status(500).json({ ok: false, mensaje: 'Error al actualizar local' });
  }
};

// DELETE /api/locales/:id  (soft delete)
export const desactivarLocal = async (req, res) => {
  try {
    const { id } = req.params;

    const totalBarberos = await LocalModel.contarBarberosActivos(id);
    if (totalBarberos > 0) {
      return res.status(409).json({
        ok: false,
        mensaje: `No se puede desactivar: hay ${totalBarberos} barbero(s) activo(s) en este local`,
      });
    }

    const local = await LocalModel.softDelete(id);
    if (!local) {
      return res.status(404).json({ ok: false, mensaje: 'Local no encontrado' });
    }

    res.json({ ok: true, mensaje: 'Local desactivado', data: local });
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, mensaje: 'Error al desactivar local' });
  }
};