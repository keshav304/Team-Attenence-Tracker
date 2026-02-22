import { Router } from 'express';
import {
  getTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
} from '../controllers/templateController.js';
import { authenticate } from '../middleware/auth.js';
import { validateCreateTemplate, validateTemplateIdParam, validateUpdateTemplate } from '../middleware/templateValidation.js';

const router = Router();

router.use(authenticate);

router.get('/', getTemplates);
router.post('/', validateCreateTemplate, createTemplate);
router.put('/:id', validateTemplateIdParam, validateUpdateTemplate, updateTemplate);
router.delete('/:id', validateTemplateIdParam, deleteTemplate);

export default router;
