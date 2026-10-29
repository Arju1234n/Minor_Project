const os = require('os');
const CameraSession = require('../models/CameraSession');
const { v4: uuidv4 } = require('uuid');
const { validateCameraUrl, maskUrlCredentials } = require('../utils/urlValidator');
const aiService = require('../services/aiService');

/**
 * POST /api/cameras
 * Create a new camera session (Smartphone or CCTV / IP Camera).
 */
exports.createSession = async (req, res) => {
  try {
    const { name, type = 'phone', rtspUrl, username, password, fps = 15 } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Camera name is required' });
    }

    const cameraType = type === 'cctv' ? 'cctv' : 'phone';
    const sessionId = uuidv4();

    let fullRtspUrl = undefined;
    let sanitizedUrl = undefined;
    let sourceDetails = undefined;
    let credentials = undefined;

    if (cameraType === 'cctv') {
      if (!rtspUrl || !rtspUrl.trim()) {
        return res.status(400).json({
          success: false,
          message: 'Stream URL is required for CCTV / IP cameras',
        });
      }

      // Check SSRF and protocol validity
      const validation = validateCameraUrl(rtspUrl);
      if (!validation.isValid) {
        return res.status(400).json({ success: false, message: validation.error });
      }

      const parsed = validation.parsed;

      // Extract credentials: prefer explicit body credentials, fallback to URL credentials
      const finalUsername = (username && username.trim()) || parsed.username || undefined;
      const finalPassword = (password && password.trim()) || parsed.password || undefined;

      if (finalUsername || finalPassword) {
        credentials = {
          username: finalUsername,
          password: finalPassword,
        };
      }

      // Build full internal URL with credentials if needed
      if (finalUsername && finalPassword && !parsed.fullUrl.includes('@')) {
        const u = new URL(parsed.fullUrl);
        u.username = encodeURIComponent(finalUsername);
        u.password = encodeURIComponent(finalPassword);
        fullRtspUrl = u.toString();
        sanitizedUrl = maskUrlCredentials(fullRtspUrl);
      } else {
        fullRtspUrl = parsed.fullUrl;
        sanitizedUrl = parsed.sanitizedUrl;
      }

      sourceDetails = {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port,
        pathname: parsed.pathname,
      };
    }

    const session = await CameraSession.create({
      sessionId,
      name: name.trim(),
      type: cameraType,
      status: 'offline',
      rtspUrl: fullRtspUrl,
      sanitizedUrl,
      rtspCredentials: credentials,
      sourceDetails,
      fps: Math.max(1, Math.min(60, parseInt(fps, 10) || 15)),
      createdBy: req.user?._id,
    });

    res.status(201).json({ success: true, session });
  } catch (err) {
    console.error('Create camera session error:', err);
    res.status(500).json({ success: false, message: 'Server error creating camera session' });
  }
};

/**
 * GET /api/cameras
 * List all camera sessions (passwords excluded by model toJSON).
 */
