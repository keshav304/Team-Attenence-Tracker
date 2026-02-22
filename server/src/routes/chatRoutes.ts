import { Router } from 'express';
import { chat } from '../controllers/chatController.js';
import { authenticate } from '../middleware/auth.js';
import { validateChat } from '../middleware/chatValidation.js';

const router = Router();

// All chat routes require authentication
router.use(authenticate);

router.post('/', validateChat, chat);

export default router;
