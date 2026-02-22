import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { getMonthlyInsights } from '../controllers/myInsightsController.js';
import { validateMonthlyInsightsQuery } from '../middleware/myInsightsValidation.js';

const router = Router();

// All routes require authentication (any member or admin)
router.use(authenticate);

router.get('/monthly', validateMonthlyInsightsQuery, getMonthlyInsights);

export default router;
