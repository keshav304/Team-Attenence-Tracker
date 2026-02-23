import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from './models/User.js';
import Holiday from './models/Holiday.js';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/a-team-tracker';

const seed = async () => {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    
    // Create some holidays for 2026
    await Holiday.create([
      { date: '2026-01-01', name: 'New Year\'s Day' },
      { date: '2026-01-26', name: 'Republic Day' },
      { date: '2026-03-10', name: 'Holi' },
      { date: '2026-04-03', name: 'Good Friday' },
      { date: '2026-05-01', name: 'May Day' },
      { date: '2026-08-15', name: 'Independence Day' },
      { date: '2026-10-02', name: 'Gandhi Jayanti' },
      { date: '2026-10-20', name: 'Dussehra' },
      { date: '2026-11-09', name: 'Diwali' },
      { date: '2026-12-25', name: 'Christmas Day' },
    ]);

    console.log('✅ Seed data created:');
    console.log('   10 holidays created for 2026');

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('❌ Seed error:', error);
    process.exit(1);
  }
};

seed();
