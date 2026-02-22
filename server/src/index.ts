import express from 'express';
import cors from 'cors';
import connectDB from './config/db.js';
import config from './config/index.js';
import authRoutes from './routes/authRoutes.js';
import entryRoutes from './routes/entryRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import holidayRoutes from './routes/holidayRoutes.js';
import templateRoutes from './routes/templateRoutes.js';
import insightsRoutes from './routes/insightsRoutes.js';
import statusRoutes from './routes/statusRoutes.js';
import chatRoutes from './routes/chatRoutes.js';
import workbotRoutes from './routes/workbotRoutes.js';
import eventRoutes from './routes/eventRoutes.js';
import analyticsRoutes from './routes/analyticsRoutes.js';
import myInsightsRoutes from './routes/myInsightsRoutes.js';
import { warmUpEmbeddings } from './utils/embeddings.js';

const app = express();

// Middleware
app.use(cors({ origin: config.clientUrl, credentials: true }));
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/entries', entryRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/holidays', holidayRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/insights', insightsRoutes);
app.use('/api/status', statusRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/workbot', workbotRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/my-insights', myInsightsRoutes);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
const start = async () => {
  await connectDB();
  // Pre-load embedding model in the background so first chat request is fast
  warmUpEmbeddings();
  app.listen(config.port, () => {
    console.log(`🚀 Server running on port ${config.port}`);
  });
};

start();

export default app;
