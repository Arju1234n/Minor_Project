const express = require('express');
const { getStats, getEvents, recordEvent } = require('../controllers/dashboardController');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

router.use(protect);

router.get('/stats', authorize('admin'), getStats);
router.get('/events', authorize('admin'), getEvents);
router.post('/events', recordEvent); // Can be called by authenticated users or operator dashboard

module.exports = router;
