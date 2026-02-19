import { Response } from 'express';
import Template from '../models/Template';
import { AuthRequest } from '../types';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const sanitizeText = (text: string): string =>
  text.replace(/<[^>]*>/g, '').trim();

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
    res.status(500).json({ success: false, message: error.message });
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
    res.status(400).json({ success: false, message: error.message });
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
    res.status(400).json({ success: false, message: error.message });
  }
};
