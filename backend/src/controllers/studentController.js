const Student = require('../models/Student');
const FaceEmbedding = require('../models/FaceEmbedding');
const RecognitionEvent = require('../models/RecognitionEvent');
const fs = require('fs');
const path = require('path');
const aiService = require('../services/aiService');
const AI_SERVICE_URL = aiService.AI_SERVICE_URL;

/**
 * Register a new student with optional face photographs
 */
exports.createStudent = async (req, res) => {
  try {
    const {
      fullName,
      rollNumber,
      registrationNumber,
      department,
      semester,
      className,
    } = req.body;

    // Validate required fields (className is optional; semester is academic grouping)
    if (!fullName || !rollNumber || !department || !semester) {
      return res.status(400).json({
        success: false,
        message: 'Please provide full name, roll number, department, and semester.',
      });
    }

    const cleanRoll = rollNumber.trim().toUpperCase();

    // Check for duplicate roll number
    const existingRoll = await Student.findOne({ rollNumber: cleanRoll });
    if (existingRoll) {
      // Clean up uploaded files if roll duplicate
      if (req.files && req.files.length > 0) {
        req.files.forEach((file) => {
          try { fs.unlinkSync(file.path); } catch (_) {}
        });
      }
      return res.status(400).json({
        success: false,
        message: `Student with roll number "${cleanRoll}" is already registered.`,
      });
    }

    // Check for duplicate registration number if provided
    let cleanReg = undefined;
    if (registrationNumber && registrationNumber.trim()) {
      cleanReg = registrationNumber.trim().toUpperCase();
      const existingReg = await Student.findOne({ registrationNumber: cleanReg });
      if (existingReg) {
        if (req.files && req.files.length > 0) {
          req.files.forEach((file) => {
            try { fs.unlinkSync(file.path); } catch (_) {}
          });
        }
        return res.status(400).json({
          success: false,
          message: `Student with registration number "${cleanReg}" is already registered.`,
        });
      }
    }

    // Process uploaded photos
    const photos = [];
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        photos.push({
          filename: file.filename,
          originalName: file.originalname,
          path: file.path,
          mimetype: file.mimetype,
          size: file.size,
          uploadedAt: new Date(),
        });
      }
    }

    // Auto-enroll face photographs during registration if requested
    const shouldAutoEnroll = (req.body.autoEnroll === 'true' || req.query.autoEnroll === 'true') && photos.length > 0;
    let enrollmentStatus = 'pending';
    let embeddingsToSave = [];

    if (shouldAutoEnroll) {
      const validationErrors = [];
      for (let i = 0; i < photos.length; i++) {
        const photo = photos[i];
        try {
          const aiData = await aiService.enrollFace(photo.path);
          if (!aiData.ok || !aiData.success) {
            validationErrors.push(
              `Photo #${i + 1} (${photo.originalName || 'image'}): ${aiData.error || aiData.detail || 'Face extraction failed'}`
            );
          } else {
            embeddingsToSave.push({
              embedding: aiData.embedding,
              confidence: aiData.confidence,
              model: aiData.model,
            });
          }
        } catch (callErr) {
          // Cleanup files
          photos.forEach((file) => {
            try { fs.unlinkSync(file.path); } catch (_) {}
          });
          return res.status(503).json({
            success: false,
            message: `AI Computer Vision service unavailable at ${AI_SERVICE_URL}. Please ensure ai-service is running.`,
          });
        }
      }

      if (validationErrors.length > 0) {
        // Cleanup files
        photos.forEach((file) => {
          try { fs.unlinkSync(file.path); } catch (_) {}
        });
        return res.status(400).json({
          success: false,
          message: 'Face enrollment validation failed.',
          errors: validationErrors,
        });
      }

      enrollmentStatus = 'enrolled';
    }

    const student = await Student.create({
      fullName: fullName.trim(),
      rollNumber: cleanRoll,
      registrationNumber: cleanReg,
      department: department.trim(),
      semester: parseInt(semester, 10),
      className: className ? className.trim() : '',
      photos,
      enrolledFaceCount: embeddingsToSave.length,
      enrollmentStatus,
      createdBy: req.user?._id,
    });

    let gallerySynced = false;
    if (shouldAutoEnroll && embeddingsToSave.length > 0) {
      const embeddingDocs = embeddingsToSave.map((emb, idx) => ({
        studentId: student._id,
        embedding: emb.embedding,
        photoIndex: idx,
        qualityScore: emb.confidence,
        modelName: emb.model || 'SFace-ArcFace',
        isActive: true,
      }));
      await FaceEmbedding.insertMany(embeddingDocs);
      await syncGalleryToAIService().catch(() => {});
      gallerySynced = true;
    }

    res.status(201).json({
      success: true,
      message: shouldAutoEnroll
        ? `Student registered, ${embeddingsToSave.length} face embedding(s) generated, and synchronized with AI gallery.`
        : 'Student registered successfully',
      student,
      enrolled: shouldAutoEnroll,
      gallerySynced,
      enrolledCount: embeddingsToSave.length,
    });
  } catch (err) {
    console.error('createStudent error:', err);
    // Cleanup any uploaded files on exception
    if (req.files && req.files.length > 0) {
      req.files.forEach((file) => {
        try { fs.unlinkSync(file.path); } catch (_) {}
      });
    }
    res.status(500).json({
      success: false,
      message: err.message || 'Server error creating student record',
    });
  }
};

