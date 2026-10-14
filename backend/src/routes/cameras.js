const express = require('express');
const {
  createSession,
  listSessions,
  getSession,
  updateStatus,
  deleteSession,
} = require('../controllers/cameraController');
const { protect, authorize } = require('../middleware/auth');

const { getIceServers } = require('../config/webrtc');
const CameraSession = require('../models/CameraSession');

const router = express.Router();

// ── Public Routes for Smartphone Camera Operators ───
router.get('/public/ice-servers', (_req, res) => {
  res.json({ success: true, iceServers: getIceServers() });
});

router.get('/public/:sessionId', async (req, res) => {
  try {
    const session = await CameraSession.findOne({ sessionId: req.params.sessionId });
    if (!session) {
      return res.status(404).json({ success: false, message: 'Camera session not found' });
    }
    res.json({
      success: true,
      session: {
        sessionId: session.sessionId,
        name: session.name,
        status: session.status,
      },
      iceServers: getIceServers(),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── Protected Admin Routes ───────────────────────────
router.use(protect);

router.post('/', createSession);
router.get('/', listSessions);
router.get('/:sessionId', getSession);
router.patch('/:sessionId/status', updateStatus);
router.delete('/:sessionId', authorize('admin'), deleteSession);

module.exports = router;
