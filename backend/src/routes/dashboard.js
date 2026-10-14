const express = require('express');
const { getStats, getEvents } = require('../controllers/dashboardController');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

router.use(protect);
router.use(authorize('admin'));

router.get('/stats', getStats);
router.get('/events', getEvents);

module.exports = router;
