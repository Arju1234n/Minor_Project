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

// ──────────────────────────────────────────
// Initialise Express & HTTP server
// ──────────────────────────────────────────
const app = express();
const server = http.createServer(app);

// ──────────────────────────────────────────
// Socket.IO  (used later for real-time updates)
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
// Middleware
// ──────────────────────────────────────────
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
}

// ──────────────────────────────────────────
// API Routes
// ──────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/cameras', cameraRoutes);
app.use('/api/dashboard', dashboardRoutes);

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
// Socket.IO basic connection logging
// ──────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`🔌 Socket connected: ${socket.id}`);

  socket.on('disconnect', () => {
    console.log(`🔌 Socket disconnected: ${socket.id}`);
  });
});

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
