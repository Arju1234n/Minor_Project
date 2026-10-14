const express = require('express');
const { getStats, getEvents, recordEvent, deleteEvents } = require('../controllers/dashboardController');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

router.use(protect);

router.get('/stats', authorize('admin'), getStats);
router.get('/events', authorize('admin'), getEvents);
router.post('/events', recordEvent);
router.delete('/events', authorize('admin'), deleteEvents);

module.exports = router;
