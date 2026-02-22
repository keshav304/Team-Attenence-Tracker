import { Router } from 'express';
import {
  getEvents,
  createEvent,
  updateEvent,
  deleteEvent,
  rsvpToEvent,
} from '../controllers/eventController.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import {
  validateCreateEvent,
  validateUpdateEvent,
  validateEventId,
} from '../middleware/eventValidation.js';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Any user can view events
router.get('/', getEvents);

// Any authenticated user can RSVP
router.post('/:eventId/rsvp', rsvpToEvent);

// Admin-only: create, update, delete
router.post('/', requireAdmin, validateCreateEvent, createEvent);
router.put('/:id', requireAdmin, validateEventId, validateUpdateEvent, updateEvent);
router.delete('/:id', requireAdmin, validateEventId, deleteEvent);

export default router;
