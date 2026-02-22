import { Router } from 'express';
import {
  getHolidays,
  createHoliday,
  updateHoliday,
  deleteHoliday,
} from '../controllers/holidayController.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import {
  validateCreateHoliday,
  validateUpdateHoliday,
} from '../middleware/holidayValidation.js';

const router = Router();

// All holiday routes require authentication
router.use(authenticate);

// Anyone authenticated can view holidays
router.get('/', getHolidays);

// Only admins can manage holidays
router.post('/', requireAdmin, validateCreateHoliday, createHoliday);
router.put('/:id', requireAdmin, validateUpdateHoliday, updateHoliday);
router.delete('/:id', requireAdmin, deleteHoliday);

export default router;
