const mongoose = require('mongoose');

const cameraSessionSchema = new mongoose.Schema(
  {
    sessionId: {
      type: String,
      required: true,
      unique: true,
    },
    name: {
      type: String,
      required: [true, 'Camera name is required'],
      trim: true,
      maxlength: 100,
    },
    status: {
      type: String,
      enum: ['online', 'offline', 'connecting'],
      default: 'offline',
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    startedAt: {
      type: Date,
    },
    endedAt: {
      type: Date,
    },
    // Aggregate detection stats for this session
    totalDetections: {
      type: Number,
      default: 0,
    },
    peakPeopleCount: {
      type: Number,
      default: 0,
    },
    uniqueTrackingIds: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('CameraSession', cameraSessionSchema);