exports.listSessions = async (req, res) => {
  try {
    const sessions = await CameraSession.find()
      .sort({ createdAt: -1 })
      .populate('createdBy', 'name email');
    res.json({ success: true, sessions });
  } catch (err) {
    console.error('List sessions error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * GET /api/cameras/:sessionId
 * Get a single camera session.
 */
exports.getSession = async (req, res) => {
  try {
    const session = await CameraSession.findOne({
      sessionId: req.params.sessionId,
    }).populate('createdBy', 'name email');

    if (!session) {
      return res.status(404).json({ success: false, message: 'Camera session not found' });
    }

    res.json({ success: true, session });
  } catch (err) {
    console.error('Get session error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * PATCH /api/cameras/:sessionId/status
 * Update camera status (online / offline / connecting / streaming / error).
 */
exports.updateStatus = async (req, res) => {
  try {
    const { status } = req.body;
    if (!['online', 'offline', 'connecting', 'streaming', 'error'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status value' });
    }

    const update = { status };
    if (status === 'online' || status === 'streaming') update.startedAt = new Date();
    if (status === 'offline') update.endedAt = new Date();

    const session = await CameraSession.findOneAndUpdate(
      { sessionId: req.params.sessionId },
      update,
      { new: true }
    );

    if (!session) {
      return res.status(404).json({ success: false, message: 'Camera session not found' });
    }

    res.json({ success: true, session });
  } catch (err) {
    console.error('Update status error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * POST /api/cameras/test-stream
 * Test an unconfigured or configured RTSP stream URL for reachability.
 */
exports.testStream = async (req, res) => {
  try {
    const { rtspUrl, username, password } = req.body;

    if (!rtspUrl || !rtspUrl.trim()) {
      return res.status(400).json({ success: false, message: 'Stream URL is required to test' });
    }

    const validation = validateCameraUrl(rtspUrl);
    if (!validation.isValid) {
      return res.status(400).json({ success: false, message: validation.error });
    }

    let fullUrl = validation.parsed.fullUrl;
    if (username && password && !fullUrl.includes('@')) {
      const u = new URL(fullUrl);
      u.username = encodeURIComponent(username.trim());
      u.password = encodeURIComponent(password.trim());
      fullUrl = u.toString();
    }

    const result = await aiService.testCctvStream(fullUrl, 4.0);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('Test stream error:', err);
    res.status(500).json({
      success: false,
      reachable: false,
      message: err.message || 'Stream test failed',
    });
  }
};

/**
 * POST /api/cameras/:sessionId/start-cctv
 * Start background ingestion worker for a CCTV camera.
 */
exports.startCctv = async (req, res) => {
  try {
    const session = await CameraSession.findOne({
      sessionId: req.params.sessionId,
    }).select('+rtspUrl +rtspCredentials.password');

    if (!session) {
      return res.status(404).json({ success: false, message: 'Camera session not found' });
    }

    if (session.type !== 'cctv' || !session.rtspUrl) {
      return res.status(400).json({
        success: false,
        message: 'This camera session is not configured as an RTSP/CCTV camera',
      });
    }

    const result = await aiService.startCctvWorker(session.sessionId, session.rtspUrl, session.fps || 15);

    if (result.ok) {
      session.status = 'streaming';
      session.startedAt = new Date();
      await session.save();

      // Emit socket notification
      const io = req.app.get('io');
      if (io) {
        io.to(`session:${session.sessionId}`).emit('broadcaster-stream-status', {
          sessionId: session.sessionId,
          isStreaming: true,
        });
      }
    }

    res.json({ success: result.ok, ...result });
  } catch (err) {
    console.error('Start CCTV error:', err);
    res.status(500).json({ success: false, message: err.message || 'Failed to start CCTV stream' });
  }
};

/**
 * POST /api/cameras/:sessionId/stop-cctv
 * Stop background ingestion worker for a CCTV camera.
 */
exports.stopCctv = async (req, res) => {
  try {
    const session = await CameraSession.findOne({ sessionId: req.params.sessionId });
    if (!session) {
      return res.status(404).json({ success: false, message: 'Camera session not found' });
    }

    const result = await aiService.stopCctvWorker(session.sessionId);

    session.status = 'offline';
    session.endedAt = new Date();
    await session.save();

    // Emit socket notification
    const io = req.app.get('io');
    if (io) {
      io.to(`session:${session.sessionId}`).emit('broadcaster-stream-status', {
        sessionId: session.sessionId,
        isStreaming: false,
      });
    }

    res.json({ success: true, ...result });
  } catch (err) {
    console.error('Stop CCTV error:', err);
    res.status(500).json({ success: false, message: err.message || 'Failed to stop CCTV stream' });
  }
};

/**
 * GET /api/cameras/:sessionId/cctv-status
 * Get runtime status of a CCTV worker from AI service.
 */
exports.getCctvStatus = async (req, res) => {
  try {
    const result = await aiService.getCctvStatus(req.params.sessionId);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * DELETE /api/cameras/:sessionId
 * Remove a camera session and stop any active CCTV workers.
 */
exports.deleteSession = async (req, res) => {
  try {
    const session = await CameraSession.findOneAndDelete({
      sessionId: req.params.sessionId,
    });

    if (!session) {
      return res.status(404).json({ success: false, message: 'Camera session not found' });
    }

    // Stop CCTV worker if it was running
    if (session.type === 'cctv') {
      try {
        await aiService.stopCctvWorker(session.sessionId);
      } catch (_) {}
    }

    res.json({ success: true, message: 'Camera session deleted successfully' });
  } catch (err) {
    console.error('Delete session error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * GET /api/cameras/network-info
 * Returns the host machine's Wi-Fi / LAN IP so mobile devices on the same Wi-Fi can easily reach it.
 */
exports.getNetworkInfo = async (_req, res) => {
  try {
    const interfaces = os.networkInterfaces();
    const addresses = [];
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          addresses.push({ name, ip: iface.address });
        }
      }
    }
    const primaryIp = addresses[0]?.ip || 'localhost';
    res.json({ success: true, primaryIp, addresses });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
