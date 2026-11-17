/**
 * 404 + central error handling.
 *
 * API requests always receive JSON; page requests receive a small HTML page.
 * Stack traces are only logged on the server, never sent to the browser.
 */
const config = require('../config/config');

const NOT_FOUND_HTML = (url) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Page not found - CampusHub</title>
  <link rel="stylesheet" href="/css/style.css" />
</head>
<body data-page="not-found">
  <header class="site-header">
    <div class="container header-inner">
      <a class="brand" href="/index.html">
        <span class="brand-mark" aria-hidden="true">&#127891;</span>
        <span class="brand-text">Campus<span>Hub</span></span>
      </a>
      <nav class="site-nav" aria-label="Main navigation">
        <a href="/index.html">Home</a>
        <a href="/login.html">Login</a>
        <a href="/register.html">Register</a>
      </nav>
    </div>
  </header>
  <main class="auth-main">
    <div class="container">
      <section class="auth-card" style="margin:0 auto;">
        <h1>404 - Page not found</h1>
        <p class="muted small">CampusHub could not find <code>${url.replace(/[<>&]/g, '')}</code>.</p>
        <p><a class="btn btn-primary" href="/index.html">Back to the home page</a></p>
      </section>
    </div>
  </main>
</body>
</html>`;

/** 404 handler for anything that was not matched. */
function notFound(req, res) {
  if (req.path.startsWith('/api/') || req.path === '/api') {
    return res.status(404).json({
      success: false,
      code: 'NOT_FOUND',
      message: `No API endpoint matches ${req.method} ${req.originalUrl}.`
    });
  }

  return res.status(404).type('html').send(NOT_FOUND_HTML(req.originalUrl));
}

/** Central error handler (must keep all four arguments). */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let status = err.status || err.statusCode || 500;
  let message = err.message || 'Something went wrong on the server.';
  let errors;

  // Mongoose validation errors -> 400 with per-field messages.
  if (err.name === 'ValidationError' && err.errors) {
    status = 400;
    message = 'Please correct the highlighted fields.';
    errors = {};
    Object.keys(err.errors).forEach((key) => {
      errors[key] = err.errors[key].message;
    });
  }

  // Malformed ObjectId in a URL such as /api/users/abc
  if (err.name === 'CastError') {
    status = 400;
    message = 'That identifier is not valid.';
  }

  // MongoDB duplicate key (unique email)
  if (err.code === 11000) {
    status = 409;
    message = 'That record already exists.';
    errors = { email: 'That email address is already registered.' };
  }

  if (err.type === 'entity.parse.failed') {
    status = 400;
    message = 'The request body is not valid JSON.';
  }

  if (err.code === 'LIMIT_FILE_SIZE') {
    status = 413;
    message = 'The uploaded document is too large (maximum 20 MB).';
  }

  if (status >= 500) {
    console.error('[error]', err);
    if (config.isProduction) {
      message = 'Something went wrong on the server. Please try again later.';
    }
  }

  if (res.headersSent) { return undefined; }

  if (req.path.startsWith('/api')) {
    return res.status(status).json({
      success: false,
      code: err.code && typeof err.code === 'string' ? err.code : 'ERROR',
      message,
      ...(errors ? { errors } : {})
    });
  }

  return res.status(status).type('html').send(
    `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" />
     <title>Error - CampusHub</title><link rel="stylesheet" href="/css/style.css" /></head>
     <body><main class="auth-main"><div class="container"><section class="auth-card" style="margin:0 auto;">
     <h1>${status}</h1><p class="muted small">${message}</p>
     <p><a class="btn btn-primary" href="/index.html">Back to the home page</a></p>
     </section></div></main></body></html>`
  );
}

module.exports = { notFound, errorHandler };
