import twilio from 'twilio';

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

const sendVerificationSMS = async (telefono, code) => {
  await client.messages.create({
    body: `Tu código de verificación es: ${code}. Expira en 4 minutos.`,
    from: process.env.TWILIO_PHONE_NUMBER,
    to: telefono,
  });
};

const sendPasswordRecoverySMS = async (telefono, code) => {
  await client.messages.create({
    body: `Tu código de recuperación es: ${code}. Expira en 4 minutos.`,
    from: process.env.TWILIO_PHONE_NUMBER,
    to: telefono,
  });
};

export default { sendVerificationSMS, sendPasswordRecoverySMS };