const express = require('express');
const { listResources, listMyResources, createResource, removeResource, previewResource, downloadResource } = require('../controllers/resourceController');
const { requireAuth, authorizeRoles } = require('../middleware/authMiddleware');
const upload = require('../middleware/upload');
const { listQuestions, askQuestion, answerQuestion } = require('../controllers/questionController');

const router = express.Router();

router.get('/', listResources);
router.get('/my', requireAuth, authorizeRoles('faculty', 'student'), listMyResources);
router.get('/:id/preview', requireAuth, previewResource);
router.get('/:id/download', requireAuth, downloadResource);
router.post('/', requireAuth, authorizeRoles('faculty', 'student'), upload.single('file'), createResource);
router.delete('/:id', requireAuth, removeResource);

module.exports = router;
