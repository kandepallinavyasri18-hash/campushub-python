const mongoose = require('mongoose');

const questionSchema = new mongoose.Schema({
  resource: { type: mongoose.Schema.Types.ObjectId, ref: 'Resource', required: true, index: true },
  askedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  question: { type: String, required: true, trim: true, maxlength: 2000 },
  answer: { type: String, trim: true, default: '' },
  answeredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  answeredAt: { type: Date, default: null }
}, { timestamps: true, versionKey: false });

module.exports = mongoose.model('Question', questionSchema);
