import { Router } from 'express';
import {
  getTemplates,
  createTemplate,
  deleteTemplate,
} from '../controllers/templateController.js';
import { authenticate } from '../middleware/auth.js';
import { validateCreateTemplate, validateTemplateIdParam } from '../middleware/templateValidation.js';

const router = Router();

router.use(authenticate);

router.get('/', getTemplates);
router.post('/', validateCreateTemplate, createTemplate);
router.delete('/:id', validateTemplateIdParam, deleteTemplate);

export default router;
