import emailService from './emailService.js';
import smsService from './smsService.js';

export const sendVerificationCode = async ({ canal, correoElectronico, telefono, nombreCompleto, code }) => {
  if (canal === 'sms') {
    await smsService.sendVerificationSMS(telefono, code);
  } else {
    await emailService.sendVerificationEmail(correoElectronico, nombreCompleto, code);
  }
};

export const sendRecoveryCode = async ({ canal, correoElectronico, telefono, nombreCompleto, code }) => {
  if (canal === 'sms') {
    await smsService.sendPasswordRecoverySMS(telefono, code);
  } else {
    await emailService.sendPasswordRecoveryEmail(correoElectronico, nombreCompleto, code);
  }
};

export const sendPasswordChangedNotification = async ({ canal, correoElectronico, telefono, nombreCompleto }) => {
  if (canal === 'sms') {
    await smsService.sendPasswordChangedSMS(telefono);
  } else {
    await emailService.sendPasswordChangedEmail(correoElectronico, nombreCompleto);
  }
};