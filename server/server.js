/**
 * CampusHub server entry point.
 *
 * Start it with:  npm start        (or: node server/server.js)
 * Development:    npm run dev      (nodemon restarts on file changes)
 *
 * Order of work at boot:
 *   1. validate configuration (fails fast if .env is wrong)
 *   2. connect to MongoDB
 *   3. mount middleware, API routes and page routes
 *   4. listen for HTTP requests
 */
const express = require('express');
const cookieParser = require('cookie-parser');

const config = require('./config/config');
const { connectDB, disconnectDB } = require('./config/db');
const authRoutes = require('./routes/authRoutes');
const announcementRoutes = require('./routes/announcementRoutes');
const resourceRoutes = require('./routes/resourceRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const questionRoutes = require('./routes/questionRoutes');
const { mountPageRoutes } = require('./routes/pageRoutes');
const { notFound, errorHandler } = require('./middleware/errorHandler');

/** Small set of security headers - avoids adding a dependency for this. */
function securityHeaders(req, res, next) {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'same-origin');
  res.set('X-XSS-Protection', '0'); // modern browsers: rely on CSP instead
  next();
}

/** Builds the Express application (exported so the tests can reuse it). */
function createApp() {
  const app = express();

  app.disable('x-powered-by');
  // Needed for secure cookies when running behind a reverse proxy / hosting.
  app.set('trust proxy', 1);

  app.use(securityHeaders);
  app.use(express.json({ limit: '20kb' }));
  app.use(express.urlencoded({ extended: false, limit: '20kb' }));
  app.use(cookieParser());

  /* ---- API ---- */
  app.get('/api/health', (req, res) => {
    res.json({
      success: true,
      service: 'CampusHub',
      environment: config.env,
      time: new Date().toISOString()
    });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/announcements', announcementRoutes);
  app.use('/api/resources', resourceRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/questions', questionRoutes);

  // Unknown API endpoints answer with JSON instead of HTML.
  app.use('/api', (req, res) => {
    res.status(404).json({
      success: false,
      code: 'NOT_FOUND',
      message: `No API endpoint matches ${req.method} ${req.originalUrl}.`
    });
  });

  /* ---- Pages + static assets ---- */
  mountPageRoutes(app);

  /* ---- 404 + errors ---- */
  app.use(notFound);
  app.use(errorHandler);

  return app;
}

/**
 * Starts the server.
 * @param {number} [port] optional port override (used by the tests)
 * @returns {Promise<import('http').Server>}
 */
async function start(port) {
  config.assertConfig();

  const app = createApp();
  await connectDB();

  const listenPort = typeof port === 'number' ? port : config.port;

  return new Promise((resolve, reject) => {
    const server = app.listen(listenPort, () => {
      const address = server.address();
      const actualPort = address && address.port ? address.port : listenPort;
      console.log('');
      console.log('  CampusHub is running');
      console.log(`  -> http://localhost:${actualPort}`);
      console.log(`  -> environment: ${config.env}`);
      console.log('  -> press Ctrl+C to stop');
      console.log('');
      resolve(server);
    });

    server.on('error', reject);
  });
}

/** Graceful shutdown for Ctrl+C. */
async function shutdown(server, signal) {
  console.log(`\n[server] ${signal} received - shutting down...`);
  try {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
      console.log('[server] HTTP server closed');
    }
    await disconnectDB();
    console.log('[db] connection closed');
    console.log('[server] bye!');
    process.exit(0);
  } catch (error) {
    console.error('[server] error during shutdown:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  start()
    .then((server) => {
      process.on('SIGINT', () => shutdown(server, 'SIGINT'));
      process.on('SIGTERM', () => shutdown(server, 'SIGTERM'));
    })
    .catch((error) => {
      console.error('\n[server] failed to start\n');
      console.error(error.message);
      process.exit(1);
    });
}

module.exports = { createApp, start, connectDB, disconnectDB, config };
