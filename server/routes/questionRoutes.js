const express = require('express');
const { requireAuth } = require('../middleware/authMiddleware');
const { listQuestions, askQuestion, answerQuestion } = require('../controllers/questionController');

const router = express.Router();
router.get('/', requireAuth, listQuestions);
router.post('/', requireAuth, askQuestion);
router.post('/:id/answers', requireAuth, answerQuestion);
module.exports = router;
