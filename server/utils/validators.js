/**
 * Input validation for the authentication endpoints.
 *
 * Kept dependency-free on purpose (no validation library) so the rules are
 * easy to read and adjust. The same rules are mirrored in js/script.js for
 * instant feedback, but the server is always the source of truth.
 */
const { ALL_ROLES, SELF_REGISTER_ROLES } = require('../models/User');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;

const LIMITS = {
  fullNameMin: 3,
  fullNameMax: 80,
  passwordMin: 6,
  passwordMax: 128,
  emailMax: 254
};

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isValidEmail(value) {
  const email = normalizeEmail(value);
  return Boolean(email) && email.length <= LIMITS.emailMax && EMAIL_PATTERN.test(email);
}

/**
 * Validates a registration payload.
 * @returns {{ valid: boolean, errors: Object, values: Object }}
 */
function validateRegistration(payload = {}) {
  const errors = {};

  const values = {
    fullName: String(payload.fullName || '').trim().replace(/\s+/g, ' '),
    email: normalizeEmail(payload.email),
    password: typeof payload.password === 'string' ? payload.password : '',
    confirmPassword: typeof payload.confirmPassword === 'string' ? payload.confirmPassword : '',
    role: String(payload.role || '').trim().toLowerCase()
    ,branch: String(payload.branch || '').trim().replace(/\s+/g, ' ')
  };

  // ---- Full name ----
  if (!values.fullName) {
    errors.fullName = 'Full name is required.';
  } else if (values.fullName.length < LIMITS.fullNameMin) {
    errors.fullName = `Full name must be at least ${LIMITS.fullNameMin} characters long.`;
  } else if (values.fullName.length > LIMITS.fullNameMax) {
    errors.fullName = `Full name cannot be longer than ${LIMITS.fullNameMax} characters.`;
  }

  // ---- Email ----
  if (!values.email) {
    errors.email = 'Email is required.';
  } else if (!isValidEmail(values.email)) {
    errors.email = 'Please enter a valid email address.';
  } else if (values.email.length > LIMITS.emailMax) {
    errors.email = `Email cannot be longer than ${LIMITS.emailMax} characters.`;
  }

  // ---- Password ----
  if (!values.password) {
    errors.password = 'Password is required.';
  } else if (values.password.length < LIMITS.passwordMin) {
    errors.password = `Password must be at least ${LIMITS.passwordMin} characters long.`;
  } else if (values.password.length > LIMITS.passwordMax) {
    errors.password = `Password cannot be longer than ${LIMITS.passwordMax} characters.`;
  }

  // ---- Confirm password ----
  if (!values.confirmPassword) {
    errors.confirmPassword = 'Please confirm your password.';
  } else if (values.password && values.password !== values.confirmPassword) {
    errors.confirmPassword = 'The two passwords do not match.';
  }

  // ---- Role ----
  if (!values.role) {
    errors.role = 'Please select a role: student or faculty.';
  } else if (values.role === 'admin') {
    // Admin accounts can never be created through the public form.
    errors.role = 'Admin accounts cannot be created through registration. ' +
      'Please contact the campus administrator.';
  } else if (!ALL_ROLES.includes(values.role)) {
    errors.role = 'Role must be either student or faculty.';
  } else if (!SELF_REGISTER_ROLES.includes(values.role)) {
    errors.role = 'That role cannot be self-registered.';
  }

  return { valid: Object.keys(errors).length === 0, errors, values };
}

/**
 * Validates a login payload.
 * @returns {{ valid: boolean, errors: Object, values: Object }}
 */
function validateLogin(payload = {}) {
  const errors = {};
  const values = {
    email: normalizeEmail(payload.email),
    password: typeof payload.password === 'string' ? payload.password : ''
  };

  if (!values.email) {
    errors.email = 'Email is required.';
  } else if (!isValidEmail(values.email)) {
    errors.email = 'Please enter a valid email address.';
  }

  if (!values.password) {
    errors.password = 'Password is required.';
  }

  return { valid: Object.keys(errors).length === 0, errors, values };
}

module.exports = {
  LIMITS,
  EMAIL_PATTERN,
  normalizeEmail,
  isValidEmail,
  validateRegistration,
  validateLogin
};
