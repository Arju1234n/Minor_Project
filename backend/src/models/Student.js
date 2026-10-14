const mongoose = require('mongoose');

const studentSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: [true, 'Full name is required'],
      trim: true,
      maxlength: [100, 'Full name cannot exceed 100 characters'],
    },
    rollNumber: {
      type: String,
      required: [true, 'Roll number is required'],
      unique: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    registrationNumber: {
      type: String,
      trim: true,
      uppercase: true,
      sparse: true,
      index: true,
    },
    department: {
      type: String,
      required: [true, 'Department is required'],
      trim: true,
    },
    semester: {
      type: Number,
      required: [true, 'Semester is required'],
      min: [1, 'Semester must be at least 1'],
      max: [12, 'Semester cannot exceed 12'],
    },
    className: {
      type: String,
      required: [true, 'Class / Section is required'],
      trim: true,
    },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
      index: true,
    },
    // Face Enrollment Lifecycle
    enrollmentStatus: {
      type: String,
      enum: ['pending', 'enrolled', 'failed'],
      default: 'pending',
      index: true,
    },
    enrolledFaceCount: {
      type: Number,
      default: 0,
    },
    // Enrollment photos metadata (paths to consented face photographs)
    photos: [
      {
        filename: String,
        originalName: String,
        path: String,
        mimetype: String,
        size: Number,
        uploadedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for efficient class & department filtering
studentSchema.index({ department: 1, className: 1 });
studentSchema.index({ fullName: 'text', rollNumber: 'text' });

module.exports = mongoose.model('Student', studentSchema);
