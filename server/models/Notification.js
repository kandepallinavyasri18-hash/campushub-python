const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type: { type: String, enum: ['question'], required: true },
  question: { type: mongoose.Schema.Types.ObjectId, ref: 'Question', required: true },
  resource: { type: mongoose.Schema.Types.ObjectId, ref: 'Resource', required: true },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  readAt: { type: Date, default: null }
}, { timestamps: true, versionKey: false });

notificationSchema.index({ recipient: 1, readAt: 1, createdAt: -1 });
module.exports = mongoose.model('Notification', notificationSchema);
