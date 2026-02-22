import { Router } from 'express';
import {
  subscribe,
  unsubscribe,
  getStatus,
  updatePreferences,
} from '../controllers/pushController.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// All push routes require authentication
router.use(authenticate);

// Subscribe / Unsubscribe
router.post('/subscribe', subscribe);
router.delete('/subscribe', unsubscribe);

// Status & preferences
router.get('/status', getStatus);
router.put('/preferences', updatePreferences);

export default router;
