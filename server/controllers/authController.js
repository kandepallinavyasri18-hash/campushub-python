/**
 * Authentication controller: registration, login, logout and "who am I".
 *
 * Flow implemented here:
 *   register -> validate -> duplicate check -> hash (model hook) -> save
 *   login    -> validate -> find by email (with hash) -> bcrypt compare
 *             -> sign JWT -> set httpOnly cookie -> tell the client which
 *                dashboard matches the role stored in the database
 *   logout   -> clear the cookie
 */
const User = require('../models/User');
const { ROLES } = User;
const { validateRegistration, validateLogin } = require('../utils/validators');
const {
  signSessionToken,
  setSessionCookie,
  clearSessionCookie
} = require('../utils/token');
const { resolveSessionUser, revokeUserSessions } = require('../middleware/authMiddleware');

const DASHBOARDS = {
  [ROLES.STUDENT]: '/student-dashboard.html',
  [ROLES.FACULTY]: '/faculty-dashboard.html',
  [ROLES.ADMIN]: '/admin-dashboard.html'
};

/**
 * POST /api/auth/register
 * Creates a student or faculty account. Admin is rejected by the validator.
 */
async function register(req, res, next) {
  try {
    const { valid, errors, values } = validateRegistration(req.body);

    if (!valid) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Please correct the highlighted fields.',
        errors
      });
    }

    // Duplicate email check (the unique index is the final safety net).
    const existing = await User.findOne({ email: values.email });
    if (existing) {
      return res.status(409).json({
        success: false,
        code: 'EMAIL_TAKEN',
        message: 'That email address is already registered. Try logging in instead.',
        errors: { email: 'That email address is already registered.' }
      });
    }

    const user = await User.create({
      fullName: values.fullName,
      email: values.email,
      password: values.password, // hashed by the pre-save hook
      role: values.role
      ,branch: values.branch
    });

    return res.status(201).json({
      success: true,
      message: 'Your account was created successfully. Please log in.',
      user: user.toPublicJSON(),
      redirectTo: '/login.html?registered=1'
    });
  } catch (error) {
    // Duplicate key can still happen on a race between two requests.
    if (error && error.code === 11000) {
      return res.status(409).json({
        success: false,
        code: 'EMAIL_TAKEN',
        message: 'That email address is already registered. Try logging in instead.',
        errors: { email: 'That email address is already registered.' }
      });
    }
    return next(error);
  }
}

/**
 * POST /api/auth/login
 * Verifies the credentials and starts a session using an httpOnly cookie.
 */
async function login(req, res, next) {
  try {
    const { valid, errors, values } = validateLogin(req.body);

    if (!valid) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Please enter your email and password.',
        errors
      });
    }

    const user = await User.findByEmailWithPassword(values.email);

    // Same message for "unknown email" and "wrong password" so the endpoint
    // cannot be used to discover which emails exist.
    if (!user) {
      return res.status(401).json({
        success: false,
        code: 'INVALID_CREDENTIALS',
        message: 'Incorrect email or password.',
        errors: { password: 'Incorrect email or password.' }
      });
    }

    const passwordMatches = await user.comparePassword(values.password);
    if (!passwordMatches) {
      return res.status(401).json({
        success: false,
        code: 'INVALID_CREDENTIALS',
        message: 'Incorrect email or password.',
        errors: { password: 'Incorrect email or password.' }
      });
    }

    // Credentials are correct -> start the session. The role used for the
    // redirect comes from the database document, never from the request body.
    const token = signSessionToken(user);
    setSessionCookie(res, token);

    return res.status(200).json({
      success: true,
      message: `Welcome back, ${user.fullName}!`,
      user: user.toPublicJSON(),
      redirectTo: DASHBOARDS[user.role] || '/index.html'
    });
  } catch (error) {
    return next(error);
  }
}

/**
 * POST /api/auth/logout - ends the session.
 * The cookie is deleted in the browser and, on the server, the session version
 * is bumped so any copy of the old token stops working immediately.
 */
async function logout(req, res, next) {
  try {
    // Identify the caller without failing the request when the token is
    // already invalid - logging out should always succeed.
    const { user } = await resolveSessionUser(req);
    if (user) {
      await revokeUserSessions(user._id);
    }

    clearSessionCookie(res);
    return res.status(200).json({
      success: true,
      message: 'You have been logged out.',
      redirectTo: '/login.html?loggedout=1'
    });
  } catch (error) {
    return next(error);
  }
}

/**
 * GET /api/auth/me - returns the signed-in user, or `authenticated: false`.
 * Always 200 so the front-end can simply ask "who am I?" on every page.
 */
async function me(req, res) {
  if (!req.user) {
    return res.status(200).json({ success: true, authenticated: false, user: null });
  }

  return res.status(200).json({
    success: true,
    authenticated: true,
    user: req.user.toPublicJSON(),
    dashboard: DASHBOARDS[req.user.role] || null
  });
}

module.exports = { register, login, logout, me, DASHBOARDS };
