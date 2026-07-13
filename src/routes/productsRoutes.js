import express from 'express';
import multer  from 'multer';
import {
  createProduct,
  listProducts,
  getProductById,
  updateProduct,
  deleteProduct,
  exportProductsCsv,
  importProductsCsv,
} from '../controllers/productController.js';

const router = express.Router();

// ─── Multer: memoria, solo CSV, máx 5 MB ─────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['text/csv', 'application/vnd.ms-excel', 'application/octet-stream'];
    if (allowed.includes(file.mimetype) || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten archivos CSV'));
    }
  },
});

const handleMulterError = (err, _req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE')
      return res.status(400).json({ message: 'El archivo supera el límite de 5 MB' });
    return res.status(400).json({ message: err.message });
  }
  if (err) return res.status(400).json({ message: err.message });
  next();
};

// ─────────────────────────────────────────────────────────────────────────────
// IMPORTANTE: /export e /import deben ir ANTES de /:id
// para que Express no los interprete como un parámetro dinámico.
// ─────────────────────────────────────────────────────────────────────────────

// GET  /api/productos/export
// Descarga un CSV con todos los productos.
// Filtros opcionales por query: ?q=&categoria=&activo=true|false
router.get('/export', exportProductsCsv);

// POST /api/productos/import
// Acepta dos formas:
//   1. multipart/form-data  → campo "file" con el archivo .csv
//   2. text/csv             → body con el texto CSV directamente
router.post(
  '/import',
  (req, res, next) => {
    if (req.headers['content-type']?.startsWith('text/csv')) {
      let data = '';
      req.setEncoding('utf8');
      req.on('data', (chunk) => { data += chunk; });
      req.on('end',  () => { req.body = data; next(); });
    } else {
      upload.single('file')(req, res, (err) => handleMulterError(err, req, res, next));
    }
  },
  importProductsCsv
);

// ─── CRUD estándar ────────────────────────────────────────────────────────────

// POST   /api/productos
router.post('/', createProduct);

// GET    /api/productos
router.get('/', listProducts);

// GET    /api/productos/:id
router.get('/:id', getProductById);

// PATCH  /api/productos/:id
router.patch('/:id', updateProduct);

// DELETE /api/productos/:id
router.delete('/:id', deleteProduct);

export default router;