const CameraSession = require('../models/CameraSession');
const { v4: uuidv4 } = require('uuid');

/**
 * POST /api/cameras
 * Create a new camera session.
 */
exports.createSession = async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res
        .status(400)
        .json({ success: false, message: 'Camera name is required' });
    }

    const sessionId = uuidv4();

    const session = await CameraSession.create({
      sessionId,
      name: name.trim(),
      status: 'offline',
      createdBy: req.user._id,
    });

    res.status(201).json({ success: true, session });
  } catch (err) {
    console.error('Create camera session error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * GET /api/cameras
 * List all camera sessions.
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
      return res
        .status(404)
        .json({ success: false, message: 'Camera session not found' });
    }

    res.json({ success: true, session });
  } catch (err) {
    console.error('Get session error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * PATCH /api/cameras/:sessionId/status
 * Update camera status (online / offline / connecting).
 */
exports.updateStatus = async (req, res) => {
  try {
    const { status } = req.body;
    if (!['online', 'offline', 'connecting'].includes(status)) {
      return res
        .status(400)
        .json({ success: false, message: 'Invalid status value' });
    }

    const update = { status };
    if (status === 'online') update.startedAt = new Date();
    if (status === 'offline') update.endedAt = new Date();

    const session = await CameraSession.findOneAndUpdate(
      { sessionId: req.params.sessionId },
      update,
      { new: true }
    );

    if (!session) {
      return res
        .status(404)
        .json({ success: false, message: 'Camera session not found' });
    }

    res.json({ success: true, session });
  } catch (err) {
    console.error('Update status error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * DELETE /api/cameras/:sessionId
 * Remove a camera session.
 */
exports.deleteSession = async (req, res) => {
  try {
    const session = await CameraSession.findOneAndDelete({
      sessionId: req.params.sessionId,
    });

    if (!session) {
      return res
        .status(404)
        .json({ success: false, message: 'Camera session not found' });
    }

    res.json({ success: true, message: 'Camera session deleted' });
  } catch (err) {
    console.error('Delete session error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
