/**
 * User model - the only collection this step needs.
 *
 * Fields required by the specification:
 *   fullName, email, password (hashed), role, createdAt
 *
 * Passwords are hashed with bcrypt in a pre-save hook, so no code path can
 * accidentally store a plain-text password.
 */
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const config = require('../config/config');

const ROLES = Object.freeze({
  STUDENT: 'student',
  FACULTY: 'faculty',
  ADMIN: 'admin'
});

const ALL_ROLES = Object.values(ROLES);

// Roles a visitor is allowed to pick on the public registration form.
// Admin is deliberately excluded and is created by `npm run create-admin`.
const SELF_REGISTER_ROLES = [ROLES.STUDENT, ROLES.FACULTY];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;

const userSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: [true, 'Full name is required.'],
      trim: true,
      minlength: [3, 'Full name must be at least 3 characters long.'],
      maxlength: [80, 'Full name cannot be longer than 80 characters.']
    },
    email: {
      type: String,
      required: [true, 'Email is required.'],
      trim: true,
      lowercase: true,
      unique: true,
      index: true,
      maxlength: [254, 'Email cannot be longer than 254 characters.'],
      match: [EMAIL_PATTERN, 'Please provide a valid email address.']
    },
    password: {
      type: String,
      required: [true, 'Password is required.'],
      minlength: [6, 'Password must be at least 6 characters long.'],
      // Never returned by a normal query: you must ask for it explicitly
      // with .select('+password'), which only the login controller does.
      select: false
    },
    role: {
      type: String,
      required: [true, 'Role is required.'],
      enum: {
        values: ALL_ROLES,
        message: 'Role must be one of: student, faculty, admin.'
      },
      default: ROLES.STUDENT,
      lowercase: true,
      index: true
    },
    branch: {
      type: String,
      trim: true,
      maxlength: [100, 'Branch cannot be longer than 100 characters.'],
      default: ''
    },
    createdAt: {
      type: Date,
      default: Date.now
    },
    /**
     * Session version. It is copied into every token that is issued and
     * checked on every request; logging out increments it, which instantly
     * invalidates every token that was handed out before (so a stolen cookie
     * cannot be replayed after the user logged out).
     */
    tokenVersion: {
      type: Number,
      default: 0
    }
  },
  {
    timestamps: { createdAt: true, updatedAt: true },
    versionKey: false
  }
);

/* ------------------------------------------------------------------ *
 * Password hashing
 * ------------------------------------------------------------------ */
userSchema.pre('save', async function hashPassword(next) {
  // Only hash when the password is new or has changed.
  if (!this.isModified('password')) { return next(); }

  try {
    const salt = await bcrypt.genSalt(config.bcryptSaltRounds);
    this.password = await bcrypt.hash(this.password, salt);
    return next();
  } catch (error) {
    return next(error);
  }
});

/* ------------------------------------------------------------------ *
 * Instance helpers
 * ------------------------------------------------------------------ */

/** Compares a plain-text candidate with the stored hash. */
userSchema.methods.comparePassword = function comparePassword(candidate) {
  if (!candidate || !this.password) { return Promise.resolve(false); }
  return bcrypt.compare(String(candidate), this.password);
};

/**
 * The safe, "public" shape of a user document.
 * The password hash and the internal session version are never part of it.
 */
userSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    id: String(this._id),
    fullName: this.fullName,
    email: this.email,
    role: this.role,
    branch: this.branch || '',
    createdAt: this.createdAt
  };
};

/* ------------------------------------------------------------------ *
 * Static helpers
 * ------------------------------------------------------------------ */

/** Finds a user by email, including the password hash (for login only). */
userSchema.statics.findByEmailWithPassword = function findByEmailWithPassword(email) {
  return this.findOne({ email: String(email || '').trim().toLowerCase() }).select('+password');
};

module.exports = mongoose.model('User', userSchema);
module.exports.ROLES = ROLES;
module.exports.ALL_ROLES = ALL_ROLES;
module.exports.SELF_REGISTER_ROLES = SELF_REGISTER_ROLES;
