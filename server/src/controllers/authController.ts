import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import config from '../config/index.js';
import { AuthRequest, JwtPayload } from '../types/index.js';
import { AppError, ErrorCode, Errors } from '../utils/AppError.js';

const generateToken = (user: { _id: string; role: string }): string => {
  const payload: JwtPayload = {
    userId: user._id.toString(),
    role: user.role as 'member' | 'admin',
  };
  return jwt.sign(payload, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  } as jwt.SignOptions);
};

export const register = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { name, email, password } = req.body;

    if (!email) {
      throw Errors.validation('Email is required.');
    }

    const normalizedEmail = email.trim().toLowerCase();

    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      throw Errors.emailExists();
    }

    const user = await User.create({ name, email: normalizedEmail, password });
    const token = generateToken({ _id: user._id.toString(), role: user.role });

    res.status(201).json({
      success: true,
      data: {
        token,
        user: {
          id: user._id.toString(),
          name: user.name,
          email: user.email,
          role: user.role,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

export const login = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      throw Errors.validation('Email and password are required.');
    }

    const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
    if (!user || !user.isActive) {
      // Never reveal whether the email exists
      throw Errors.invalidCredentials();
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      throw Errors.invalidCredentials();
    }

    const token = generateToken({ _id: user._id.toString(), role: user.role });

    _res.json({
      success: true,
      data: {
        token,
        user: {
          id: user._id.toString(),
          name: user.name,
          email: user.email,
          role: user.role,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

export const getMe = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    res.json({
      success: true,
      data: req.user,
    });
  } catch (error) {
    next(error);
  }
};

export const updateProfile = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { name } = req.body;
    const user = await User.findByIdAndUpdate(
      req.user!._id,
      { name },
      { new: true, runValidators: true }
    );

    if (!user) {
      throw Errors.notFound('User not found.');
    }

    res.json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
};

export const changePassword = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { currentPassword, newPassword } = req.body;

    const user = await User.findById(req.user!._id).select('+password');
    if (!user) {
      throw Errors.notFound('User not found.');
    }

    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      throw Errors.invalidCredentials('Current password is incorrect.');
    }

    user.password = newPassword;
    await user.save();

    res.json({ success: true, message: 'Password updated successfully.' });
  } catch (error) {
    next(error);
  }
};
