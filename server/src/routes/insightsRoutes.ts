import { Router } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { getInsights, getUserInsights, exportInsightsCsv } from '../controllers/insightsController.js';
import {
  validateInsightsQuery,
  validateUserInsightsQuery,
} from '../middleware/insightsValidation.js';

const router = Router();

// All insights routes require admin access
router.use(authenticate, requireAdmin);

router.get('/', validateInsightsQuery, getInsights);
router.get('/export', validateInsightsQuery, exportInsightsCsv);
router.get('/user/:userId', validateUserInsightsQuery, getUserInsights);

export default router;