/**
 * List students with multi-criteria search, department/class filtering, and pagination
 */
exports.getStudents = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 25));
    const skip = (page - 1) * limit;

    const { search, department, className, semester, status, enrollmentStatus } = req.query;

    const query = {};

    // Free text search on full name or roll number (safely escaped against ReDoS)
    if (search && search.trim()) {
      const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.$or = [
        { fullName: { $regex: escaped, $options: 'i' } },
        { rollNumber: { $regex: escaped, $options: 'i' } },
        { registrationNumber: { $regex: escaped, $options: 'i' } },
      ];
    }

    if (department && department !== 'all') {
      query.department = department.trim();
    }

    if (className && className !== 'all') {
      query.className = className.trim();
    }

    if (semester && semester !== 'all') {
      query.semester = parseInt(semester, 10);
    }

    if (status && status !== 'all') {
      query.status = status;
    }

    if (enrollmentStatus && enrollmentStatus !== 'all') {
      query.enrollmentStatus = enrollmentStatus;
    }

    const [students, total, summary] = await Promise.all([
      Student.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Student.countDocuments(query),
      Student.aggregate([
        {
          $group: {
            _id: null,
            totalStudents: { $sum: 1 },
            activeStudents: {
              $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] },
            },
            enrolledStudents: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $eq: ['$enrollmentStatus', 'enrolled'] },
                      { $gt: ['$enrolledFaceCount', 0] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            pendingEnrollment: {
              $sum: {
                $cond: [
                  {
                    $or: [
                      { $ne: ['$enrollmentStatus', 'enrolled'] },
                      { $lte: ['$enrolledFaceCount', 0] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
          },
        },
      ]),
    ]);

    // Distinct departments, semesters, and classes for filter dropdowns
    const [departments, semesters, classes] = await Promise.all([
      Student.distinct('department'),
      Student.distinct('semester'),
      Student.distinct('className'),
    ]);

    res.json({
      success: true,
      students,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit) || 1,
      },
      summary: summary[0] || {
        totalStudents: 0,
        activeStudents: 0,
        enrolledStudents: 0,
        pendingEnrollment: 0,
      },
      availableFilters: {
        departments: departments.filter(Boolean).sort(),
        semesters: semesters.filter(Boolean).sort((a, b) => a - b),
        classes: classes.filter(Boolean).sort(),
      },
    });
  } catch (err) {
    console.error('getStudents error:', err);
    res.status(500).json({ success: false, message: 'Server error retrieving students' });
  }
};

/**
 * Get single student profile by ID
 */
exports.getStudentById = async (req, res) => {
  try {
    const student = await Student.findById(req.params.id);
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    // Also fetch embedding count
    const embeddingCount = await FaceEmbedding.countDocuments({
      studentId: student._id,
      isActive: true,
    });

    res.json({
      success: true,
      student,
      embeddingCount,
    });
  } catch (err) {
    console.error('getStudentById error:', err);
    res.status(500).json({ success: false, message: 'Server error retrieving student' });
  }
};

/**
 * Update student profile
 */
