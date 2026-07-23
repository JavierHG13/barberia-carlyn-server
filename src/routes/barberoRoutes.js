import { Router } from 'express';
import {
  listarBarberos,
  getPerfil,
  updatePerfil,
  getProximasCitas,
  getHistorialCitas,
  getResumen,
  getHorarios,
  updateHorarios,
  toggleDiaHorario,
  deleteDiaHorario,
  listarBarberosPorLocal,
  asignarLocalBarbero,
  updatePerfilAdmin,
} from '../controllers/barberoController.js';



import { requireRole, verifyToken } from '../middlewares/auth.middleware.js';

const router = Router();


// ── Públicos / Cliente ─────────────────────────────
// Cliente necesita ver barberos para agendar cita
router.get('/', verifyToken, requireRole("Cliente","Admin"), listarBarberos);


// ── Perfil (solo barbero/admin) ─────────────────────
router.get('/perfil', verifyToken, requireRole("Barbero","Admin"), getPerfil);
router.put('/', verifyToken, requireRole("Barbero","Admin"), updatePerfil);


// ── Resumen / dashboard ─────────────────────────────
router.get('/resumen', verifyToken, requireRole("Barbero","Admin"), getResumen);


// ── Citas (solo barbero/admin) ──────────────────────
router.get('/citas/proximas', verifyToken, requireRole("Barbero","Admin"), getProximasCitas);
router.get('/citas/historial', verifyToken, requireRole("Barbero","Admin"), getHistorialCitas);


// ── Horarios (solo barbero/admin) ───────────────────
router.get('/horarios', verifyToken, requireRole("Barbero","Admin"), getHorarios);
router.put('/horarios', verifyToken, requireRole("Barbero","Admin"), updateHorarios);
router.patch('/horarios/:diaSemana/toggle', verifyToken, requireRole("Barbero","Admin"), toggleDiaHorario);
router.delete('/horarios/:diaSemana', verifyToken, requireRole("Barbero","Admin"), deleteDiaHorario);

router.get('/local/:localId', listarBarberosPorLocal);
router.patch('/:id/perfil', verifyToken, requireRole("Admin"), updatePerfilAdmin);
router.patch('/:id/local', verifyToken, requireRole("Admin"), asignarLocalBarbero);


export default router;
