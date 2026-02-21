import { Response } from 'express';
import Template from '../models/Template.js';
import { AuthRequest } from '../types/index.js';
import { sanitizeText } from '../utils/sanitize.js';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/* sanitizeText is now imported from ../utils/sanitize.js */

/**
 * Get all templates for the logged-in user.
 * GET /api/templates
 */
export const getTemplates = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const templates = await Template.find({ userId: req.user!._id }).sort({ name: 1 });
    res.json({ success: true, data: templates });
  } catch (error: any) {
    console.error('getTemplates error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * Create a new template.
 * POST /api/templates
 */
export const createTemplate = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const { name, status, startTime, endTime, note } = req.body;

    if (!name || !name.trim()) {
      res.status(400).json({ success: false, message: 'Template name is required' });
      return;
    }

    if (!['office', 'leave'].includes(status)) {
      res.status(400).json({ success: false, message: 'Status must be "office" or "leave"' });
      return;
    }

    if (startTime && !TIME_RE.test(startTime)) {
      res.status(400).json({ success: false, message: 'startTime must be in HH:mm format' });
      return;
    }
    if (endTime && !TIME_RE.test(endTime)) {
      res.status(400).json({ success: false, message: 'endTime must be in HH:mm format' });
      return;
    }
    if (startTime && endTime && endTime <= startTime) {
      res.status(400).json({ success: false, message: 'endTime must be after startTime' });
      return;
    }
    if ((startTime && !endTime) || (!startTime && endTime)) {
      res.status(400).json({ success: false, message: 'Both startTime and endTime must be provided together' });
      return;
    }

    const template = await Template.create({
      userId: req.user!._id,
      name: sanitizeText(name),
      status,
      startTime: startTime || undefined,
      endTime: endTime || undefined,
      note: note ? sanitizeText(note) : undefined,
    });

    res.status(201).json({ success: true, data: template });
  } catch (error: any) {
    if (error.code === 11000) {
      res.status(409).json({ success: false, message: 'A template with that name already exists' });
      return;
    }
    console.error('createTemplate error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * Update a template.
 * PUT /api/templates/:id
 */
export const updateTemplate = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const { name, status, startTime, endTime, note } = req.body;

    const update: Record<string, any> = {};
    if (name !== undefined) {
      if (!name.trim()) { res.status(400).json({ success: false, message: 'Template name cannot be empty' }); return; }
      update.name = sanitizeText(name);
    }
    if (status !== undefined) {
      if (!['office', 'leave'].includes(status)) { res.status(400).json({ success: false, message: 'Status must be "office" or "leave"' }); return; }
      update.status = status;
    }
    if (startTime !== undefined) update.startTime = startTime || undefined;
    if (endTime !== undefined) update.endTime = endTime || undefined;
    if (note !== undefined) update.note = note ? sanitizeText(note) : undefined;

    // Validate time pair
    const finalStart = update.startTime !== undefined ? update.startTime : undefined;
    const finalEnd = update.endTime !== undefined ? update.endTime : undefined;
    if (finalStart && !TIME_RE.test(finalStart)) { res.status(400).json({ success: false, message: 'startTime must be in HH:mm format' }); return; }
    if (finalEnd && !TIME_RE.test(finalEnd)) { res.status(400).json({ success: false, message: 'endTime must be in HH:mm format' }); return; }
    if (finalStart && finalEnd && finalEnd <= finalStart) { res.status(400).json({ success: false, message: 'endTime must be after startTime' }); return; }

    const template = await Template.findOneAndUpdate(
      { _id: req.params.id, userId: req.user!._id },
      { $set: update },
      { new: true, runValidators: true }
    );

    if (!template) { res.status(404).json({ success: false, message: 'Template not found' }); return; }

    res.json({ success: true, data: template });
  } catch (error: any) {
    if (error.code === 11000) {
      res.status(409).json({ success: false, message: 'A template with that name already exists' });
      return;
    }
    console.error('updateTemplate error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * Delete a template.
 * DELETE /api/templates/:id
 */
export const deleteTemplate = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const template = await Template.findOneAndDelete({
      _id: req.params.id,
      userId: req.user!._id,
    });

    if (!template) {
      res.status(404).json({ success: false, message: 'Template not found' });
      return;
    }

    res.json({ success: true, message: 'Template deleted' });
  } catch (error: any) {
    console.error('deleteTemplate error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
