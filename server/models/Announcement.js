const mongoose = require('mongoose');

const audienceValues = ['all', 'student', 'faculty', 'admin'];

const announcementSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Announcement title is required.'],
      trim: true,
      maxlength: [120, 'Announcement title cannot exceed 120 characters.']
    },
    message: {
      type: String,
      required: [true, 'Announcement message is required.'],
      trim: true,
      maxlength: [2000, 'Announcement message cannot exceed 2000 characters.']
    },
    audience: {
      type: String,
      enum: {
        values: audienceValues,
        message: 'Audience must be all, student, faculty, or admin.'
      },
      default: 'all',
      lowercase: true,
      index: true
    },
    publishedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Publisher is required.']
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true
    }
  },
  {
    timestamps: { createdAt: true, updatedAt: true },
    versionKey: false
  }
);

announcementSchema.index({ audience: 1, isActive: 1, createdAt: -1 });

module.exports = mongoose.model('Announcement', announcementSchema);
module.exports.AUDIENCE_VALUES = audienceValues;
