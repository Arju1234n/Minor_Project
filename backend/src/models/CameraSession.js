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
    type: {
      type: String,
      enum: ['phone', 'cctv'],
      default: 'phone',
    },
    status: {
      type: String,
      enum: ['online', 'offline', 'streaming', 'connecting', 'error'],
      default: 'offline',
    },
    // CCTV / IP Camera Configuration
    rtspUrl: {
      type: String,
      trim: true,
      select: false, // Hidden by default from queries to protect credentials
    },
    sanitizedUrl: {
      type: String,
      trim: true, // Safe URL with masked password for display
    },
    rtspCredentials: {
      username: { type: String, trim: true },
      password: { type: String, select: false }, // Never returned in default queries
    },
    sourceDetails: {
      protocol: { type: String },
      hostname: { type: String },
      port: { type: Number },
      pathname: { type: String },
    },
    fps: {
      type: Number,
      default: 15,
      min: 1,
      max: 60,
    },
    lastError: {
      type: String,
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
  {
    timestamps: true,
    toJSON: {
      transform: function (_doc, ret) {
        delete ret.rtspUrl; // Never leak raw URL with embedded credentials
        if (ret.rtspCredentials) {
          delete ret.rtspCredentials.password;
        }
        return ret;
      },
    },
  }
);

module.exports = mongoose.model('CameraSession', cameraSessionSchema);
