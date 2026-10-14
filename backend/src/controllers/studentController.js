const Student = require('../models/Student');
const FaceEmbedding = require('../models/FaceEmbedding');
const fs = require('fs');
const path = require('path');

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

    // Validate required fields
    if (!fullName || !rollNumber || !department || !semester || !className) {
      return res.status(400).json({
        success: false,
        message: 'Please provide full name, roll number, department, semester, and class.',
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

    const student = await Student.create({
      fullName: fullName.trim(),
      rollNumber: cleanRoll,
      registrationNumber: cleanReg,
      department: department.trim(),
      semester: parseInt(semester, 10),
      className: className.trim(),
      photos,
      enrolledFaceCount: photos.length,
      enrollmentStatus: photos.length > 0 ? 'pending' : 'pending',
      createdBy: req.user?._id,
    });

    res.status(201).json({
      success: true,
      message: 'Student registered successfully',
      student,
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

    // Free text search on full name or roll number
    if (search && search.trim()) {
      const term = search.trim();
      query.$or = [
        { fullName: { $regex: term, $options: 'i' } },
        { rollNumber: { $regex: term, $options: 'i' } },
        { registrationNumber: { $regex: term, $options: 'i' } },
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
              $sum: { $cond: [{ $eq: ['$enrollmentStatus', 'enrolled'] }, 1, 0] },
            },
            pendingEnrollment: {
              $sum: { $cond: [{ $eq: ['$enrollmentStatus', 'pending'] }, 1, 0] },
            },
          },
        },
      ]),
    ]);

    // Distinct departments and classes for filter dropdowns
    const [departments, classes] = await Promise.all([
      Student.distinct('department'),
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
        departments: departments.sort(),
        classes: classes.sort(),
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
      student.enrolledFaceCount = student.photos.length;
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

      return res.json({
        success: true,
        message: `Student "${student.fullName}" and all biometric data permanently deleted.`,
      });
    }

    // Soft delete: toggle to inactive
    student.status = 'inactive';
    await student.save();

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
const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

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
        const aiRes = await fetch(`${AI_SERVICE_URL}/api/ai/enroll-face`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image_path: photo.path }),
        });

        const aiData = await aiRes.json();

        if (!aiRes.ok || !aiData.success) {
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

    res.json({
      success: true,
      message: `Successfully enrolled ${embeddingDocs.length} face photograph(s) for "${student.fullName}".`,
      student,
      enrolledCount: embeddingDocs.length,
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
