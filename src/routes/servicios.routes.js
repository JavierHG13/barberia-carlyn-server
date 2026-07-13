import express from 'express';
import multer from 'multer';
import ServicioController from '../controllers/servicio.controller.js';
import { verifyToken, requireRole } from '../middlewares/auth.middleware.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const router = express.Router();



const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const tempDir = path.join(__dirname, '../temp');

if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, tempDir); // ✅ FIX
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `servicio-${uniqueSuffix}-${file.originalname}`);
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten imágenes (JPEG, PNG, JPG, WEBP)'));
    }
  }
});

/**
 * RUTAS PÚBLICAS
 */
router.get('/activos', ServicioController.getActive);
router.get('/populares', ServicioController.getMostPopular);

/**
 * RUTAS PROTEGIDAS
 */
router.get('/', ServicioController.getAll);

router.get('/estadisticas/generales', verifyToken, requireRole('Admin', 'Barbero'), ServicioController.getGeneralStats);
router.get('/:id', ServicioController.getById);
router.get('/:id/estadisticas', verifyToken, requireRole('Admin', 'Barbero'), ServicioController.getStats);

/**
 * RUTAS SOLO ADMIN
 */
router.post('/', 
  verifyToken,
  requireRole('Admin'),
  upload.single('imagen'),
  ServicioController.create
);

router.put('/:id',
  verifyToken,
  requireRole('Admin'),
  upload.single('imagen'),
  ServicioController.update
);

router.delete('/:id',
  verifyToken,
  requireRole('Admin'),
  ServicioController.deactivate
);

router.put('/:id/activar',
  verifyToken,
  requireRole('Admin'),
  ServicioController.activate
);

export default router;