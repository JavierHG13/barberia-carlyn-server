import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import User from '../models/user.js';
import VerificationTemp from '../models/VerificationTemp.js';
import dotenv from 'dotenv';
import axios from 'axios';
import { sendVerificationCode, sendRecoveryCode, sendPasswordChangedNotification } from '../utils/notificationService.js';

dotenv.config();


const loginAttempts = new Map();
const resendAttempts = new Map();

// ========== UTILIDADES ==========

const createToken = (user) => {
  const payload = {
    sub: user.id,
    email: user.email,
  };
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN,
  });
};

const getIdentifier = (canal, correoElectronico, telefono) =>
  canal === 'sms' ? telefono : correoElectronico;

const checkIfBlocked = (identifier) => {
  const attemptData = loginAttempts.get(identifier);
  if (!attemptData) return;

  if (attemptData.blockedUntil && Date.now() < attemptData.blockedUntil) {
    const remainingTime = Math.ceil((attemptData.blockedUntil - Date.now()) / 1000);
    throw {
      statusCode: 429,
      message: `Demasiados intentos fallidos. Intenta de nuevo en ${remainingTime} segundos`,
    };
  }

  if (attemptData.blockedUntil && Date.now() >= attemptData.blockedUntil) {
    loginAttempts.delete(identifier);
  }
};

const recordFailedAttempt = (identifier) => {
  const attemptData = loginAttempts.get(identifier) || { attempts: 0, blockedUntil: null };
  attemptData.attempts += 1;

  if (attemptData.attempts >= 3) {
    attemptData.blockedUntil = Date.now() + 2 * 60 * 1000;
    console.log(`🔒 Usuario bloqueado: ${identifier} por 2 minutos`);
  }

  loginAttempts.set(identifier, attemptData);
};

const clearFailedAttempts = (identifier) => {
  loginAttempts.delete(identifier);
};

const checkResendLimit = (identifier) => {
  const resendData = resendAttempts.get(identifier);
  if (!resendData) return;

  if (resendData.blockedUntil && Date.now() < resendData.blockedUntil) {
    const remainingTime = Math.ceil((resendData.blockedUntil - Date.now()) / 1000);
    throw {
      statusCode: 429,
      message: `Demasiados reenvíos. Espera ${remainingTime} segundos antes de intentar nuevamente`,
    };
  }

  const COOLDOWN = 30 * 1000;
  if (Date.now() - resendData.lastAttempt < COOLDOWN) {
    const remainingTime = Math.ceil((COOLDOWN - (Date.now() - resendData.lastAttempt)) / 1000);
    throw {
      statusCode: 429,
      message: `Debes esperar ${remainingTime} segundos antes de solicitar otro código`,
    };
  }

  if (resendData.blockedUntil && Date.now() >= resendnData.blockedUntil) {
    resendAttempts.delete(identifier);
  }
};

const recordResendAttempt = (identifier) => {
  const resendData = resendAttempts.get(identifier) || {
    attempts: 0,
    lastAttempt: 0,
    blockedUntil: null,
  };

  resendData.attempts += 1;
  resendData.lastAttempt = Date.now();

  if (resendData.attempts >= 5) {
    resendData.blockedUntil = Date.now() + 10 * 60 * 1000;
    console.log(`🔒 Reenvíos bloqueados para: ${identifier} por 10 minutos`);
  }

  resendAttempts.set(identifier, resendData);
};

// ========== REGISTRO ==========

export const register = async (req, res, next) => {
  try {
    const { nombreCompleto, correoElectronico, telefono, contrasena, canal = 'email' } = req.body;

    console.log("entrando a regiustro")

    const existingUser = await User.findByEmail(correoElectronico);
    if (existingUser) {
      return res.status(400).json({ message: 'Error al registrarse' });
    }

    if (canal === 'sms') {
      await VerificationTemp.deleteByTelefono(telefono, 'Registro');
    } else {
      await VerificationTemp.deleteByEmail(correoElectronico, 'Registro');
    }

    const hashedPassword = await bcrypt.hash(contrasena, 10);
    const verificationCode = Math.floor(100000 + Math.random() * 900000);

    await VerificationTemp.create({
      correoElectronico,
      nombreCompleto,
      telefono,
      contrasena: hashedPassword,
      codigoVerificacion: verificationCode,
      tipo: 'Registro',
      canal,
    });

    

    await VerificationTemp.cleanOldVerifications();
    await sendVerificationCode({ canal, correoElectronico, telefono, nombreCompleto, code: verificationCode });

    res.status(201).json({ message: 'Código de verificación enviado.' });
  } catch (error) {
    console.log(error)
  }
};

// ========== VERIFICAR CÓDIGO ==========

