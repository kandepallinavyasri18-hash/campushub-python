/**
 * Authentication & role-based authorization middleware.
 *
 * Two flavours are exported:
 *   - API guards  (requireAuth, authorizeRoles, optionalAuth)  -> JSON errors
 *   - page guards (requirePageAuth, redirectIfAuthenticated)   -> HTTP redirects
 *
 * The important detail: the user's role is always re-read from the database.
 * Even if somebody crafts a cookie with a different role, the database value
 * decides what they are allowed to see.
 */
const User = require('../models/User');
const { ALL_ROLES } = User;
const {
  extractToken,
  verifySessionToken,
  clearSessionCookie
} = require('../utils/token');

/** Loads the user referenced by the session token, or null. */
async function resolveSessionUser(req) {
  const token = extractToken(req);
  if (!token) { return { user: null, reason: 'no_token' }; }

  let payload;
  try {
    payload = verifySessionToken(token);
  } catch (error) {
    return { user: null, reason: error.name === 'TokenExpiredError' ? 'expired' : 'invalid' };
  }

  // The role inside the token is only a hint; the database is authoritative.
  const user = await User.findById(payload.sub);
  if (!user) { return { user: null, reason: 'user_missing' }; }

  // A token that was issued before the last logout must not work any more.
  if (Number(payload.ver || 0) !== Number(user.tokenVersion || 0)) {
    return { user: null, reason: 'revoked' };
  }

  return { user, reason: null };
}

/**
 * Ends every outstanding session of a user by bumping the session version.
 * Used by logout so a copied cookie cannot be replayed afterwards.
 */
async function revokeUserSessions(userId) {
  if (!userId) { return; }
  await User.updateOne({ _id: userId }, { $inc: { tokenVersion: 1 } });
}

/**
 * Attaches req.user when a valid session exists, but never blocks the request.
 * Used by GET /api/auth/me so the front-end can ask "who am I?" without a 401.
 */
async function optionalAuth(req, res, next) {
  try {
    const { user, reason } = await resolveSessionUser(req);
    req.user = user;
    req.sessionProblem = reason;

    // A stale cookie should not linger in the browser.
    if (!user && reason && reason !== 'no_token') {
      clearSessionCookie(res);
    }

    return next();
  } catch (error) {
    return next(error);
  }
}

/** Blocks the request with 401 when there is no valid session. */
async function requireAuth(req, res, next) {
  try {
    const { user, reason } = await resolveSessionUser(req);

    if (!user) {
      const messages = {
        no_token: 'You must be logged in to do that.',
        expired: 'Your session has expired. Please log in again.',
        invalid: 'Your session is not valid. Please log in again.',
        revoked: 'Your session has ended. Please log in again.',
        user_missing: 'This account no longer exists. Please register or log in again.'
      };
      return res.status(401).json({
        success: false,
        code: 'UNAUTHENTICATED',
        reason,
        message: messages[reason] || 'Please log in to continue.'
      });
    }

    req.user = user;
    return next();
  } catch (error) {
    return next(error);
  }
}

/**
 * Allows the request only when the logged-in user has one of the given roles.
 * Must be used after requireAuth.
 * @param {...string} roles
 */
function authorizeRoles(...roles) {
  return function roleGuard(req, res, next) {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        code: 'UNAUTHENTICATED',
        message: 'Please log in to continue.'
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        code: 'FORBIDDEN',
        message: `This action requires the following role: ${roles.join(' or ')}.`,
        yourRole: req.user.role
      });
    }

    return next();
  };
}

/**
 * Page guard: protects an .html file served by Express.
 * Unauthenticated visitors are redirected to the login page with a hint about
 * where they wanted to go, and the wrong role is sent to their own dashboard.
 */
function requirePageAuth(role) {
  return async function pageGuard(req, res, next) {
    try {
      const { user, reason } = await resolveSessionUser(req);

      if (!user) {
        if (reason && reason !== 'no_token') { clearSessionCookie(res); }

        const next_ = encodeURIComponent(req.originalUrl || req.path);
        return res.redirect(`/login.html?error=auth_required&next=${next_}`);
      }

      req.user = user;

      if (role && user.role !== role) {
        // Logged in, but this dashboard belongs to another role.
        return res.redirect('/login.html?error=role_not_allowed');
      }

      return next();
    } catch (error) {
      return next(error);
    }
  };
}

/**
 * Guest-only pages (login / register): a logged-in user is sent straight to
 * the dashboard that matches their role instead of seeing the form again.
 */
function redirectIfAuthenticated() {
  const dashboards = {
    student: '/student-dashboard.html',
    faculty: '/faculty-dashboard.html',
    admin: '/admin-dashboard.html'
  };

  return async function guestGuard(req, res, next) {
    try {
      const { user } = await resolveSessionUser(req);
      if (user && dashboards[user.role]) {
        return res.redirect(dashboards[user.role]);
      }
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = {
  ALL_ROLES,
  resolveSessionUser,
  revokeUserSessions,
  optionalAuth,
  requireAuth,
  authorizeRoles,
  requirePageAuth,
  redirectIfAuthenticated
};
