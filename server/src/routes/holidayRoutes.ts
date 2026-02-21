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

// Anyone authenticated can view holidays
router.get('/', authenticate, getHolidays);

// Only admins can manage holidays
router.post('/', authenticate, requireAdmin, validateCreateHoliday, createHoliday);
router.put('/:id', authenticate, requireAdmin, validateUpdateHoliday, updateHoliday);
router.delete('/:id', authenticate, requireAdmin, deleteHoliday);

export default router;
