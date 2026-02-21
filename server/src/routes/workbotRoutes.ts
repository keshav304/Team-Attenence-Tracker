import { Router } from 'express';
import { parseCommand, resolvePlan, applyChanges } from '../controllers/workbotController.js';
import { authenticate } from '../middleware/auth.js';
import {
  validateParse,
  validateResolve,
  validateApply,
  applyRateLimiter,
} from '../middleware/workbotValidation.js';

const router = Router();

// All workbot routes require authentication
router.use(authenticate);

// Step 1: Parse natural language command into structured plan
router.post('/parse', validateParse, parseCommand);

// Step 2: Resolve structured plan into concrete dated changes
router.post('/resolve', validateResolve, resolvePlan);

// Step 3: Apply confirmed changes (rate-limited + validated)
router.post('/apply', applyRateLimiter, validateApply, applyChanges);

export default router;
