const DetectionEvent = require('../models/DetectionEvent');
const CameraSession = require('../models/CameraSession');

/**
 * GET /api/dashboard/stats
 * Aggregate dashboard statistics with real-time analytics.
 */
exports.getStats = async (req, res) => {
  try {
    const totalCameras = await CameraSession.countDocuments();
    const onlineCameras = await CameraSession.countDocuments({
      status: { $in: ['online', 'streaming'] },
    });

    // Start of today (00:00:00)
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [eventsToday, peakResult, avgResult, distinctIds] = await Promise.all([
      DetectionEvent.countDocuments({ timestamp: { $gte: todayStart } }),
      DetectionEvent.find({ timestamp: { $gte: todayStart } })
        .sort({ peopleCount: -1 })
        .limit(1)
        .select('peopleCount'),
      DetectionEvent.aggregate([
        { $match: { timestamp: { $gte: todayStart } } },
        { $group: { _id: null, avgCount: { $avg: '$peopleCount' } } },
      ]),
      DetectionEvent.distinct('detections.trackingId', {
        timestamp: { $gte: todayStart },
      }),
    ]);

    const peakOccupancyToday = peakResult.length > 0 ? peakResult[0].peopleCount : 0;
    const avgOccupancyToday = avgResult.length > 0 ? Math.round(avgResult[0].avgCount * 10) / 10 : 0;
    const uniqueIdsToday = distinctIds.length;

    // Recent detection events (last 30)
    const recentEvents = await DetectionEvent.find()
      .sort({ timestamp: -1 })
      .limit(30)
      .lean();

    // Hourly occupancy aggregation for today
    const hourlyAggregation = await DetectionEvent.aggregate([
      { $match: { timestamp: { $gte: todayStart } } },
      {
        $group: {
          _id: { $hour: '$timestamp' },
          count: { $sum: 1 },
          maxPeople: { $max: '$peopleCount' },
          avgPeople: { $avg: '$peopleCount' },
        },
      },
      { $sort: { '_id': 1 } },
    ]);

    res.json({
      success: true,
      stats: {
        totalCameras,
        onlineCameras,
        eventsToday,
        peakOccupancyToday,
        avgOccupancyToday,
        uniqueIdsToday,
        recentEvents,
        hourlyTrend: hourlyAggregation.map((h) => ({
          hour: `${h._id}:00`,
          events: h.count,
          peak: h.maxPeople,
          avg: Math.round(h.avgPeople * 10) / 10,
        })),
      },
    });
  } catch (err) {
    console.error('Dashboard stats error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * GET /api/dashboard/events
 * List detection events with advanced filters, pagination, and summary statistics.
 */
exports.getEvents = async (req, res) => {
  try {
    const { sessionId, minPeople, startDate, endDate, limit = 50, page = 1 } = req.query;
    const filter = {};

    if (sessionId && sessionId !== 'all') {
      filter.sessionId = sessionId;
    }

    if (minPeople && parseInt(minPeople) > 0) {
      filter.peopleCount = { $gte: parseInt(minPeople) };
    }

    if (startDate || endDate) {
      filter.timestamp = {};
      if (startDate) filter.timestamp.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter.timestamp.$lte = end;
      }
    }

    const [events, total, summary] = await Promise.all([
      DetectionEvent.find(filter)
        .sort({ timestamp: -1 })
        .limit(parseInt(limit))
        .skip((parseInt(page) - 1) * parseInt(limit))
        .lean(),
      DetectionEvent.countDocuments(filter),
      DetectionEvent.aggregate([
        { $match: filter },
        {
          $group: {
            _id: null,
            maxPeople: { $max: '$peopleCount' },
            avgPeople: { $avg: '$peopleCount' },
          },
        },
      ]),
    ]);

    const maxPeople = summary.length > 0 ? summary[0].maxPeople : 0;
    const avgPeople = summary.length > 0 ? Math.round(summary[0].avgPeople * 10) / 10 : 0;

    res.json({
      success: true,
      events,
      summary: {
        totalEvents: total,
        maxPeople,
        avgPeople,
      },
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)) || 1,
      },
    });
  } catch (err) {
    console.error('Get events error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * POST /api/dashboard/events
 * Record a new detection event and broadcast update.
 */
exports.recordEvent = async (req, res) => {
  try {
    const { sessionId, peopleCount, detections } = req.body;
    if (!sessionId) {
      return res.status(400).json({ success: false, message: 'sessionId is required' });
    }
    const event = await DetectionEvent.create({
      sessionId,
      peopleCount: peopleCount !== undefined ? peopleCount : (detections ? detections.length : 0),
      detections: detections || [],
      timestamp: new Date(),
    });

    const io = req.app.get('io');
    if (io) {
      io.to(`session:${sessionId}`).emit('detection-update', {
        sessionId,
        peopleCount: event.peopleCount,
        detections: event.detections,
        timestamp: event.timestamp,
      });
      io.emit('dashboard-stats-update', {
        sessionId,
        peopleCount: event.peopleCount,
        timestamp: event.timestamp,
      });
    }

    res.status(201).json({ success: true, event });
  } catch (err) {
    console.error('Record event error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * DELETE /api/dashboard/events
 * Batch delete events (by session or retention period).
 */
exports.deleteEvents = async (req, res) => {
  try {
    const { sessionId, olderThanDays } = req.query;
    const filter = {};

    if (sessionId) filter.sessionId = sessionId;
    if (olderThanDays) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - parseInt(olderThanDays));
      filter.timestamp = { $lt: cutoff };
    }

    const result = await DetectionEvent.deleteMany(filter);
    res.json({
      success: true,
      message: `Deleted ${result.deletedCount} detection events`,
      deletedCount: result.deletedCount,
    });
  } catch (err) {
    console.error('Delete events error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
