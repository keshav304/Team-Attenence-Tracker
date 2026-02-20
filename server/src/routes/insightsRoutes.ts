import { Router } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth';
import { getInsights, getUserInsights, exportInsightsCsv } from '../controllers/insightsController';

const router = Router();

// All insights routes require admin access
router.use(authenticate, requireAdmin);

router.get('/', getInsights);
router.get('/export', exportInsightsCsv);
router.get('/user/:userId', getUserInsights);

export default router;
