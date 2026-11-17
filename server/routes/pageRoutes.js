/**
 * Page + static-asset routes.
 *
 * The front-end lives in the project root (index.html, css/, js/), which is
 * also where .env, package.json and server/ live. To make sure none of those
 * sensitive files can ever be downloaded, we do NOT serve the project root
 * with express.static. Instead:
 *   - only /css and /js are served as static folders
 *   - every .html page is registered explicitly below
 *   - the dashboards run through requirePageAuth(), so they are protected
 *     on the server (not just in the browser)
 */
const express = require('express');
const path = require('path');
const config = require('../config/config');
const { requirePageAuth, redirectIfAuthenticated, resolveSessionUser, revokeUserSessions } =
  require('../middleware/authMiddleware');
const { clearSessionCookie } = require('../utils/token');

const PAGES = {
  home: 'index.html',
  register: 'register.html',
  login: 'login.html',
  studentDashboard: 'student-dashboard.html',
  facultyDashboard: 'faculty-dashboard.html',
  adminDashboard: 'admin-dashboard.html'
};

/** Sends one of the known HTML files. */
function sendPage(fileName, options = {}) {
  const absolutePath = path.join(config.projectRoot, fileName);

  return function pageHandler(req, res, next) {
    if (options.noStore) {
      // Protected pages must not be stored, so the browser back button cannot
      // show a dashboard after the user logged out.
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.set('Pragma', 'no-cache');
    }
    res.sendFile(absolutePath, (error) => (error ? next(error) : undefined));
  };
}

function mountPageRoutes(app) {
  /* ---- Static assets (scoped folders only) ---- */
  app.use(
    '/css',
    express.static(path.join(config.projectRoot, 'css'), { maxAge: '1h', index: false })
  );
  app.use(
    '/js',
    express.static(path.join(config.projectRoot, 'js'), { maxAge: '1h', index: false })
  );

  /* ---- Public pages ---- */
  app.get(['/', '/index.html'], sendPage(PAGES.home));
  app.get('/register.html', redirectIfAuthenticated(), sendPage(PAGES.register));
  app.get('/login.html', redirectIfAuthenticated(), sendPage(PAGES.login));

  /* ---- Protected dashboards (authentication + role check) ---- */
  app.get(
    '/student-dashboard.html',
    requirePageAuth('student'),
    sendPage(PAGES.studentDashboard, { noStore: true })
  );
  app.get(
    '/faculty-dashboard.html',
    requirePageAuth('faculty'),
    sendPage(PAGES.facultyDashboard, { noStore: true })
  );
  app.get(
    '/admin-dashboard.html',
    requirePageAuth('admin'),
    sendPage(PAGES.adminDashboard, { noStore: true })
  );

  /* ---- Friendly aliases ---- */
  app.get('/dashboard', requirePageAuth(), redirectToRoleDashboard);
  app.get('/dashboard.html', requirePageAuth(), redirectToRoleDashboard);

  // GET /logout is a convenience fallback so a plain link can log the user
  // out even if JavaScript is unavailable. The real endpoint is
  // POST /api/auth/logout, which is what the pages call.
  app.get('/logout', async (req, res, next) => {
    try {
      const { user } = await resolveSessionUser(req);
      if (user) { await revokeUserSessions(user._id); }
      clearSessionCookie(res);
      res.redirect('/login.html?loggedout=1');
    } catch (error) {
      next(error);
    }
  });
}

function redirectToRoleDashboard(req, res) {
  const dashboards = {
    student: '/student-dashboard.html',
    faculty: '/faculty-dashboard.html',
    admin: '/admin-dashboard.html'
  };
  const target = dashboards[req.user.role];
  if (target) { return res.redirect(target); }
  return res.redirect('/index.html');
}

module.exports = { mountPageRoutes, PAGES };
