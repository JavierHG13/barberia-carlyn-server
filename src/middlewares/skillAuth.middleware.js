export const verifySkillKey = (req, res, next) => {
  const expectedKey = process.env.SKILL_API_KEY;

  if (!expectedKey && process.env.NODE_ENV !== 'production') {
    return next();
  }

  if (!expectedKey || req.headers['x-skill-key'] !== expectedKey) {
    return res.status(403).json({ message: 'No autorizado' });
  }

  next();
};
