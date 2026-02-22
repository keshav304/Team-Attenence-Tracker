import { Router } from 'express';
import { toggleFavorite, getFavorites } from '../controllers/favoritesController.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

router.use(authenticate);

// Get favorites list
router.get('/favorites', getFavorites);

// Toggle favorite
router.post('/favorites/:targetUserId', toggleFavorite);

export default router;
