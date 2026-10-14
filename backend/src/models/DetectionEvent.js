const mongoose = require('mongoose');

const detectionEventSchema = new mongoose.Schema(
  {
    sessionId: {
      type: String,
      required: true,
      index: true,
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
    peopleCount: {
      type: Number,
      required: true,
    },
    detections: [
      {
        trackingId: Number,
        confidence: Number,
        bbox: {
          x: Number,
          y: Number,
          width: Number,
          height: Number,
        },
      },
    ],
  },
  { timestamps: true }
);

// TTL index — auto-delete events older than 30 days by default
// This value can be overridden through a settings API in a later phase
detectionEventSchema.index({ timestamp: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

module.exports = mongoose.model('DetectionEvent', detectionEventSchema);
