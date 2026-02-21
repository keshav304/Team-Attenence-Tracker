import dotenv from 'dotenv';
dotenv.config();

// Corporate proxy environments may use self-signed TLS certificates that block
// downloads from HuggingFace (embedding model) and other HTTPS services.
// Allow opting-in via .env rather than hard-coding.
if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
  // Value already set through .env – nothing additional needed.
  // Node shows a warning automatically.
}

interface Config {
  port: number;
  mongodbUri: string;
  jwtSecret: string;
  jwtExpiresIn: string;
  clientUrl: string;
  openRouterApiKey: string;
}

const config: Config = {
  port: Number(process.env.PORT) || 5001,
  mongodbUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/dhsync',
  jwtSecret: process.env.JWT_SECRET || 'fallback-secret',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
  openRouterApiKey: process.env.OPENROUTER_API_KEY || '',
};

export default config;
