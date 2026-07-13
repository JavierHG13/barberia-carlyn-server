export const validateRegister = (req, res, next) => {
  const { nombreCompleto, correoElectronico, telefono, contrasena } = req.body;

  if (!nombreCompleto || !correoElectronico || !telefono || !contrasena) {
    return res.status(400).json({ message: 'Todos los campos son requeridos' });
  }

  if (contrasena.length < 6) {
    return res.status(400).json({ message: 'La contraseña debe tener al menos 6 caracteres' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(correoElectronico)) {
    return res.status(400).json({ message: 'Correo electrónico inválido' });
  }

  next();
};

export const validateLogin = (req, res, next) => {
  const { correoElectronico, contrasena} = req.body; 

  console.log("Entrando a validacion")
  
  console.log(req.body)
  if (!correoElectronico || !contrasena) {
    return res.status(400).json({ message: 'Correo y contraseña son requeridos' });
  }

  next();
};

export const validateEmail = (req, res, next) => {
  const { correoElectronico } = req.body;

  if (!correoElectronico) {
    return res.status(400).json({ message: 'El correo electrónico es requerido' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(correoElectronico)) {
    return res.status(400).json({ message: 'Correo electrónico inválido' });
  }

  next();
};

export const validateCode = (req, res, next) => {
  const { code, correoElectronico } = req.body;

  if (!code || !correoElectronico) {
    return res.status(400).json({ message: 'Código y correo son requeridos' });
  }

  next();
};

export const validateResetPassword = (req, res, next) => {
  const { newPassword, correoElectronico } = req.body;

  if (!newPassword || !correoElectronico) {
    return res.status(400).json({ message: 'Nueva contraseña y correo son requeridos' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ message: 'La contraseña debe tener al menos 6 caracteres' });
  }

  next();
};