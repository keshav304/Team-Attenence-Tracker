import { Router } from 'express';
import { chat } from '../controllers/chatController.js';
import { authenticate } from '../middleware/auth.js';
import { validateChat } from '../middleware/chatValidation.js';

const router = Router();

// Require authentication so only logged-in users can query the assistant
router.post('/', authenticate, validateChat, chat);

export default router;
