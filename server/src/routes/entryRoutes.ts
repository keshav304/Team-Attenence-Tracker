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
} from '../controllers/entryController';
import { authenticate, requireAdmin } from '../middleware/auth';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Team view
router.get('/team', getTeamEntries);

// Team availability summary
router.get('/team-summary', getTeamSummary);

// Current user's entries
router.get('/', getMyEntries);

// Set/update own entry
router.put('/', upsertEntry);

// Bulk operations
router.post('/bulk', bulkSetEntries);
router.post('/copy', copyFromDate);
router.post('/repeat', repeatPattern);
router.post('/copy-range', copyRange);

// Delete own entry (revert to WFH)
router.delete('/:date', deleteEntry);

// Admin: set/update entry for any user
router.put('/admin', requireAdmin, adminUpsertEntry);

// Admin: delete entry for any user
router.delete('/admin/:userId/:date', requireAdmin, adminDeleteEntry);

export default router;
