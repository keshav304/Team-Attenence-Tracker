import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { getTodayStatus } from '../controllers/statusController';

const router = Router();

// Any authenticated user can see today's status
router.get('/today', authenticate, getTodayStatus);

export default router;
