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

    // Load the existing template so we can merge and validate the effective state
    const existing = await Template.findOne({ _id: req.params.id, userId: req.user!._id });
    if (!existing) { res.status(404).json({ success: false, message: 'Template not found' }); return; }

    // If no fields were provided to update, return the existing template as-is
    if (Object.keys(update).length === 0) {
      res.json({ success: true, data: existing });
      return;
    }

    // Compute the effective times after the update is applied
    const effectiveStart = update.startTime !== undefined ? update.startTime : existing.startTime;
    const effectiveEnd = update.endTime !== undefined ? update.endTime : existing.endTime;

    if (effectiveStart && !TIME_RE.test(effectiveStart)) { res.status(400).json({ success: false, message: 'startTime must be in HH:mm format' }); return; }
    if (effectiveEnd && !TIME_RE.test(effectiveEnd)) { res.status(400).json({ success: false, message: 'endTime must be in HH:mm format' }); return; }
    if ((effectiveStart && !effectiveEnd) || (!effectiveStart && effectiveEnd)) {
      res.status(400).json({ success: false, message: 'Both startTime and endTime must be provided together' }); return;
    }
    if (effectiveStart && effectiveEnd && effectiveEnd <= effectiveStart) { res.status(400).json({ success: false, message: 'endTime must be after startTime' }); return; }

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