export const verifyEmail = async (req, res, next) => {
  try {
    const { code, correoElectronico, telefono, canal = 'email' } = req.body;

    const identifier = getIdentifier(canal, correoElectronico, telefono);
    console.log('🔍 Verificando:', identifier);

    const verification = await VerificationTemp.findOne(
      canal === 'sms' ? null : correoElectronico,
      'Registro',
      canal === 'sms' ? telefono : null
    );

    if (!verification) {
      return res.status(400).json({ message: 'No hay registro pendiente de verificación' });
    }

    const EXPIRATION_TIME = 4 * 60 * 1000;
    const createdAt = new Date(verification.created_at).getTime();
    if (Date.now() - createdAt > EXPIRATION_TIME) {
      await VerificationTemp.delete(verification.id);
      return res.status(400).json({ message: 'El código de verificación ha expirado' });
    }

    if (code.toString().trim() !== verification.codigo_verificacion.toString().trim()) {
      return res.status(400).json({ message: 'Código incorrecto' });
    }

    const existing = await User.findByEmail(verification.email);
    if (existing) {
      await VerificationTemp.delete(verification.id);
      return res.status(400).json({ message: 'El correo ya está registrado' });
    }

    const newUser = await User.create({
      nombre: verification.nombre,
      email: verification.email,
      telefono: verification.telefono,
      password: verification.password,
    });

    await VerificationTemp.delete(verification.id);

    res.json({
      message: 'Cuenta creada exitosamente.',
    });
  } catch (error) {
    next(error);
  }
};

// ========== REENVIAR CÓDIGO DE REGISTRO ==========

export const resendCode = async (req, res, next) => {
  try {
    const { correoElectronico, telefono, canal = 'email' } = req.body;

    const identifier = getIdentifier(canal, correoElectronico, telefono);
    checkResendLimit(identifier);

    const verification = await VerificationTemp.findOne(
      canal === 'sms' ? null : correoElectronico,
      'Registro',
      canal === 'sms' ? telefono : null
    );

    if (!verification) {
      return res.status(400).json({ message: 'Error al registrarse' });
    }

    const verificationCode = Math.floor(100000 + Math.random() * 900000);

    await VerificationTemp.update(verification.id, {
      codigo_verificacion: verificationCode,
      created_at: new Date(),
    });

    recordResendAttempt(identifier);

    await sendVerificationCode({
      canal: verification.canal,
      correoElectronico: verification.email,
      telefono: verification.telefono,
      nombreCompleto: verification.nombre,
      code: verificationCode,
    });

    res.json({ message: 'Nuevo código enviado.' });
  } catch (error) {
    next(error);
  }
};

// ========== LOGIN ==========

