const express = require('express');
const { requireAuth } = require('../middleware/authMiddleware');
const { listNotifications, markNotificationRead } = require('../controllers/notificationController');

const router = express.Router();
router.use(requireAuth);
router.get('/', listNotifications);
router.patch('/:id/read', markNotificationRead);
module.exports = router;
