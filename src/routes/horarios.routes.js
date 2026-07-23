import { Router } from 'express';
import { body, validationResult } from 'express-validator';
import { query, transaction } from '../config/database.js';
import { verifyToken, requireRole } from '../middlewares/auth.middleware.js';

const router = Router();

router.use(verifyToken, requireRole('Admin'));

const validateResult = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

router.get('/', async (_req, res) => {
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
        b.especialidad,
        b.local_id,
        l.nombre as local_nombre
      FROM horarios_barbero h
      JOIN barberos b ON h.barbero_id = b.id
      JOIN usuarios u ON b.usuario_id = u.id
      LEFT JOIN locales l ON l.id = b.local_id
      ORDER BY h.barbero_id, h.dia_semana`
    );

    const horariosPorBarbero = {};
    result.rows.forEach((h) => {
      if (!horariosPorBarbero[h.barbero_id]) {
        horariosPorBarbero[h.barbero_id] = {
          barbero_id: h.barbero_id,
          barbero_nombre: h.barbero_nombre,
          especialidad: h.especialidad,
          local_id: h.local_id,
          local_nombre: h.local_nombre,
          horarios: [],
        };
      }
      horariosPorBarbero[h.barbero_id].horarios.push({
        id: h.id,
        dia_semana: h.dia_semana,
        hora_inicio: h.hora_inicio,
        hora_fin: h.hora_fin,
        activo: h.activo,
      });
    });

    res.json({ horarios: Object.values(horariosPorBarbero) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener horarios' });
  }
});

router.get('/plantillas', (_req, res) => {
  res.json({
    plantillas: [
      {
        nombre: 'Horario estándar',
        descripcion: 'Lunes a viernes 9:00-18:00',
        horarios: [1, 2, 3, 4, 5].map((dia_semana) => ({
          dia_semana,
          hora_inicio: '09:00',
          hora_fin: '18:00',
          activo: true,
        })),
      },
      {
        nombre: 'Horario completo',
        descripcion: 'Lunes a sábado 9:00-19:00',
        horarios: [1, 2, 3, 4, 5, 6].map((dia_semana) => ({
          dia_semana,
          hora_inicio: '09:00',
          hora_fin: dia_semana >= 5 ? '20:00' : '19:00',
          activo: true,
        })),
      },
      {
        nombre: 'Medio tiempo',
        descripcion: 'Lunes a viernes 9:00-13:00',
        horarios: [1, 2, 3, 4, 5].map((dia_semana) => ({
          dia_semana,
          hora_inicio: '09:00',
          hora_fin: '13:00',
          activo: true,
        })),
      },
    ],
  });
});

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
      barbero_id: Number(barberoId),
      barbero_nombre: result.rows[0]?.barbero_nombre || null,
      horarios: result.rows,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener horarios' });
  }
});

router.post(
  '/barbero/:barberoId',
  [
    body('horarios').isArray().withMessage('Horarios debe ser un array'),
    body('horarios.*.dia_semana').isInt({ min: 0, max: 6 }).withMessage('Dia de semana invalido'),
    body('horarios.*.hora_inicio').matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).withMessage('Hora inicio invalida'),
    body('horarios.*.hora_fin').matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).withMessage('Hora fin invalida'),
    body('horarios.*.activo').optional().isBoolean().withMessage('Activo debe ser booleano'),
  ],
  validateResult,
  async (req, res) => {
    try {
      const { barberoId } = req.params;
      const { horarios } = req.body;

      const barberoResult = await query('SELECT id FROM barberos WHERE id = $1', [barberoId]);
      if (barberoResult.rows.length === 0) {
        return res.status(404).json({ error: 'Barbero no encontrado' });
      }

      await transaction(async (client) => {
        await client.query('DELETE FROM horarios_barbero WHERE barbero_id = $1', [barberoId]);

        for (const horario of horarios) {
          if (horario.hora_inicio >= horario.hora_fin) {
            throw { statusCode: 400, message: 'La hora de inicio debe ser menor que la hora fin' };
          }

          await client.query(
            `INSERT INTO horarios_barbero (barbero_id, dia_semana, hora_inicio, hora_fin, activo)
             VALUES ($1, $2, $3, $4, $5)`,
            [
              barberoId,
              horario.dia_semana,
              horario.hora_inicio,
              horario.hora_fin,
              horario.activo ?? true,
            ]
          );
        }
      });

      res.json({
        message: 'Horarios configurados exitosamente',
        barbero_id: Number(barberoId),
        total_dias: horarios.length,
      });
    } catch (error) {
      if (error.statusCode) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      console.error(error);
      res.status(500).json({ error: 'Error al configurar horarios' });
    }
  }
);

router.put(
  '/:id',
  [
    body('dia_semana').optional().isInt({ min: 0, max: 6 }),
    body('hora_inicio').optional().matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/),
    body('hora_fin').optional().matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/),
    body('activo').optional().isBoolean(),
  ],
  validateResult,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { dia_semana, hora_inicio, hora_fin, activo } = req.body;

      const updates = [];
      const params = [];
      let paramCount = 1;

      if (dia_semana !== undefined) {
        updates.push(`dia_semana = $${paramCount}`);
        params.push(dia_semana);
        paramCount += 1;
      }
      if (hora_inicio) {
        updates.push(`hora_inicio = $${paramCount}`);
        params.push(hora_inicio);
        paramCount += 1;
      }
      if (hora_fin) {
        updates.push(`hora_fin = $${paramCount}`);
        params.push(hora_fin);
        paramCount += 1;
      }
      if (activo !== undefined) {
        updates.push(`activo = $${paramCount}`);
        params.push(activo);
        paramCount += 1;
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

      res.json({ message: 'Horario actualizado exitosamente', horario: result.rows[0] });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Error al actualizar horario' });
    }
  }
);

router.delete('/:id', async (req, res) => {
  try {
    const result = await query('DELETE FROM horarios_barbero WHERE id = $1 RETURNING *', [req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Horario no encontrado' });
    }

    res.json({ message: 'Horario eliminado exitosamente' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al eliminar horario' });
  }
});

export default router;
