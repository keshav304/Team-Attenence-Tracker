import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from './models/User';
import Holiday from './models/Holiday';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/dhsync';

const seed = async () => {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    // Clear existing data
    await User.deleteMany({});
    await Holiday.deleteMany({});

    // Create admin user
    const admin = await User.create({
      name: 'Admin User',
      email: 'admin@team.com',
      password: 'admin123',
      role: 'admin',
    });

    // Create team members
    const members = await User.create([
      { name: 'Keshav Jha', email: 'keshav.jha@dunnhumby.com', password: 'password123' },
    ]);

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
    console.log(`   Admin: ${admin.email} / admin123`);
    members.forEach((m) => console.log(`   Member: ${m.email} / password123`));
    console.log('   10 holidays created for 2026');

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('❌ Seed error:', error);
    process.exit(1);
  }
};

seed();
