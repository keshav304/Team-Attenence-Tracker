import { Router } from 'express';
import { register, login, getMe, updateProfile, changePassword } from '../controllers/authController.js';
import { authenticate } from '../middleware/auth.js';
import {
  validateRegister,
  validateLogin,
  validateUpdateProfile,
  validateChangePassword,
} from '../middleware/authValidation.js';

const router = Router();

router.post('/register', validateRegister, register);
router.post('/login', validateLogin, login);
router.get('/me', authenticate, getMe);
router.put('/profile', authenticate, validateUpdateProfile, updateProfile);
router.put('/change-password', authenticate, validateChangePassword, changePassword);

export default router;
