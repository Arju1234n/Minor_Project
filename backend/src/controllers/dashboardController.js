const DetectionEvent = require('../models/DetectionEvent');
const CameraSession = require('../models/CameraSession');

/**
 * GET /api/dashboard/stats
 * Aggregate dashboard statistics.
 */
exports.getStats = async (req, res) => {
  try {
    const totalCameras = await CameraSession.countDocuments();
    const onlineCameras = await CameraSession.countDocuments({ status: 'online' });

    // Recent detection events (last 50)
    const recentEvents = await DetectionEvent.find()
      .sort({ timestamp: -1 })
      .limit(50)
      .lean();

    // Total detection events today
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const eventsToday = await DetectionEvent.countDocuments({
      timestamp: { $gte: todayStart },
    });

    res.json({
      success: true,
      stats: {
        totalCameras,
        onlineCameras,
        eventsToday,
        recentEvents,
      },
    });
  } catch (err) {
    console.error('Dashboard stats error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * GET /api/dashboard/events
 * List detection events with optional filters.
 */
exports.getEvents = async (req, res) => {
  try {
    const { sessionId, limit = 100, page = 1 } = req.query;
    const filter = {};
    if (sessionId) filter.sessionId = sessionId;

    const events = await DetectionEvent.find(filter)
      .sort({ timestamp: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit))
      .lean();

    const total = await DetectionEvent.countDocuments(filter);

    res.json({
      success: true,
      events,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (err) {
    console.error('Get events error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
