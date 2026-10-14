const mongoose = require('mongoose');

const faceEmbeddingSchema = new mongoose.Schema(
  {
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Student',
      required: true,
      index: true,
    },
    // Normalized 512-dimensional embedding vector from ArcFace/InsightFace
    embedding: {
      type: [Number],
      required: true,
      validate: {
        validator: function (v) {
          return Array.isArray(v) && v.length > 0;
        },
        message: 'Embedding vector cannot be empty',
      },
    },
    photoIndex: {
      type: Number,
      default: 0,
    },
    qualityScore: {
      type: Number,
      default: 1.0,
    },
    modelName: {
      type: String,
      default: 'InsightFace-ArcFace-r50',
    },
    // Never store student personal details directly inside embedding record
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

faceEmbeddingSchema.index({ studentId: 1, isActive: 1 });

module.exports = mongoose.model('FaceEmbedding', faceEmbeddingSchema);
