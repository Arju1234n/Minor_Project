const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { protect } = require('../middleware/auth');
const studentController = require('../controllers/studentController');

// Ensure uploads/faces directory exists
const uploadDir = path.resolve(__dirname, '../../uploads/faces');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer disk storage setup
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `face-${uniqueSuffix}${ext}`);
  },
});

// File filter: accept only image formats with matching extensions
const fileFilter = (_req, file, cb) => {
  const allowedMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
  const allowedExts = ['.jpg', '.jpeg', '.png', '.webp'];
  const ext = path.extname(file.originalname || '').toLowerCase();

  if (allowedMimes.includes(file.mimetype) && allowedExts.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid image format. Only JPEG, PNG, and WebP are supported.'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB per image
    files: 5,                  // Max 5 photos for enrollment
  },
});

// Active Face Gallery export for AI microservice (must be before protect and before /:id)
router.get('/active-gallery', studentController.getActiveGallery);

// All subsequent routes require authentication
router.use(protect);

router.post('/sync-gallery', studentController.triggerGallerySync);

router.route('/')
  .get(studentController.getStudents)
  .post(upload.array('facePhotos', 5), studentController.createStudent);

// Candidate test records review & explicit cleanup (must be before /:id)
router.get('/candidate-test-records', studentController.getCandidateTestRecords);
router.post('/cleanup-test-records', studentController.cleanupTestRecords);

// Face Recognition Audit Events (must be before /:id)
router.get('/recognition-events', studentController.getRecognitionEvents);
router.post('/recognition-events', studentController.recordRecognitionEvent);

router.route('/:id')
  .get(studentController.getStudentById)
  .put(upload.array('facePhotos', 5), studentController.updateStudent)
  .delete(studentController.deleteStudent);

router.patch('/:id/status', studentController.toggleStudentStatus);

// Face Biometric Enrollment Endpoints — Phase 2
router.post('/:id/enroll', upload.array('facePhotos', 5), studentController.enrollStudentFace);
router.get('/:id/enrollment', studentController.getStudentEnrollment);
router.delete('/:id/enrollment', studentController.deleteStudentEnrollment);

module.exports = router;
