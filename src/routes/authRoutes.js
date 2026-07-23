import express from 'express';
import * as authController from '../controllers/authController.js';
import { verifyToken } from '../middlewares/auth.middleware.js';
import {
  validateRegister,
  validateLogin,
  validateEmail,
  validateCode,
  validateResetPassword,
} from '../middlewares/validateRequest.js';

const router = express.Router();

router.post('/register', validateRegister, authController.register);
router.post('/verify-email', validateCode, authController.verifyEmail);
router.post('/resend-code', validateEmail, authController.resendCode);
router.post('/login', validateLogin, authController.login);
router.post('/google', authController.googleAuth);
router.post('/forgot-password', validateEmail, authController.forgotPassword);
router.post('/verify-recovery-code', validateCode, authController.verifyRecoveryCode);
router.post('/reset-password', validateResetPassword, authController.resetPassword);
router.post('/resend-recovery-code', validateEmail, authController.resendRecoveryCode);
router.get('/profile', verifyToken, authController.getProfile);
router.put('/profile', verifyToken, authController.updateProfile);
router.get('/verificar-correo', authController.verificarCorreo);

export default router;
