import { Router } from 'express';
import {
  getTemplates,
  createTemplate,
  deleteTemplate,
} from '../controllers/templateController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.get('/', getTemplates);
router.post('/', createTemplate);
router.delete('/:id', deleteTemplate);

export default router;
