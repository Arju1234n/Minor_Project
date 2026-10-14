const SystemSetting = require('../models/SystemSetting');
const DetectionEvent = require('../models/DetectionEvent');

const DEFAULT_SETTINGS = {
  confidenceThreshold: 0.45,
  iouThreshold: 0.5,
  retentionDays: 30,
  virtualTripwireY: 0.5, // 50% line height
  privacyMode: false,    // Blur faces/bounding boxes for privacy
  enableBreadcrumbs: true,
  maxTrailLength: 30,
};

/**
 * Get all system settings merged with defaults
 */
exports.getSettings = async (_req, res) => {
  try {
    const settingsDocs = await SystemSetting.find();
    const settings = { ...DEFAULT_SETTINGS };

    for (const doc of settingsDocs) {
      settings[doc.key] = doc.value;
    }

    res.json({
      success: true,
      settings,
    });
  } catch (err) {
    console.error('getSettings error:', err);
    res.status(500).json({ success: false, message: 'Server error retrieving settings' });
  }
};

/**
 * Update system settings
 */
exports.updateSettings = async (req, res) => {
  try {
    const updates = req.body;
    if (!updates || typeof updates !== 'object') {
      return res.status(400).json({ success: false, message: 'Invalid payload' });
    }

    const promises = Object.entries(updates).map(([key, value]) =>
      SystemSetting.findOneAndUpdate(
        { key },
        { key, value },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      )
    );

    await Promise.all(promises);

    // Retrieve updated merged settings
    const settingsDocs = await SystemSetting.find();
    const settings = { ...DEFAULT_SETTINGS };
    for (const doc of settingsDocs) {
      settings[doc.key] = doc.value;
    }

    res.json({
      success: true,
      message: 'Settings updated successfully',
      settings,
    });
  } catch (err) {
    console.error('updateSettings error:', err);
    res.status(500).json({ success: false, message: 'Server error updating settings' });
  }
};

/**
 * Apply retention policy: purge detection records older than configured retentionDays
 */
exports.purgeRetention = async (req, res) => {
  try {
    const retentionSetting = await SystemSetting.findOne({ key: 'retentionDays' });
    const retentionDays = retentionSetting ? Number(retentionSetting.value) : DEFAULT_SETTINGS.retentionDays;

    const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const result = await DetectionEvent.deleteMany({ timestamp: { $lt: cutoffDate } });

    res.json({
      success: true,
      message: `Purged events older than ${retentionDays} days`,
      deletedCount: result.deletedCount,
      cutoffDate,
    });
  } catch (err) {
    console.error('purgeRetention error:', err);
    res.status(500).json({ success: false, message: 'Server error purging events' });
  }
};
