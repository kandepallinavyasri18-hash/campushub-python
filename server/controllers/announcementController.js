const Announcement = require('../models/Announcement');
const { AUDIENCE_VALUES } = require('../models/Announcement');

function serializeAnnouncement(announcement) {
  return {
    id: String(announcement._id),
    title: announcement.title,
    message: announcement.message,
    audience: announcement.audience,
    publishedBy: announcement.publishedBy && typeof announcement.publishedBy === 'object'
      ? {
          id: String(announcement.publishedBy._id),
          fullName: announcement.publishedBy.fullName,
          role: announcement.publishedBy.role
        }
      : announcement.publishedBy || null,
    createdAt: announcement.createdAt,
    updatedAt: announcement.updatedAt,
    isActive: announcement.isActive
  };
}

async function listAnnouncements(req, res, next) {
  try {
    const announcements = await Announcement.find({ isActive: true })
      .sort({ createdAt: -1 })
      .populate('publishedBy', 'fullName role');

    return res.status(200).json({
      success: true,
      announcements: announcements.map(serializeAnnouncement)
    });
  } catch (error) {
    return next(error);
  }
}

async function createAnnouncement(req, res, next) {
  try {
    const title = String(req.body.title || '').trim();
    const message = String(req.body.message || '').trim();
    const audience = String(req.body.audience || 'all').trim().toLowerCase();

    if (!title || title.length < 3) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Announcement title is required and must be at least 3 characters long.'
      });
    }

    if (!message || message.length < 10) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Announcement message is required and must be at least 10 characters long.'
      });
    }

    if (!AUDIENCE_VALUES.includes(audience)) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Audience must be all, student, faculty, or admin.'
      });
    }

    const announcement = await Announcement.create({
      title,
      message,
      audience,
      publishedBy: req.user._id,
      isActive: true
    });

    const populated = await announcement.populate('publishedBy', 'fullName role');

    return res.status(201).json({
      success: true,
      message: 'Announcement published successfully.',
      announcement: serializeAnnouncement(populated)
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = { listAnnouncements, createAnnouncement, serializeAnnouncement };
