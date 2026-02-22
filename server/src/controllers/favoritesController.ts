import { Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import User from '../models/User.js';
import { AuthRequest } from '../types/index.js';
import { Errors } from '../utils/AppError.js';

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
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { targetUserId: userId } = req.params;
    const currentUserId = req.user!._id;

    // Cannot favorite self
    if (userId === currentUserId.toString()) {
      throw Errors.selfReference('Cannot favorite yourself.');
    }

    // Validate ObjectId
    if (!mongoose.isValidObjectId(userId)) {
      throw Errors.validation('Invalid user ID.');
    }

    // Validate target user exists
    const targetUser = await User.findById(userId);
    if (!targetUser || !targetUser.isActive) {
      throw Errors.notFound('User not found.');
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
        .populate({ path: 'favorites', select: '_id name email', match: { isActive: true } });
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
        throw Errors.notFound('Current user not found.');
      }

      // Populate for a fresh response
      const populated = await User.findById(currentUserId)
        .select('favorites')
        .populate({ path: 'favorites', select: '_id name email', match: { isActive: true } });
      res.json({
        success: true,
        data: {
          favorites: populated?.favorites ?? addResult.favorites,
          action: 'added',
        },
      });
    }
  } catch (error) {
    next(error);
  }
};

/**
 * Get current user's favorites list with minimal data.
 * GET /api/users/favorites
 */
export const getFavorites = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    // Pagination params
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(req.query.limit as string, 10) || DEFAULT_LIMIT));

    const currentUser = await User.findById(req.user!._id).select('favorites');

    if (!currentUser) {
      throw Errors.notFound('User not found.');
    }

    // Find active favorite IDs
    const activeIds = (
      await User.find(
        { _id: { $in: currentUser.favorites }, isActive: true },
        '_id'
      ).lean()
    ).map((u) => u._id);

    // Preserve original ordering from currentUser.favorites
    const activeIdSet = new Set(activeIds.map((id) => id.toString()));
    const orderedActiveIds = currentUser.favorites.filter((id) =>
      activeIdSet.has(id.toString())
    );

    const totalFavorites = orderedActiveIds.length;
    const start = (page - 1) * limit;
    const paginatedIds = orderedActiveIds.slice(start, start + limit);

    // Populate only active users, selecting minimal fields
    const populatedFavorites = await User.find(
      { _id: { $in: paginatedIds }, isActive: true },
      '_id name email'
    ).lean();

    // Reorder results to match paginatedIds order
    const lookupMap = new Map(
      populatedFavorites.map((u) => [u._id.toString(), u])
    );
    const orderedFavorites = paginatedIds
      .map((id) => lookupMap.get(id.toString()))
      .filter(Boolean);

    res.json({
      success: true,
      data: orderedFavorites,
      pagination: {
        page,
        limit,
        total: totalFavorites,
        totalPages: Math.ceil(totalFavorites / limit),
      },
    });
  } catch (error) {
    next(error);
  }
};
