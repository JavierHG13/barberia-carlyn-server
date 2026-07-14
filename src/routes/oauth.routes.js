import express from 'express';
import axios from 'axios';

const router = express.Router();

// Mismo backend, solo le pegamos a nuestro propio /api/auth/login
const SELF_BASE_URL = process.env.BASE_URL || 'https://localhost:4000';

// Redirect URIs que Amazon te da al guardar el Account Linking (los 3)
const REDIRECT_URIS_PERMITIDOS = [
  'https://pitangui.amazon.com/spa/skill/account-linking-status.html?vendorId=M2I590XNE3TWZU',
  'https://layla.amazon.com/spa/skill/account-linking-status.html?vendorId=M2I590XNE3TWZU',
  'https://alexa.amazon.co.jp/spa/skill/account-linking-status.html?vendorId=M2I590XNE3TWZU',
];

// GET /oauth/authorize?redirect_uri=...&state=...&response_type=token&client_id=...
router.get('/authorize', (req, res) => {

  console.log("Revisando que trae query:", req.query);

  const { redirect_uri, state } = req.query;

  if (!REDIRECT_URIS_PERMITIDOS.includes(redirect_uri)) {
    return res.status(400).send('redirect_uri inválido');
  }

  res.send(`
    <html><body style="font-family:sans-serif;max-width:320px;margin:60px auto">
      <h2>Barbería Carlyn</h2>
      <p id="err" style="color:red"></p>
      <form method="POST" action="/oauth/authorize">
        <input type="hidden" name="redirect_uri" value="${redirect_uri}">
        <input type="hidden" name="state" value="${state || ''}">
        <input name="correoElectronico" type="email" placeholder="Correo" required
               style="width:100%;margin:6px 0;padding:8px;box-sizing:border-box"><br>
        <input name="contrasena" type="password" placeholder="Contraseña" required
               style="width:100%;margin:6px 0;padding:8px;box-sizing:border-box"><br>
        <button type="submit" style="width:100%;padding:10px">Vincular cuenta</button>
      </form>
    </body></html>
  `);
});

// POST /oauth/authorize — reusa tu /api/auth/login existente (con su rate-limit y todo)
router.post('/authorize', express.urlencoded({ extended: true }), async (req, res) => {
  const { correoElectronico, contrasena, redirect_uri, state } = req.body;

  if (!REDIRECT_URIS_PERMITIDOS.includes(redirect_uri)) {
    return res.status(400).send('redirect_uri inválido');
  }

  try {
    const { data } = await axios.post(`${SELF_BASE_URL}/api/auth/login`, {
      correoElectronico,
      contrasena,
    });

    const token = data.token; // el JWT que ya genera createToken()
    const redirectUrl = `${redirect_uri}#access_token=${encodeURIComponent(token)}&token_type=Bearer&state=${encodeURIComponent(state || '')}`;
    res.redirect(redirectUrl);
  } catch (error) {
    const msg = error.response?.data?.message || 'Error al iniciar sesión';
    res.status(401).send(`
      <p style="color:red;font-family:sans-serif">${msg}</p>
      <a href="javascript:history.back()">Volver a intentar</a>
    `);
  }
});

export default router;