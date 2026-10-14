const express = require('express');
const {
  createSession,
  listSessions,
  getSession,
  updateStatus,
  deleteSession,
} = require('../controllers/cameraController');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

// All camera routes require authentication
router.use(protect);

router.post('/', createSession);
router.get('/', listSessions);
router.get('/:sessionId', getSession);
router.patch('/:sessionId/status', updateStatus);
router.delete('/:sessionId', authorize('admin'), deleteSession);

module.exports = router;
