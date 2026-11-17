const Resource = require('../models/Resource');
const Question = require('../models/Question');
const Notification = require('../models/Notification');

function serializeQuestion(q) {
  return {
    id: String(q._id),
    resourceId: String(q.resource._id || q.resource),
    resource: q.resource && q.resource.title ? {
      id: String(q.resource._id),
      title: q.resource.title,
      branch: q.resource.branch || ''
    } : null,
    text: q.question, question: q.question, answer: q.answer || '',
    askedBy: q.askedBy && q.askedBy.fullName ? { id: String(q.askedBy._id), fullName: q.askedBy.fullName } : q.askedBy,
    answeredBy: q.answeredBy && q.answeredBy.fullName ? { id: String(q.answeredBy._id), fullName: q.answeredBy.fullName } : q.answeredBy,
    createdAt: q.createdAt, answeredAt: q.answeredAt
  };
}

async function listQuestions(req, res, next) {
  try {
    const query = req.user.role === 'admin'
      ? {}
      : req.user.role === 'faculty'
        ? { resource: { $in: await Resource.find({ uploadedBy: req.user._id }).distinct('_id') } }
        : {};
    const questions = await Question.find(query)
      .sort({ createdAt: -1 })
      .populate('resource', 'title branch')
      .populate('askedBy', 'fullName')
      .populate('answeredBy', 'fullName');
    return res.json({ success: true, questions: questions.map(serializeQuestion) });
  } catch (error) { return next(error); }
}

async function askQuestion(req, res, next) {
  try {
    if (req.user.role === 'faculty') {
      return res.status(403).json({ success: false, code: 'FORBIDDEN', message: 'Faculty members can answer questions but cannot ask them.' });
    }
    const resource = await Resource.findOne({ _id: req.body.resourceId, isActive: true });
    const text = String(req.body.text || '').trim();
    if (!resource) return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Resource not found.' });
    if (!text) return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: 'Question is required.' });
    const question = await Question.create({ resource: resource._id, askedBy: req.user._id, question: text });
    if (String(resource.uploadedBy) !== String(req.user._id)) {
      await Notification.create({ recipient: resource.uploadedBy, type: 'question', question: question._id, resource: resource._id, actor: req.user._id });
    }
    const populated = await question.populate('askedBy', 'fullName');
    return res.status(201).json({ success: true, question: serializeQuestion(populated) });
  } catch (error) { return next(error); }
}

async function answerQuestion(req, res, next) {
  try {
    const question = await Question.findById(req.params.id).populate('resource');
    if (!question) return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Question not found.' });
    if (String(question.askedBy) === String(req.user._id)) {
      return res.status(403).json({ success: false, code: 'FORBIDDEN', message: 'You cannot answer your own question.' });
    }
    if (!['student', 'faculty', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ success: false, code: 'FORBIDDEN', message: 'You are not allowed to answer questions.' });
    }
    const answer = String(req.body.text || '').trim();
    if (!answer) return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: 'Answer is required.' });
    question.answer = answer; question.answeredBy = req.user._id; question.answeredAt = new Date();
    await question.save();
    const populated = await question.populate('askedBy', 'fullName').then(q => q.populate('answeredBy', 'fullName'));
    return res.json({ success: true, question: serializeQuestion(populated) });
  } catch (error) { return next(error); }
}

module.exports = { listQuestions, askQuestion, answerQuestion };
