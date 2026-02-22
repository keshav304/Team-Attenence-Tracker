import { Response } from 'express';
import mongoose from 'mongoose';
import User from '../models/User.js';
import { AuthRequest } from '../types/index.js';

/** Default and maximum page size for favorites listing. */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Toggle a user as favorite.
 * POST /api/users/favorites/:userId
 * If userId not in favorites → add. If already in favorites → remove.
 */
export const toggleFavorite = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const { targetUserId: userId } = req.params;
    const currentUserId = req.user!._id;

    // Cannot favorite self
    if (userId === currentUserId.toString()) {
      res.status(400).json({ success: false, message: 'Cannot favorite yourself' });
      return;
    }

    // Validate ObjectId
    if (!mongoose.isValidObjectId(userId)) {
      res.status(400).json({ success: false, message: 'Invalid user ID' });
      return;
    }

    // Validate target user exists
    const targetUser = await User.findById(userId);
    if (!targetUser || !targetUser.isActive) {
      res.status(404).json({ success: false, message: 'User not found' });
      return;
    }

    const targetObjId = new mongoose.Types.ObjectId(userId);

    // Try to remove first (atomic pull)
    const pullResult = await User.findOneAndUpdate(
      { _id: currentUserId, favorites: targetObjId },
      { $pull: { favorites: targetObjId } },
      { new: true }
    );

    if (pullResult) {
      // Was present and removed — populate for a fresh response
      const populated = await User.findById(currentUserId)
        .select('favorites')
        .populate('favorites', '_id name email');
      res.json({
        success: true,
        data: {
          favorites: populated?.favorites ?? pullResult.favorites,
          action: 'removed',
        },
      });
    } else {
      // Was not present — add atomically (prevents duplicates)
      const addResult = await User.findByIdAndUpdate(
        currentUserId,
        { $addToSet: { favorites: targetObjId } },
        { new: true }
      );

      if (!addResult) {
        res.status(404).json({ success: false, message: 'Current user not found' });
        return;
      }

      // Populate for a fresh response
      const populated = await User.findById(currentUserId)
        .select('favorites')
        .populate('favorites', '_id name email');
      res.json({
        success: true,
        data: {
          favorites: populated?.favorites ?? addResult.favorites,
          action: 'added',
        },
      });
    }
  } catch (error: any) {
    console.error('toggleFavorite error:', error);
    res.status(500).json({ success: false, message: 'Failed to toggle favorite' });
  }
};

/**
 * Get current user's favorites list with minimal data.
 * GET /api/users/favorites
 */
export const getFavorites = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    // Pagination params
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(req.query.limit as string, 10) || DEFAULT_LIMIT));

    const currentUser = await User.findById(req.user!._id).select('favorites');

    if (!currentUser) {
      res.status(404).json({ success: false, message: 'User not found' });
      return;
    }

    const totalFavorites = currentUser.favorites.length;
    const start = (page - 1) * limit;
    const paginatedIds = currentUser.favorites.slice(start, start + limit);

    // Populate only active users, selecting minimal fields
    const populatedFavorites = await User.find(
      { _id: { $in: paginatedIds }, isActive: true },
      '_id name email'
    ).lean();

    res.json({
      success: true,
      data: populatedFavorites,
      pagination: {
        page,
        limit,
        total: totalFavorites,
        totalPages: Math.ceil(totalFavorites / limit),
      },
    });
  } catch (error: any) {
    console.error('getFavorites error:', error);
    res.status(500).json({ success: false, message: 'Failed to get favorites' });
  }
};
