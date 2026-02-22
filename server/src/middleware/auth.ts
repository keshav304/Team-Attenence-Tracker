import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import User, { UserRole } from '../models/User.js';
import config from '../config/index.js';
import { AuthRequest, JwtPayload } from '../types/index.js';
import { AppError, ErrorCode } from '../utils/AppError.js';

/**
 * Authenticate JWT middleware.
 *
 * Extracts the token from the Authorization header, verifies it,
 * loads the user from the database, and attaches to `req.user`.
 */
export const authenticate = async (
  req: AuthRequest,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new AppError(401, ErrorCode.UNAUTHORIZED, 'Authentication is required.');
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      throw new AppError(401, ErrorCode.UNAUTHORIZED, 'Authentication is required.');
    }

    let decoded: JwtPayload;
    try {
      decoded = jwt.verify(token, config.jwtSecret) as JwtPayload;
    } catch (jwtErr: any) {
      if (jwtErr.name === 'TokenExpiredError') {
        throw new AppError(401, ErrorCode.TOKEN_EXPIRED, 'Session expired. Please login again.');
      }
      throw new AppError(401, ErrorCode.INVALID_TOKEN, 'Invalid token. Please login again.');
    }

    const user = await User.findById(decoded.userId);
    if (!user || !user.isActive) {
      throw new AppError(401, ErrorCode.INVALID_TOKEN, 'Invalid token. Please login again.');
    }

    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Role-based authorization middleware factory.
 *
 * Usage:
 *   authorizeRole('admin')
 *   authorizeRole('admin', 'member')
 */
export const authorizeRole = (...roles: UserRole[]) => {
  return (req: AuthRequest, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new AppError(401, ErrorCode.UNAUTHORIZED, 'Authentication is required.'));
    }
    if (!roles.includes(req.user.role)) {
      return next(new AppError(403, ErrorCode.FORBIDDEN, "You don't have permission to perform this action."));
    }
    next();
  };
};

/**
 * Convenience alias – equivalent to authorizeRole('admin').
 * Kept for backward compatibility with existing route files.
 */
export const requireAdmin = authorizeRole('admin');
