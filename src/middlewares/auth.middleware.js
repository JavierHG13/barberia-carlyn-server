import jwt from 'jsonwebtoken';
import { query } from '../config/database.js';
import dotenv from 'dotenv';

dotenv.config();

// Middleware para verificar token JWT
export const verifyToken = async (req, res, next) => {
  try {

    const token = req.headers.authorization?.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({ error: 'Token no proporcionado' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Verificar que el usuario existe y está activo
    const result = await query(
      `SELECT u.id, u.nombre, u.email, u.telefono, u.rol_id, u.foto, u.activo,
              u.created_at, u.updated_at, r.nombre as rol
       FROM usuarios u
       JOIN roles r ON u.rol_id = r.id
       WHERE u.email = $1`,
      [decoded.email]
    );


    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Usuario no encontrado' });
    }


    if (!result.rows[0].activo) {
      return res.status(401).json({ error: 'Usuario inactivo' });
    }


    req.user = result.rows[0];


    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Token inválido' });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expirado' });
    }
    return res.status(500).json({ error: 'Error al verificar token' });
  }
};

// Middleware para verificar roles
export const requireRole = (...roles) => {
  return (req, res, next) => {

    if (!req.user) {


      return res.status(401).json({ error: 'No autenticado' });
    }

    const normalizeRole = (role) => String(role || '').trim().toLowerCase();
    const allowedRoles = roles.map(normalizeRole);
    const userRole = normalizeRole(req.user.rol);

    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({
        error: 'No tienes permisos para realizar esta acción',
        rol: req.user.rol,
        rolesPermitidos: roles,
      });
    }



    next();
  };
};
