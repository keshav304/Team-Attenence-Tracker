import { Router } from 'express';
import {
  upsertEntry,
  deleteEntry,
  getMyEntries,
  getTeamEntries,
  adminUpsertEntry,
  adminDeleteEntry,
  bulkSetEntries,
  copyFromDate,
  repeatPattern,
  copyRange,
  getTeamSummary,
} from '../controllers/entryController.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import {
  validateUpsertEntry,
  validateAdminUpsertEntry,
  validateDeleteEntry,
  validateAdminDeleteEntry,
  validateBulkSet,
  validateCopyFromDate,
  validateRepeatPattern,
  validateCopyRange,
  validateGetMyEntries,
  validateTeamQuery,
} from '../middleware/entryValidation.js';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Team view
router.get('/team', validateTeamQuery, getTeamEntries);

// Team availability summary
router.get('/team-summary', validateTeamQuery, getTeamSummary);

// Current user's entries
router.get('/', validateGetMyEntries, getMyEntries);

// Set/update own entry
router.put('/', validateUpsertEntry, upsertEntry);

// Bulk operations
router.post('/bulk', validateBulkSet, bulkSetEntries);
router.post('/copy', validateCopyFromDate, copyFromDate);
router.post('/repeat', validateRepeatPattern, repeatPattern);
router.post('/copy-range', validateCopyRange, copyRange);

// Delete own entry (revert to WFH)
router.delete('/:date', validateDeleteEntry, deleteEntry);

// Admin: set/update entry for any user
router.put('/admin', requireAdmin, validateAdminUpsertEntry, adminUpsertEntry);

// Admin: delete entry for any user
router.delete('/admin/:userId/:date', requireAdmin, validateAdminDeleteEntry, adminDeleteEntry);

export default router;
