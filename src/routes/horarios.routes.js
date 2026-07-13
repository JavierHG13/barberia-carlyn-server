const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { query, transaction } = require('../../config/database');
const { verifyToken, requireRole } = require('../../middlewares/auth.middleware');

router.use(verifyToken, requireRole('Admin'));

// GET /api/admin/horarios - Obtener todos los horarios de barberos
router.get('/', async (req, res) => {
  try {
    const result = await query(
      `SELECT 
        h.id,
        h.barbero_id,
        h.dia_semana,
        h.hora_inicio,
        h.hora_fin,
        h.activo,
        u.nombre as barbero_nombre,
        b.especialidad
      FROM horarios_barbero h
      JOIN barberos b ON h.barbero_id = b.id
      JOIN usuarios u ON b.usuario_id = u.id
      ORDER BY h.barbero_id, h.dia_semana`
    );

    // Agrupar por barbero
    const horariosPorBarbero = {};
    result.rows.forEach(h => {
      if (!horariosPorBarbero[h.barbero_id]) {
        horariosPorBarbero[h.barbero_id] = {
          barbero_id: h.barbero_id,
          barbero_nombre: h.barbero_nombre,
          especialidad: h.especialidad,
          horarios: []
        };
      }
      horariosPorBarbero[h.barbero_id].horarios.push({
        id: h.id,
        dia_semana: h.dia_semana,
        hora_inicio: h.hora_inicio,
        hora_fin: h.hora_fin,
        activo: h.activo
      });
    });

    res.json({
      horarios: Object.values(horariosPorBarbero)
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error al obtener horarios' });
  }
});

// GET /api/admin/horarios/barbero/:barberoId - Obtener horarios de un barbero específico
router.get('/barbero/:barberoId', async (req, res) => {
  try {
    const { barberoId } = req.params;

    const result = await query(
      `SELECT 
        h.*,
        u.nombre as barbero_nombre
      FROM horarios_barbero h
      JOIN barberos b ON h.barbero_id = b.id
      JOIN usuarios u ON b.usuario_id = u.id
      WHERE h.barbero_id = $1
      ORDER BY h.dia_semana`,
      [barberoId]
    );

    res.json({
      barbero_id: barberoId,
      barbero_nombre: result.rows[0]?.barbero_nombre,
      horarios: result.rows
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error al obtener horarios' });
  }
});

// POST /api/admin/horarios/barbero/:barberoId - Configurar horarios completos de un barbero
router.post('/barbero/:barberoId', [
  body('horarios').isArray().withMessage('Horarios debe ser un array'),
  body('horarios.*.dia_semana').isInt({ min: 0, max: 6 }).withMessage('Día de semana inválido'),
  body('horarios.*.hora_inicio').matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).withMessage('Hora inicio inválida'),
  body('horarios.*.hora_fin').matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).withMessage('Hora fin inválida'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { barberoId } = req.params;
    const { horarios } = req.body;

    // Verificar que el barbero existe
    const barberoResult = await query(
      'SELECT id FROM barberos WHERE id = $1',
      [barberoId]
    );

    if (barberoResult.rows.length === 0) {
      return res.status(404).json({ error: 'Barbero no encontrado' });
    }

    // Usar transacción para actualizar todos los horarios
    await transaction(async (client) => {
      // Eliminar horarios anteriores
      await client.query('DELETE FROM horarios_barbero WHERE barbero_id = $1', [barberoId]);

      // Insertar nuevos horarios
      for (const horario of horarios) {
        await client.query(
          `INSERT INTO horarios_barbero (barbero_id, dia_semana, hora_inicio, hora_fin)
           VALUES ($1, $2, $3, $4)`,
          [barberoId, horario.dia_semana, horario.hora_inicio, horario.hora_fin]
        );
      }
    });

    res.json({ 
      message: 'Horarios configurados exitosamente',
      barbero_id: barberoId,
      total_dias: horarios.length
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error al configurar horarios' });
  }
});

// PUT /api/admin/horarios/:id - Actualizar un horario específico
router.put('/:id', [
  body('dia_semana').optional().isInt({ min: 0, max: 6 }),
  body('hora_inicio').optional().matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/),
  body('hora_fin').optional().matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    const { dia_semana, hora_inicio, hora_fin, activo } = req.body;

    const updates = [];
    const params = [];
    let paramCount = 1;

    if (dia_semana !== undefined) {
      updates.push(`dia_semana = $${paramCount}`);
      params.push(dia_semana);
      paramCount++;
    }

    if (hora_inicio) {
      updates.push(`hora_inicio = $${paramCount}`);
      params.push(hora_inicio);
      paramCount++;
    }

    if (hora_fin) {
      updates.push(`hora_fin = $${paramCount}`);
      params.push(hora_fin);
      paramCount++;
    }

    if (activo !== undefined) {
      updates.push(`activo = $${paramCount}`);
      params.push(activo);
      paramCount++;
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No hay campos para actualizar' });
    }

    params.push(id);
    const result = await query(
      `UPDATE horarios_barbero SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`,
      params
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Horario no encontrado' });
    }

    res.json({
      message: 'Horario actualizado exitosamente',
      horario: result.rows[0]
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error al actualizar horario' });
  }
});

// POST /api/admin/horarios/barbero/:barberoId/dia - Agregar un día específico
router.post('/barbero/:barberoId/dia', [
  body('dia_semana').isInt({ min: 0, max: 6 }).withMessage('Día de semana inválido'),
  body('hora_inicio').matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).withMessage('Hora inicio inválida'),
  body('hora_fin').matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).withMessage('Hora fin inválida'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { barberoId } = req.params;
    const { dia_semana, hora_inicio, hora_fin } = req.body;

    // Verificar si ya existe ese día
    const existente = await query(
      'SELECT id FROM horarios_barbero WHERE barbero_id = $1 AND dia_semana = $2',
      [barberoId, dia_semana]
    );

    if (existente.rows.length > 0) {
      return res.status(400).json({ 
        error: 'Ya existe un horario para este día. Use PUT para actualizar.' 
      });
    }

    const result = await query(
      `INSERT INTO horarios_barbero (barbero_id, dia_semana, hora_inicio, hora_fin)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [barberoId, dia_semana, hora_inicio, hora_fin]
    );

    res.status(201).json({
      message: 'Horario agregado exitosamente',
      horario: result.rows[0]
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error al agregar horario' });
  }
});

// DELETE /api/admin/horarios/:id - Eliminar un horario
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await query(
      'DELETE FROM horarios_barbero WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Horario no encontrado' });
    }

    res.json({ message: 'Horario eliminado exitosamente' });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error al eliminar horario' });
  }
});

// POST /api/admin/horarios/barbero/:barberoId/clonar - Clonar horario de un día a otro
router.post('/barbero/:barberoId/clonar', [
  body('dia_origen').isInt({ min: 0, max: 6 }),
  body('dia_destino').isInt({ min: 0, max: 6 }),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { barberoId } = req.params;
    const { dia_origen, dia_destino } = req.body;

    // Obtener horario de origen
    const origenResult = await query(
      'SELECT hora_inicio, hora_fin FROM horarios_barbero WHERE barbero_id = $1 AND dia_semana = $2',
      [barberoId, dia_origen]
    );

    if (origenResult.rows.length === 0) {
      return res.status(404).json({ error: 'No existe horario para el día de origen' });
    }

    const { hora_inicio, hora_fin } = origenResult.rows[0];

    // Eliminar horario destino si existe
    await query(
      'DELETE FROM horarios_barbero WHERE barbero_id = $1 AND dia_semana = $2',
      [barberoId, dia_destino]
    );

    // Crear nuevo horario
    const result = await query(
      `INSERT INTO horarios_barbero (barbero_id, dia_semana, hora_inicio, hora_fin)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [barberoId, dia_destino, hora_inicio, hora_fin]
    );

    res.json({
      message: 'Horario clonado exitosamente',
      horario: result.rows[0]
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error al clonar horario' });
  }
});

// GET /api/admin/horarios/plantillas - Obtener plantillas de horarios predefinidas
router.get('/plantillas', (req, res) => {
  const plantillas = [
    {
      nombre: 'Horario Estándar (L-V)',
      descripcion: 'Lunes a Viernes 9:00-18:00',
      horarios: [
        { dia_semana: 1, hora_inicio: '09:00', hora_fin: '18:00' },
        { dia_semana: 2, hora_inicio: '09:00', hora_fin: '18:00' },
        { dia_semana: 3, hora_inicio: '09:00', hora_fin: '18:00' },
        { dia_semana: 4, hora_inicio: '09:00', hora_fin: '18:00' },
        { dia_semana: 5, hora_inicio: '09:00', hora_fin: '18:00' },
      ]
    },
    {
      nombre: 'Horario Completo (L-S)',
      descripcion: 'Lunes a Sábado 9:00-19:00',
      horarios: [
        { dia_semana: 1, hora_inicio: '09:00', hora_fin: '19:00' },
        { dia_semana: 2, hora_inicio: '09:00', hora_fin: '19:00' },
        { dia_semana: 3, hora_inicio: '09:00', hora_fin: '19:00' },
        { dia_semana: 4, hora_inicio: '09:00', hora_fin: '19:00' },
        { dia_semana: 5, hora_inicio: '09:00', hora_fin: '20:00' },
        { dia_semana: 6, hora_inicio: '09:00', hora_fin: '20:00' },
      ]
    },
    {
      nombre: 'Horario Extendido',
      descripcion: 'Todos los días 9:00-19:00',
      horarios: [
        { dia_semana: 0, hora_inicio: '10:00', hora_fin: '15:00' },
        { dia_semana: 1, hora_inicio: '09:00', hora_fin: '19:00' },
        { dia_semana: 2, hora_inicio: '09:00', hora_fin: '19:00' },
        { dia_semana: 3, hora_inicio: '09:00', hora_fin: '19:00' },
        { dia_semana: 4, hora_inicio: '09:00', hora_fin: '19:00' },
        { dia_semana: 5, hora_inicio: '09:00', hora_fin: '20:00' },
        { dia_semana: 6, hora_inicio: '09:00', hora_fin: '20:00' },
      ]
    },
    {
      nombre: 'Medio Tiempo',
      descripcion: 'Mañanas solamente',
      horarios: [
        { dia_semana: 1, hora_inicio: '09:00', hora_fin: '13:00' },
        { dia_semana: 2, hora_inicio: '09:00', hora_fin: '13:00' },
        { dia_semana: 3, hora_inicio: '09:00', hora_fin: '13:00' },
        { dia_semana: 4, hora_inicio: '09:00', hora_fin: '13:00' },
        { dia_semana: 5, hora_inicio: '09:00', hora_fin: '13:00' },
      ]
    }
  ];

  res.json({ plantillas });
});

module.exports = router;