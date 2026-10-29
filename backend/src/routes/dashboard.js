const express = require('express');
const {
  getStats,
  getEvents,
  recordEvent,
  deleteEvents,
  getGalleryStatus,
  triggerGallerySync,
} = require('../controllers/dashboardController');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

router.use(protect);

router.get('/stats', authorize('admin'), getStats);
router.get('/events', authorize('admin'), getEvents);
router.post('/events', recordEvent);
router.delete('/events', authorize('admin'), deleteEvents);

// Face Gallery Status & Manual Sync
router.get('/gallery-status', authorize('admin'), getGalleryStatus);
router.post('/sync-gallery', authorize('admin'), triggerGallerySync);

module.exports = router;
