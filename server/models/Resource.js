const mongoose = require('mongoose');

const RESOURCE_CATEGORIES = Object.freeze([
  'Notes',
  'Slides',
  'Question Paper',
  'Assignment',
  'Reference Link',
  'Lab Manual',
  'Syllabus'
]);

const resourceSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Resource title is required.'],
      trim: true,
      maxlength: [120, 'Resource title cannot exceed 120 characters.']
    },
    description: {
      type: String,
      required: [true, 'Resource description is required.'],
      trim: true,
      maxlength: [2000, 'Resource description cannot exceed 2000 characters.']
    },
    branch: {
      type: String,
      trim: true,
      maxlength: 100,
      default: ''
    },
    category: {
      type: String,
      required: [true, 'Category is required.'],
      enum: {
        values: RESOURCE_CATEGORIES,
        message: 'Category must be one of the supported resource categories.'
      },
      trim: true
    },
    url: {
      type: String,
      trim: true,
      default: ''
    },
    originalName: { type: String, trim: true, default: '' },
    fileName: { type: String, trim: true, default: '' },
    mimeType: { type: String, trim: true, default: '' },
    fileSize: { type: Number, default: 0 },
    storagePath: { type: String, trim: true, default: '' },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Uploader is required.']
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

resourceSchema.index({ uploadedBy: 1, createdAt: -1 });
resourceSchema.index({ category: 1, isActive: 1, createdAt: -1 });

module.exports = mongoose.model('Resource', resourceSchema);
module.exports.RESOURCE_CATEGORIES = RESOURCE_CATEGORIES;