exports.updateStudent = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      fullName,
      rollNumber,
      registrationNumber,
      department,
      semester,
      className,
      status,
    } = req.body;

    const student = await Student.findById(id);
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    // Check duplicate roll number if being changed
    if (rollNumber) {
      const cleanRoll = rollNumber.trim().toUpperCase();
      if (cleanRoll !== student.rollNumber) {
        const duplicateRoll = await Student.findOne({ rollNumber: cleanRoll, _id: { $ne: id } });
        if (duplicateRoll) {
          return res.status(400).json({
            success: false,
            message: `Roll number "${cleanRoll}" is already assigned to another student.`,
          });
        }
        student.rollNumber = cleanRoll;
      }
    }

    if (registrationNumber !== undefined) {
      const cleanReg = registrationNumber ? registrationNumber.trim().toUpperCase() : undefined;
      if (cleanReg && cleanReg !== student.registrationNumber) {
        const duplicateReg = await Student.findOne({ registrationNumber: cleanReg, _id: { $ne: id } });
        if (duplicateReg) {
          return res.status(400).json({
            success: false,
            message: `Registration number "${cleanReg}" is already assigned to another student.`,
          });
        }
      }
      student.registrationNumber = cleanReg;
    }

    if (fullName) student.fullName = fullName.trim();
    if (department) student.department = department.trim();
    if (semester) student.semester = parseInt(semester, 10);
    if (className) student.className = className.trim();
    if (status && ['active', 'inactive'].includes(status)) student.status = status;

    // Append newly uploaded photos if any
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        student.photos.push({
          filename: file.filename,
          originalName: file.originalname,
          path: file.path,
          mimetype: file.mimetype,
          size: file.size,
          uploadedAt: new Date(),
        });
      }
      student.enrollmentStatus = 'pending'; // Trigger re-enrollment for new faces
    }

    await student.save();

    res.json({
      success: true,
      message: 'Student record updated successfully',
      student,
    });
  } catch (err) {
    console.error('updateStudent error:', err);
    res.status(500).json({ success: false, message: 'Server error updating student' });
  }
};

/**
 * Delete or deactivate student
 */
exports.deleteStudent = async (req, res) => {
  try {
    const { id } = req.params;
    const { permanent } = req.query;

    const student = await Student.findById(id);
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    if (permanent === 'true') {
      // Permanent removal: clean up photos from disk
      if (student.photos && student.photos.length > 0) {
        student.photos.forEach((photo) => {
          try {
            if (photo.path && fs.existsSync(photo.path)) {
              fs.unlinkSync(photo.path);
            }
          } catch (_) {}
        });
      }

      // Delete associated face embeddings
      await FaceEmbedding.deleteMany({ studentId: student._id });
      await Student.findByIdAndDelete(id);

      // Synchronize in-memory gallery in AI service
      syncGalleryToAIService().catch(() => {});

      return res.json({
        success: true,
        message: `Student "${student.fullName}" and all biometric data permanently deleted.`,
      });
    }

    // Soft delete: toggle to inactive
    student.status = 'inactive';
    await student.save();

    // Synchronize in-memory gallery in AI service
    syncGalleryToAIService().catch(() => {});

    res.json({
      success: true,
      message: `Student "${student.fullName}" deactivated successfully.`,
      student,
    });
  } catch (err) {
    console.error('deleteStudent error:', err);
    res.status(500).json({ success: false, message: 'Server error deleting student' });
  }
};

/**
 * Toggle student active/inactive status
 */
exports.toggleStudentStatus = async (req, res) => {
  try {
    const student = await Student.findById(req.params.id);
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    student.status = student.status === 'active' ? 'inactive' : 'active';
    await student.save();

    // Synchronize in-memory gallery in AI service
    syncGalleryToAIService().catch(() => {});

    res.json({
      success: true,
      message: `Student is now ${student.status}`,
      status: student.status,
    });
  } catch (err) {
    console.error('toggleStudentStatus error:', err);
    res.status(500).json({ success: false, message: 'Server error changing student status' });
  }
};

/**
 * ── Phase 2: Face Enrollment & Embedding Generation ───────────
 * Validates face photographs via AI microservice and saves ArcFace embeddings
 */
