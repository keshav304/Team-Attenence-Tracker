import { Router } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth';
import { getInsights } from '../controllers/insightsController';

const router = Router();

// All insights routes require admin access
router.use(authenticate, requireAdmin);

router.get('/', getInsights);

export default router;
