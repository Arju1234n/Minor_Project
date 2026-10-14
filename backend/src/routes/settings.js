const express = require('express');
const router = express.Router();
const settingsController = require('../controllers/settingsController');
const { protect } = require('../middleware/auth');

// All settings routes require JWT authentication
router.use(protect);

router.get('/', settingsController.getSettings);
router.put('/', settingsController.updateSettings);
router.post('/purge', settingsController.purgeRetention);

module.exports = router;
