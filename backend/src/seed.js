/**
 * Seed script — creates the default admin user.
 * Run: npm run seed
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env.example') });
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env'), override: true });

const mongoose = require('mongoose');
const User = require('./models/User');
const connectDB = require('./config/db');

const seed = async () => {
  await connectDB();

  const email = process.env.ADMIN_EMAIL || 'admin@smartclassroom.ai';
  const password = process.env.ADMIN_PASSWORD || 'admin123';

  const existing = await User.findOne({ email });
  if (existing) {
    console.log(`ℹ️  Admin user already exists: ${email}`);
  } else {
    await User.create({
      name: 'Admin',
      email,
      password,
      role: 'admin',
    });
    console.log(`✅ Admin user created: ${email}`);
  }

  await mongoose.disconnect();
  process.exit(0);
};

seed().catch((err) => {
  console.error('Seed error:', err);
  process.exit(1);
});
