require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env.example') });
// Override with local .env if it exists
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env'), override: true });

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const http = require('http');
const { Server: SocketIOServer } = require('socket.io');

const connectDB = require('./config/db');
const authRoutes = require('./routes/auth');
const cameraRoutes = require('./routes/cameras');
const dashboardRoutes = require('./routes/dashboard');
const settingsRoutes = require('./routes/settings');
const studentRoutes = require('./routes/students');
const rateLimit = require('express-rate-limit');

// ──────────────────────────────────────────
// Initialise Express & HTTP server
// ──────────────────────────────────────────
const app = express();
const server = http.createServer(app);

// ──────────────────────────────────────────
// Socket.IO (Signaling & Real-time metrics)
// ──────────────────────────────────────────
const io = new SocketIOServer(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production'
      ? false
      : ['http://localhost:5173', 'http://localhost:3000'],
    methods: ['GET', 'POST'],
  },
});

// Make io accessible to controllers if needed
app.set('io', io);

// ──────────────────────────────────────────
// Security & Rate Limiting Middleware
// ──────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false, // allow WebRTC media & local socket streams
  crossOriginEmbedderPolicy: false,
}));
app.use(cors());
app.use(express.json({ limit: '10mb' }));

if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
}

// Global API rate limiter (protect against abusive request floods)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000,                // limit each IP to 1000 requests per windowMs
  standardHeaders: true,    // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false,     // Disable `X-RateLimit-*` headers
  message: { success: false, message: 'Too many requests, please try again later.' },
});

// Stricter limiter for authentication endpoints (prevent brute-force password cracking)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,                  // limit each IP to 20 login/register attempts per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many authentication attempts, please try again in 15 minutes.' },
});

app.use('/api', apiLimiter);
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/cameras', cameraRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/students', studentRoutes);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404 fallback
app.use((_req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

// Global error handler
app.use((err, _req, res, _next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

// ──────────────────────────────────────────
// WebRTC Signaling & Socket.IO
// ──────────────────────────────────────────
const { setupWebRTCSignaling } = require('./signaling/webrtcSignaling');
setupWebRTCSignaling(io);

// ──────────────────────────────────────────
// Start server
// ──────────────────────────────────────────
const PORT = process.env.PORT || 5000;

const startServer = async () => {
  await connectDB();
  server.listen(PORT, () => {
    console.log(`🚀 Backend running on http://localhost:${PORT}`);
  });
};

startServer();
