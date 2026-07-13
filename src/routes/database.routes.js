import express from 'express';
import {
    getStats
} from '../controllers/database.controller.js';

import { verifyToken, requireRole } from '../middlewares/auth.middleware.js';

const router = express.Router();

router.use(verifyToken, requireRole('Admin'));

router.get('/stats', getStats);

export default router;