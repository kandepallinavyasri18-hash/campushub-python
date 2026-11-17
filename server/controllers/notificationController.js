const Notification = require('../models/Notification');

function serializeNotification(n) {
  const ref = (value, fields) => {
    if (!value) return null;
    if (typeof value !== 'object') return String(value);
    const result = { id: String(value._id) };
    fields.forEach((field) => { if (value[field] !== undefined) result[field] = value[field]; });
    return result;
  };
  return { id: String(n._id), type: n.type, message: n.type === 'question' ? 'You got a question.' : 'You have a new notification.',
    read: Boolean(n.readAt), isRead: Boolean(n.readAt), readAt: n.readAt,
    question: ref(n.question, ['question', 'answer']),
    resource: ref(n.resource, ['title']),
    actor: ref(n.actor, ['fullName']), createdAt: n.createdAt };
}

async function listNotifications(req, res, next) {
  try {
    const notifications = await Notification.find({ recipient: req.user._id }).sort({ createdAt: -1 }).limit(100)
      .populate('question', 'question answer').populate('resource', 'title').populate('actor', 'fullName');
    return res.json({ success: true, notifications: notifications.map(serializeNotification) });
  } catch (error) { return next(error); }
}
async function markNotificationRead(req, res, next) {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, recipient: req.user._id }, { readAt: new Date() }, { new: true }
    );
    if (!notification) return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Notification not found.' });
    return res.json({ success: true, notification: serializeNotification(notification) });
  } catch (error) { return next(error); }
}
module.exports = { listNotifications, markNotificationRead };
