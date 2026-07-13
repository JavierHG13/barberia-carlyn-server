import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

class EmailService {
  constructor() {

    console.log(process.env.EMAIL_USER, " y ", process.env.EMAIL_PASS)
    this.transporter = nodemailer.createTransport({
      service: 'gmail',
      secure: false,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });
  }

  async sendVerificationEmail(email, name, code) {
    await this.transporter.sendMail({
      from: `"Barbería Carlyn - Soporte" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Verificación de correo',
      html: `
        <h2>Hola ${name} 👋</h2>
        <p>Bienvenido a <strong>Barbería Carlyn</strong>.</p>
        <p>Tu código de verificación es:</p>
        <h3>${code}</h3>
        <p>Ingresa este código en la aplicación para activar tu cuenta.</p>
      `,
    });
  }

  async sendPasswordRecoveryEmail(email, name, code) {
    await this.transporter.sendMail({
      from: `"Barbería Carlyn - Soporte" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Barbería Carlyn – Recuperación de contraseña',
      html: `
        <h2>Hola ${name}</h2>
        <p>Has solicitado recuperar tu contraseña de <strong>Barbería Carlyn</strong>.</p>
        <p>Tu código de recuperación es:</p>
        <h3>${code}</h3>
        <p>Ingresa este código en la aplicación para restablecer tu contraseña.</p>
        <p><small>Este código expira en 10 minutos.</small></p>
        <p><small>Si no solicitaste esto, ignora este mensaje.</small></p>
      `,
    });
  }

  async sendPasswordChangedEmail(email, name) {
    await this.transporter.sendMail({
      from: `"Barbería Carlyn - Soporte" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Tu contraseña ha sido actualizada',
      html: `
        <h2>Hola ${name}</h2>
        <p>Queremos informarte que tu contraseña ha sido actualizada exitosamente.</p>
        <p>Si no realizaste este cambio, contacta inmediatamente con soporte.</p>
      `,
    });
  }


  async sendBackupNotification({ config, backup, proximo_respaldo, error, success }) {
    const transporter = createTransporter();

    const subject = success
      ? `Backup automático completado — ${config.nombre}`
      : `Backup automático fallido — ${config.nombre}`;

    const html = success
      ? buildSuccessHtml({ config, backup, proximo_respaldo })
      : buildErrorHtml({ config, error });

    const recipients = Array.isArray(config.emails_notificacion)
      ? config.emails_notificacion.join(', ')
      : config.emails_notificacion;

    await transporter.sendMail({
      from: process.env.MAIL_FROM || `"Sistema de Backups" <${process.env.MAIL_USER}>`,
      to: recipients,
      subject,
      html,
    });

    console.log(`📧 [Mailer] Notificación enviada a: ${recipients}`);
  }

  async buildSuccessHtml({ config, backup, proximo_respaldo }) {
    return `
    <div style="font-family:sans-serif;max-width:560px;margin:auto;color:#222">
      <h2 style="color:#16a34a">✅ Backup completado exitosamente</h2>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <tr><td style="padding:6px 0;color:#555">Configuración</td><td><strong>${config.nombre}</strong></td></tr>
        <tr><td style="padding:6px 0;color:#555">Archivo</td><td>${backup.nombre_archivo}</td></tr>
        <tr><td style="padding:6px 0;color:#555">Tamaño</td><td>${backup.tamaño_legible}</td></tr>
        <tr><td style="padding:6px 0;color:#555">Fecha</td><td>${new Date().toLocaleString('es-MX')}</td></tr>
        ${proximo_respaldo ? `<tr><td style="padding:6px 0;color:#555">Próximo respaldo</td><td>${new Date(proximo_respaldo).toLocaleString('es-MX')}</td></tr>` : ''}
        <tr><td style="padding:6px 0;color:#555">Descarga</td><td><a href="${backup.url_descarga}">Ver en Cloudinary</a></td></tr>
      </table>
      <p style="margin-top:24px;font-size:12px;color:#999">Este es un mensaje automático del sistema de backups.</p>
    </div>
  `;
  }

  async buildErrorHtml({ config, error }) {
    return `
    <div style="font-family:sans-serif;max-width:560px;margin:auto;color:#222">
      <h2 style="color:#dc2626">❌ El backup automático falló</h2>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <tr><td style="padding:6px 0;color:#555">Configuración</td><td><strong>${config.nombre}</strong></td></tr>
        <tr><td style="padding:6px 0;color:#555">Fecha</td><td>${new Date().toLocaleString('es-MX')}</td></tr>
        <tr><td style="padding:6px 0;color:#555">Error</td><td style="color:#dc2626">${error}</td></tr>
      </table>
      <p style="margin-top:16px;font-size:13px;color:#555">Revisa los logs del servidor para más detalles.</p>
      <p style="margin-top:24px;font-size:12px;color:#999">Este es un mensaje automático del sistema de backups.</p>
    </div>
  `;
  }
}

export default new EmailService();