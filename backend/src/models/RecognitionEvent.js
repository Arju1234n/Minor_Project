const mongoose = require('mongoose');

const recognitionEventSchema = new mongoose.Schema(
  {
    sessionId: {
      type: String,
      required: true,
      index: true,
    },
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Student',
      index: true,
    },
    trackingId: {
      type: Number,
      index: true,
    },
    confidence: {
      type: Number,
      required: true,
    },
    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
    },
    // Bounding box of the recognized face/person in frame
    bbox: {
      x: Number,
      y: Number,
      width: Number,
      height: Number,
    },
    status: {
      type: String,
      enum: ['recognized', 'unrecognized', 'uncertain'],
      default: 'recognized',
    },
  },
  {
    timestamps: true,
  }
);

// TTL index — auto-prune recognition events after 30 days
recognitionEventSchema.index({ timestamp: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

module.exports = mongoose.model('RecognitionEvent', recognitionEventSchema);
