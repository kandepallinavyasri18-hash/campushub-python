/**
 * Token + cookie helpers.
 *
 * A successful login creates a signed JWT that is stored in an httpOnly
 * cookie. Because the cookie is httpOnly, page scripts cannot read it, and
 * because it is signed with JWT_SECRET it cannot be forged by the browser.
 */
const jwt = require('jsonwebtoken');
const config = require('../config/config');

/** Signs a short-lived session token for a user. */
function signSessionToken(user) {
  return jwt.sign(
    {
      sub: String(user._id),
      role: user.role,
      // The session version lets us invalidate tokens on logout.
      ver: Number(user.tokenVersion || 0)
    },
    config.jwtSecret,
    {
      expiresIn: config.jwtExpiresIn,
      issuer: config.issuer
    }
  );
}

/**
 * Verifies a token. Throws (JsonWebTokenError / TokenExpiredError) when the
 * signature is wrong or the token has expired.
 */
function verifySessionToken(token) {
  return jwt.verify(token, config.jwtSecret, { issuer: config.issuer });
}

/** Cookie flags shared by set and clear operations. */
function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProduction, // HTTPS only in production
    path: '/',
    maxAge: config.cookieMaxAgeMs
  };
}

function setSessionCookie(res, token) {
  res.cookie(config.cookieName, token, cookieOptions());
}

function clearSessionCookie(res) {
  const options = cookieOptions();
  delete options.maxAge;
  res.clearCookie(config.cookieName, options);
}

/**
 * Reads the session token from the request, either from the httpOnly cookie
 * (browser use) or from an `Authorization: Bearer <token>` header (API tools
 * such as curl or Postman).
 */
function extractToken(req) {
  const cookieToken = req.cookies ? req.cookies[config.cookieName] : null;
  if (cookieToken) { return cookieToken; }

  const header = req.headers.authorization || '';
  if (header.toLowerCase().startsWith('bearer ')) {
    return header.slice(7).trim();
  }
  return null;
}

module.exports = {
  signSessionToken,
  verifySessionToken,
  cookieOptions,
  setSessionCookie,
  clearSessionCookie,
  extractToken
};