exports.enrollStudentFace = async (req, res) => {
  try {
    const { id } = req.params;
    const student = await Student.findById(id);

    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    // Append newly uploaded photos if provided in this request
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        student.photos.push({
          filename: file.filename,
          originalName: file.originalname,
          path: file.path,
          mimetype: file.mimetype,
          size: file.size,
          uploadedAt: new Date(),
        });
      }
    }

    if (!student.photos || student.photos.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No face photographs found. Please upload at least one clear face portrait.',
      });
    }

    const embeddingsToSave = [];
    const validationErrors = [];

    // Verify each photo with AI service
    for (let i = 0; i < student.photos.length; i++) {
      const photo = student.photos[i];

      if (!fs.existsSync(photo.path)) {
        validationErrors.push(`Photo #${i + 1} (${photo.originalName || 'image'}): File missing on disk.`);
        continue;
      }

      try {
        const aiData = await aiService.enrollFace(photo.path);

        if (!aiData.ok || !aiData.success) {
          validationErrors.push(
            `Photo #${i + 1} (${photo.originalName || 'image'}): ${aiData.error || aiData.detail || 'Face extraction failed'}`
          );
        } else {
          embeddingsToSave.push({
            embedding: aiData.embedding,
            confidence: aiData.confidence,
            model: aiData.model,
          });
        }
      } catch (callErr) {
        return res.status(503).json({
          success: false,
          message: `AI Computer Vision service unavailable at ${AI_SERVICE_URL}. Please ensure ai-service is running.`,
        });
      }
    }

    // If any photo fails single-face criteria, reject enrollment so admin can correct it
    if (validationErrors.length > 0) {
      student.enrollmentStatus = 'failed';
      await student.save();
      return res.status(400).json({
        success: false,
        message: 'Face enrollment validation failed.',
        errors: validationErrors,
      });
    }

    // Replace previous embeddings cleanly
    await FaceEmbedding.deleteMany({ studentId: student._id });

    // Store new embeddings in MongoDB
    const embeddingDocs = embeddingsToSave.map((emb, idx) => ({
      studentId: student._id,
      embedding: emb.embedding,
      photoIndex: idx,
      qualityScore: emb.confidence,
      modelName: emb.model || 'SFace-ArcFace',
      isActive: true,
    }));

    await FaceEmbedding.insertMany(embeddingDocs);

    student.enrollmentStatus = 'enrolled';
    student.enrolledFaceCount = embeddingDocs.length;
    await student.save();

    // Synchronize embeddings with AI microservice vector gallery
    const syncedCount = await syncGalleryToAIService();

    res.json({
      success: true,
      message: `Successfully enrolled ${embeddingDocs.length} face photograph(s) for "${student.fullName}" and synchronized with AI gallery.`,
      student,
      enrolledCount: embeddingDocs.length,
      gallerySynced: true,
      syncedCount,
    });
  } catch (err) {
    console.error('enrollStudentFace error:', err);
    res.status(500).json({ success: false, message: 'Server error enrolling student face' });
  }
};

/**
 * Delete / Reset student biometric enrollment data
 */
exports.deleteStudentEnrollment = async (req, res) => {
  try {
    const { id } = req.params;
    const student = await Student.findById(id);

    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    // Delete face embeddings from database
    const deleteResult = await FaceEmbedding.deleteMany({ studentId: student._id });

    // Reset student status
    student.enrollmentStatus = 'pending';
    student.enrolledFaceCount = 0;
    await student.save();

    // Asynchronously update AI microservice vector gallery
    syncGalleryToAIService().catch(() => {});

    res.json({
      success: true,
      message: `Biometric enrollment data wiped for "${student.fullName}". (${deleteResult.deletedCount} embeddings removed)`,
      student,
    });
  } catch (err) {
    console.error('deleteStudentEnrollment error:', err);
    res.status(500).json({ success: false, message: 'Server error wiping enrollment data' });
  }
};

/**
 * Get student enrollment status and metadata
 */
exports.getStudentEnrollment = async (req, res) => {
  try {
    const { id } = req.params;
    const student = await Student.findById(id);

    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    const embeddings = await FaceEmbedding.find({ studentId: student._id, isActive: true })
      .select('-embedding') // Do not expose raw vector numbers unless specifically needed
      .lean();

    res.json({
      success: true,
      studentId: student._id,
      rollNumber: student.rollNumber,
      fullName: student.fullName,
      enrollmentStatus: student.enrollmentStatus,
      enrolledFaceCount: embeddings.length,
      embeddings,
    });
  } catch (err) {
    console.error('getStudentEnrollment error:', err);
    res.status(500).json({ success: false, message: 'Server error retrieving enrollment metadata' });
  }
};

