import { Router } from 'express';
import {
  getAllUsers,
  createUser,
  updateUser,
  resetUserPassword,
  deleteUser,
} from '../controllers/adminController.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import {
  validateCreateUser,
  validateUpdateUser,
  validateResetPassword,
  validateUserIdParam,
} from '../middleware/adminValidation.js';

const router = Router();

router.use(authenticate, requireAdmin);

router.get('/users', getAllUsers);
router.post('/users', validateCreateUser, createUser);
router.put('/users/:id', validateUpdateUser, updateUser);
router.put('/users/:id/reset-password', validateResetPassword, resetUserPassword);
router.delete('/users/:id', validateUserIdParam, deleteUser);

export default router;
