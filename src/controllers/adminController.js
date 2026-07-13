import User from '../models/user.js';

const parsePositiveInt = (value) => {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
};

export const listUsers = async (req, res, next) => {
  try {
    const page = parsePositiveInt(req.query.page) || 1;
    const limit = parsePositiveInt(req.query.limit) || 10;
    const safeLimit = Math.min(limit, 100);
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const offset = (page - 1) * safeLimit;

    const [users, total] = await Promise.all([
      User.findAll({ limit: safeLimit, offset, search }),
      User.countAll({ search }),
    ]);

    res.json({
      message: 'Usuarios obtenidos correctamente',
      data: users,
      pagination: {
        page,
        limit: safeLimit,
        total,
        totalPages: Math.max(1, Math.ceil(total / safeLimit)),
      },
    });
  } catch (error) {
    next(error);
  }
};

export const getUserById = async (req, res, next) => {
  try {
    const userId = parsePositiveInt(req.params.id);
    if (!userId) {
      return res.status(400).json({ message: 'ID de usuario invalido' });
    }

    const user = await User.findByIdAdmin(userId);
    if (!user) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    res.json({
      message: 'Usuario obtenido correctamente',
      data: user,
    });
  } catch (error) {
    next(error);
  }
};

export const updateUserRole = async (req, res, next) => {
  try {
    const userId = parsePositiveInt(req.params.id);
    const roleId = Number.parseInt(req.body.idRol, 10);

    if (!userId) {
      return res.status(400).json({ message: 'ID de usuario invalido' });
    }

    if (![1, 2, 3].includes(roleId)) {
      return res.status(400).json({ message: 'El rol es invalido. Usa 1 (admin), 2 (cliente) o 3 (barbero)' });
    }

    if (req.user.sub === userId) {
      return res.status(400).json({ message: 'No puedes cambiar tu propio rol' });
    }

    const existingUser = await User.findById(userId);
    if (!existingUser) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    const updatedUser = await User.updateRole(userId, roleId);

    res.json({
      message: 'Rol actualizado correctamente',
      data: updatedUser,
    });
  } catch (error) {
    next(error);
  }
};

export const deleteUser = async (req, res, next) => {
  try {
    const userId = parsePositiveInt(req.params.id);
    if (!userId) {
      return res.status(400).json({ message: 'ID de usuario invalido' });
    }

    if (req.user.sub === userId) {
      return res.status(400).json({ message: 'No puedes eliminar tu propio usuario' });
    }

    const existingUser = await User.findById(userId);
    if (!existingUser) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    await User.deleteById(userId);

    res.json({
      message: 'Usuario eliminado correctamente',
    });
  } catch (error) {
    next(error);
  }
};
