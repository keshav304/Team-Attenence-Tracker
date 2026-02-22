import { Router } from 'express';
import { matchPreview, matchApply } from '../controllers/scheduleController.js';
import { authenticate } from '../middleware/auth.js';
import { validateMatchPreviewInput, validateMatchApplyInput } from '../middleware/scheduleValidation.js';

const router = Router();

router.use(authenticate);

// Match preview
router.post('/match-preview', validateMatchPreviewInput, matchPreview);

// Match apply
router.post('/match-apply', validateMatchApplyInput, matchApply);

export default router;
