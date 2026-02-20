import express from 'express';
import cors from 'cors';
import connectDB from './config/db';
import config from './config';
import authRoutes from './routes/authRoutes';
import entryRoutes from './routes/entryRoutes';
import adminRoutes from './routes/adminRoutes';
import holidayRoutes from './routes/holidayRoutes';
import templateRoutes from './routes/templateRoutes';
import insightsRoutes from './routes/insightsRoutes';
import statusRoutes from './routes/statusRoutes';

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

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
const start = async () => {
  await connectDB();
  app.listen(config.port, () => {
    console.log(`🚀 Server running on port ${config.port}`);
  });
};

start();

export default app;
