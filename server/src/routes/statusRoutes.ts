import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { getTodayStatus } from '../controllers/statusController.js';

const router = Router();

// All status routes require authentication
router.use(authenticate);

router.get('/today', getTodayStatus);

export default router;