export const login = async (req, res, next) => {
  try {
    const { correoElectronico, contrasena } = req.body;

    checkIfBlocked(correoElectronico);

    const user = await User.findByEmail(correoElectronico);

    if (!user) {
      recordFailedAttempt(correoElectronico);
      return res.status(401).json({ message: 'Credenciales incorrectas' });
    }

    const isMatch = await bcrypt.compare(contrasena, user.password);
    if (!isMatch) {
      recordFailedAttempt(correoElectronico);
      return res.status(401).json({ message: 'Credenciales incorrectas' });
    }

    clearFailedAttempts(correoElectronico);

    const token = createToken(user);

    if (req.session) {
      req.session.user = {
        id: user.id,
        nombre: user.nombre,
        email: user.email,
      };
    }

    res.json({
      message: 'Inicio de sesión exitoso',
      token,
      user: {
        id: user.id,
        nombre: user.nombre,
        email: user.email,
        rol: user.rol,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ========== LOGIN CON GOOGLE ==========

export const googleAuth = async (req, res, next) => {
  try {
    const { googleToken } = req.body;

    console.log("Token google", googleToken)

    const response = await axios.get(
      'https://www.googleapis.com/oauth2/v3/userinfo',
      {
        headers: {
          Authorization: `Bearer ${googleToken}`,
        },
      }
    );

    const payload = response.data;

    console.log(payload)

    if (!payload || !payload.email) {
      return res.status(400).json({ message: 'Token de Google inválido' });
    }

    const { email, name, sub } = payload;

    console.log(name)

    let user = await User.findByEmail(email);

    if (!user) {
      const hashedPassword = await bcrypt.hash(sub, 10);

      user = await User.create({
        nombre: name,
        email: email,
        telefono: null,
        password: hashedPassword,
      });
    }

    clearFailedAttempts(email);

    const token = createToken(user);

    if (req.session) {
      req.session.user = {
        id: user.id,
        nombre: user.nombre,
        email: user.email,
      };
    }

    const roleMap = {
      1: "Admin",
      2: "Barbero",
      3: "Cliente",
    };

    res.json({
      message: 'Inicio de sesión con Google exitoso',
      token,
      user: {
        id: user.id,
        nombre: user.nombre,
        email: user.email,
        rol: roleMap[user.rol_id] || "Cliente",
      }
    });
  } catch (error) {
    next(error);
  }
};

// ========== RECUPERACIÓN DE CONTRASEÑA ==========

export const forgotPassword = async (req, res, next) => {
  try {
    const { correoElectronico, telefono, canal = 'email' } = req.body;

    const user = await User.findByEmail(correoElectronico);
    if (!user) {
      return res.status(404).json({ message: 'No existe una cuenta con ese correo' });
    }

    const telefonoDestino = telefono || user.telefono;

    if (canal === 'sms') {
      await VerificationTemp.deleteByTelefono(telefonoDestino, 'Recuperacion');
    } else {
      await VerificationTemp.deleteByEmail(correoElectronico, 'Recuperacion');
    }

    const recoveryCode = Math.floor(100000 + Math.random() * 900000);

    await VerificationTemp.create({
      correoElectronico: correoElectronico, // 👈 nombre correcto
      nombreCompleto: user.nombre,
      telefono: telefonoDestino,
      contrasena: null, // 👈 nombre correcto
      codigoVerificacion: recoveryCode,
      tipo: 'Recuperacion',
      userId: user.id,
      canal,
    });

    await sendRecoveryCode({
      canal,
      correoElectronico,
      telefono: telefonoDestino,
      nombreCompleto: user.nombre,
      code: recoveryCode,
    });

    res.json({ message: 'Código de recuperación enviado.' });
  } catch (error) {
    console.log(error)
    next(error);
  }
};

// ========== VERIFICAR CÓDIGO DE RECUPERACIÓN ==========

export const verifyRecoveryCode = async (req, res, next) => {
  try {
    const { code, correoElectronico, telefono, canal = 'email' } = req.body;

   
    console.log("Codigo enviado", code, "correo enviado", correoElectronico)
    const verification = await VerificationTemp.findOne(
      canal === 'sms' ? null : correoElectronico,
      'Recuperacion',
      canal === 'sms' ? telefono : null
    );

    if (!verification) {
      return res.status(400).json({ message: 'No hay solicitud de recuperación activa' });
    }

    const EXPIRATION_TIME = 10 * 60 * 1000;
    const createdAt = new Date(verification.created_at).getTime();
    if (Date.now() - createdAt > EXPIRATION_TIME) {
      await VerificationTemp.delete(verification.id);
      return res.status(400).json({ message: 'El código de recuperación ha expirado' });
    }

    if (code !== verification.codigo_verificacion) {
      return res.status(400).json({ message: 'Código incorrecto' });
    }

    await VerificationTemp.update(verification.id, { verificado: true });

    res.json({ message: 'Código verificado correctamente' });
  } catch (error) {
    console.log(error)
    next(error);
  }
};

// ========== RESETEAR CONTRASEÑA ==========

export const resetPassword = async (req, res, next) => {
  try {
    const { newPassword, correoElectronico, telefono, canal = 'email' } = req.body;

    const verification = await VerificationTemp.findVerified(
      canal === 'sms' ? null : correoElectronico,
      'Recuperacion',
      canal === 'sms' ? telefono : null
    );

    if (!verification) {
      return res.status(400).json({ message: 'No hay solicitud de recuperación activa' });
    }

    const EXPIRATION_TIME = 10 * 60 * 1000;
    const createdAt = new Date(verification.created_at).getTime();
    if (Date.now() - createdAt > EXPIRATION_TIME) {
      await VerificationTemp.delete(verification.id);
      return res.status(400).json({ message: 'La sesión ha expirado' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await User.update(verification.user_id, { password: hashedPassword });

    const user = await User.findById(verification.user_id);
    if (!user) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    await sendPasswordChangedNotification({
      canal: verification.canal,
      correoElectronico: verification.email,
      telefono: verification.telefono,
      nombreCompleto: user.nombre,
    });

    await VerificationTemp.delete(verification.id);

    res.json({ message: 'Contraseña actualizada exitosamente' });
  } catch (error) {
    next(error);
  }
};

// ========== REENVIAR CÓDIGO DE RECUPERACIÓN ==========

export const resendRecoveryCode = async (req, res, next) => {
  try {
    const { correoElectronico, telefono, canal = 'email' } = req.body;

    const identifier = getIdentifier(canal, correoElectronico, telefono);
    checkResendLimit(identifier);

    const verification = await VerificationTemp.findOne(
      canal === 'sms' ? null : correoElectronico,
      'Recuperacion',
      canal === 'sms' ? telefono : null
    );

    if (!verification) {
      return res.status(400).json({ message: 'No hay solicitud de recuperación activa' });
    }

    const recoveryCode = Math.floor(100000 + Math.random() * 900000);

    await VerificationTemp.update(verification.id, {
      codigo_verificacion: recoveryCode,
      created_at: new Date(),
      verificado: false,
    });

    recordResendAttempt(identifier);

    const user = await User.findById(verification.user_id);
    if (!user) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    await sendRecoveryCode({
      canal: verification.canal,
      correoElectronico: verification.email,
      telefono: verification.telefono,
      nombreCompleto: user.nombre,
      code: recoveryCode,
    });

    res.json({ message: 'Nuevo código enviado.' });
  } catch (error) {
    next(error);
  }
};

// ========== PERFIL ==========

export const getProfile = async (req, res) => {
  res.json({
    message: 'Perfil obtenido exitosamente',
    user: req.user,
  });
};