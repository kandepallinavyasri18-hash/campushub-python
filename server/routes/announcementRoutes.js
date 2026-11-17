const express = require('express');
const { listAnnouncements, createAnnouncement } = require('../controllers/announcementController');
const { requireAuth, authorizeRoles } = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/', listAnnouncements);
router.post('/', requireAuth, authorizeRoles('admin'), createAnnouncement);

module.exports = router;