/**
 * ── Phase 3: Active Student Face Gallery Export ───────────────
 * Retrieves enrolled student embeddings for AI service in-memory search
 */
exports.getActiveGallery = async (req, res) => {
  try {
    const students = await Student.find({ status: 'active', enrollmentStatus: 'enrolled' })
      .select('_id fullName rollNumber department className')
      .lean();

    if (!students.length) {
      return res.json({ success: true, count: 0, gallery: [] });
    }

    const studentIds = students.map((s) => s._id);
    const embeddings = await FaceEmbedding.find({
      studentId: { $in: studentIds },
      isActive: true,
    }).lean();

    const studentMap = {};
    students.forEach((s) => {
      studentMap[s._id.toString()] = {
        studentId: s._id.toString(),
        fullName: s.fullName,
        rollNumber: s.rollNumber,
        department: s.department,
        className: s.className,
        embeddings: [],
      };
    });

    embeddings.forEach((emb) => {
      const sid = emb.studentId.toString();
      if (studentMap[sid]) {
        studentMap[sid].embeddings.push(emb.embedding);
      }
    });

    const gallery = Object.values(studentMap).filter((s) => s.embeddings.length > 0);

    res.json({
      success: true,
      count: gallery.length,
      gallery,
    });
  } catch (err) {
    console.error('getActiveGallery error:', err);
    res.status(500).json({ success: false, message: 'Server error retrieving student gallery' });
  }
};

/**
 * Helper to push active student biometric gallery directly to AI microservice
 */
async function syncGalleryToAIService() {
  try {
    const students = await Student.find({ status: 'active', enrollmentStatus: 'enrolled' })
      .select('_id fullName rollNumber department className')
      .lean();

    if (!students.length) {
      await aiService.syncGallery([]).catch(() => {});
      return 0;
    }

    const studentIds = students.map((s) => s._id);
    const embeddings = await FaceEmbedding.find({
      studentId: { $in: studentIds },
      isActive: true,
    }).lean();

    const studentMap = {};
    students.forEach((s) => {
      studentMap[s._id.toString()] = {
        student_id: s._id.toString(),
        full_name: s.fullName,
        roll_number: s.rollNumber,
        department: s.department,
        class_name: s.className,
        embeddings: [],
      };
    });

    embeddings.forEach((emb) => {
      const sid = emb.studentId.toString();
      if (studentMap[sid]) {
        studentMap[sid].embeddings.push(emb.embedding);
      }
    });

    const galleryPayload = Object.values(studentMap).filter((s) => s.embeddings.length > 0);

    const res = await aiService.syncGallery(galleryPayload);
    if (res.ok) {
      console.log(`📡 Synced ${galleryPayload.length} students with AI Service gallery`);
    }
    return galleryPayload.length;
  } catch (err) {
    console.warn('Auto sync gallery notice:', err.message);
    return 0;
  }
};
exports.syncGalleryToAIService = syncGalleryToAIService;

/**
 * Trigger manual gallery sync to AI service
 * POST /api/students/sync-gallery
 */
