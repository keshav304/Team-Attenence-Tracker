import dotenv from 'dotenv';
dotenv.config();

interface Config {
  port: number;
  mongodbUri: string;
  jwtSecret: string;
  jwtExpiresIn: string;
  clientUrl: string;
}

const config: Config = {
  port: Number(process.env.PORT) || 5001,
  mongodbUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/dhsync',
  jwtSecret: process.env.JWT_SECRET || 'fallback-secret',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
};

export default config;
