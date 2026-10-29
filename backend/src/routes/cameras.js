const express = require('express');
const {
  createSession,
  listSessions,
  getSession,
  updateStatus,
  deleteSession,
  testStream,
  startCctv,
  stopCctv,
  getCctvStatus,
  getNetworkInfo,
} = require('../controllers/cameraController');
const { protect, authorize } = require('../middleware/auth');
const { getIceServers } = require('../config/webrtc');
const CameraSession = require('../models/CameraSession');
const aiService = require('../services/aiService');

const router = express.Router();

// ── Public Routes for Smartphone Camera Operators & Live Previews ───
router.get('/public/ice-servers', (_req, res) => {
  res.json({ success: true, iceServers: getIceServers() });
});

router.get('/public/network-info', getNetworkInfo);
router.get('/network-info', getNetworkInfo);

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
        type: session.type,
        status: session.status,
      },
      iceServers: getIceServers(),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/cameras/:sessionId/stream
 * Low-latency multipart MJPEG stream proxy for CCTV cameras.
 */
router.get('/:sessionId/stream', async (req, res) => {
  try {
    const session = await CameraSession.findOne({ sessionId: req.params.sessionId });
    if (!session) {
      return res.status(404).send('Camera session not found');
    }
    if (session.type !== 'cctv') {
      return res.status(400).send('Stream endpoint only available for CCTV / IP cameras');
    }

    const aiStreamUrl = `${aiService.AI_SERVICE_URL}/api/ai/cctv/${session.sessionId}/stream`;
    const aiRes = await fetch(aiStreamUrl);
    if (!aiRes.ok) {
      return res.status(aiRes.status).send('CCTV stream currently unavailable');
    }

    res.writeHead(200, {
      'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Connection': 'keep-alive',
      'Pragma': 'no-cache',
    });

    const reader = aiRes.body.getReader();
    req.on('close', () => {
      try { reader.cancel(); } catch (_) {}
    });

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).send('Stream proxy error');
    }
  }
});

// ── Protected Routes ─────────────────────────────────
router.use(protect);

router.post('/test-stream', testStream);

router.post('/', createSession);
router.get('/', listSessions);
router.get('/:sessionId', getSession);
router.patch('/:sessionId/status', updateStatus);
router.delete('/:sessionId', authorize('admin'), deleteSession);

// CCTV Worker Controls
router.post('/:sessionId/start-cctv', startCctv);
router.post('/:sessionId/stop-cctv', stopCctv);
router.get('/:sessionId/cctv-status', getCctvStatus);

module.exports = router;