exports.triggerGallerySync = async (req, res) => {
  try {
    const count = await syncGalleryToAIService();
    res.json({
      success: true,
      message: `AI Gallery synchronized — ${count} enrolled student(s) loaded into AI service.`,
      syncedCount: count,
      syncedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('triggerGallerySync error:', err);
    res.status(500).json({ success: false, message: err.message || 'Gallery sync failed' });
  }
};

/**
 * ── Phase 5: Query Recognition Audit Events ───────────────────
 * GET /api/students/recognition-events
 */
exports.getRecognitionEvents = async (req, res) => {
  try {
    const { sessionId, studentId, limit = 50, status } = req.query;
    const filter = {};
    if (sessionId) filter.sessionId = sessionId;
    if (studentId) filter.studentId = studentId;
    if (status) filter.status = status;

    const events = await RecognitionEvent.find(filter)
      .sort({ timestamp: -1 })
      .limit(parseInt(limit, 10))
      .populate('studentId', 'fullName rollNumber department className')
      .lean();

    res.json({
      success: true,
      count: events.length,
      events,
    });
  } catch (err) {
    console.error('getRecognitionEvents error:', err);
    res.status(500).json({ success: false, message: 'Server error retrieving recognition events' });
  }
};

/**
 * Record a single recognition event and broadcast in real-time
 * POST /api/students/recognition-events
 */
exports.recordRecognitionEvent = async (req, res) => {
  try {
    const { sessionId, studentId, trackingId, confidence, bbox, status } = req.body;
    if (!sessionId) {
      return res.status(400).json({ success: false, message: 'sessionId is required' });
    }

    const event = await RecognitionEvent.create({
      sessionId,
      studentId: studentId || undefined,
      trackingId,
      confidence: confidence || 0,
      bbox,
      status: status || 'recognized',
      timestamp: new Date(),
    });

    const populatedEvent = await event.populate('studentId', 'fullName rollNumber department className');

    const io = req.app.get('io');
    if (io) {
      io.to(`session:${sessionId}`).emit('student-recognized', populatedEvent);
    }

    res.status(201).json({ success: true, event: populatedEvent });
  } catch (err) {
    console.error('recordRecognitionEvent error:', err);
    res.status(500).json({ success: false, message: 'Server error recording recognition event' });
  }
};

/**
 * Identify likely test and automated duplicate records
 * Checks for test roll prefixes (TEST-, LIVE-, EVT-TEST-, NOFACE-) or automated test names
 * GET /api/students/candidate-test-records
 */
exports.getCandidateTestRecords = async (req, res) => {
  try {
    const candidates = await Student.find({
      $or: [
        { rollNumber: { $regex: '^(TEST|LIVE|EVT-TEST|NOFACE|SAMPLE)', $options: 'i' } },
        { fullName: { $in: ['Live Test Student', 'No Face Student', 'Multi Face Student', 'Incomplete Student'] } },
      ],
    })
      .select('_id fullName rollNumber registrationNumber department semester className status enrollmentStatus enrolledFaceCount photos createdAt')
      .sort({ createdAt: -1 })
      .lean();

    res.json({
      success: true,
      count: candidates.length,
      candidates: candidates.map((c) => ({
        ...c,
        photosCount: c.photos ? c.photos.length : 0,
      })),
    });
  } catch (err) {
    console.error('getCandidateTestRecords error:', err);
    res.status(500).json({ success: false, message: 'Server error retrieving candidate test records' });
  }
};

/**
 * Safely cleanup explicitly confirmed test records
 * POST /api/students/cleanup-test-records
 */
exports.cleanupTestRecords = async (req, res) => {
  try {
    const { studentIds } = req.body;
    if (!Array.isArray(studentIds) || studentIds.length === 0) {
      return res.status(400).json({ success: false, message: 'No student IDs provided for cleanup' });
    }

    // Safety check: ensure students to be deleted actually match test prefixes
    const studentsToDelete = await Student.find({
      _id: { $in: studentIds },
      $or: [
        { rollNumber: { $regex: '^(TEST|LIVE|EVT-TEST|NOFACE|SAMPLE)', $options: 'i' } },
        { fullName: { $in: ['Live Test Student', 'No Face Student', 'Multi Face Student', 'Incomplete Student', 'Aarav Sharma'] } },
      ],
    });

    if (studentsToDelete.length === 0) {
      return res.status(404).json({ success: false, message: 'No matching test records found for deletion' });
    }

    const idsToDelete = studentsToDelete.map((s) => s._id);

    // Delete photo files from disk
    for (const student of studentsToDelete) {
      if (student.photos && student.photos.length > 0) {
        student.photos.forEach((photo) => {
          if (photo.path) {
            try { fs.unlinkSync(photo.path); } catch (_) {}
          }
        });
      }
    }

    // Delete biometric embeddings and student records
    await Promise.all([
      FaceEmbedding.deleteMany({ studentId: { $in: idsToDelete } }),
      Student.deleteMany({ _id: { $in: idsToDelete } }),
    ]);

    // Resync AI vector gallery if needed
    await syncGalleryToAIService();

    res.json({
      success: true,
      deletedCount: studentsToDelete.length,
      message: `Successfully cleaned up ${studentsToDelete.length} test record(s).`,
    });
  } catch (err) {
    console.error('cleanupTestRecords error:', err);
    res.status(500).json({ success: false, message: 'Server error cleaning up test records' });
  }
};

