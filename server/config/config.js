/**
 * Central configuration for the CampusHub server.
 *
 * Everything sensitive (database connection string, JWT secret, admin
 * bootstrap credentials) is read from the `.env` file in the project root.
 * Nothing is hard-coded in the source.
 */
const path = require('path');
const dotenv = require('dotenv');

// Project root = the folder that contains index.html, css/, js/ and server/.
const projectRoot = path.resolve(__dirname, '..', '..');

// Load .env from the project root, whatever the current working directory is.
// dotenv never overwrites variables that are already set in the environment,
// which is what lets the automated tests point MONGO_URI at a test database.
dotenv.config({ path: path.join(projectRoot, '.env') });

/** Parses "7d", "12h", "30m", "45s" or a plain number of milliseconds. */
function parseDurationToMs(value, fallbackMs) {
  if (!value) { return fallbackMs; }
  const match = String(value).trim().match(/^(\d+)\s*(ms|s|m|h|d)?$/i);
  if (!match) { return fallbackMs; }
  const amount = Number(match[1]);
  const unit = (match[2] || 'ms').toLowerCase();
  const multipliers = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return amount * multipliers[unit];
}

const env = process.env.NODE_ENV || 'development';
const isProduction = env === 'production';

const config = {
  env,
  isProduction,
  projectRoot,
  port: Number(process.env.PORT) || 5000,

  // Database
  mongoUri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/campushub',

  // Authentication
  jwtSecret: process.env.JWT_SECRET || '',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  cookieName: process.env.COOKIE_NAME || 'campushub_token',
  issuer: 'campushub',

  // Admin bootstrap account (only used by `npm run create-admin`)
  admin: {
    fullName: process.env.ADMIN_NAME || 'CampusHub Administrator',
    email: process.env.ADMIN_EMAIL || '',
    password: process.env.ADMIN_PASSWORD || ''
  },

  // Password hashing strength (bcrypt rounds)
  bcryptSaltRounds: Number(process.env.BCRYPT_SALT_ROUNDS) || 10
};

config.cookieMaxAgeMs = parseDurationToMs(config.jwtExpiresIn, 7 * 24 * 60 * 60 * 1000);

/**
 * Fails fast with a helpful message instead of starting an insecure server.
 * Called by server.js before anything is mounted.
 */
function assertConfig() {
  const problems = [];

  if (!config.jwtSecret) {
    problems.push('JWT_SECRET is missing. Copy .env.example to .env and set a value.');
  } else if (config.jwtSecret.length < 32) {
    problems.push('JWT_SECRET must be at least 32 characters long.');
  } else if (config.jwtSecret === 'change_me_to_a_long_random_string_at_least_32_chars') {
    problems.push('JWT_SECRET still has the example value from .env.example. Generate a real one.');
  }

  if (!config.mongoUri) {
    problems.push('MONGO_URI is missing. Set it to your MongoDB connection string.');
  }

  if (config.isProduction && config.jwtSecret === process.env.JWT_SECRET && !process.env.JWT_SECRET) {
    problems.push('JWT_SECRET must be provided through the environment in production.');
  }

  if (problems.length) {
    const message = ['CampusHub cannot start:', ...problems.map((p) => '  - ' + p)].join('\n');
    throw new Error(message);
  }
}

module.exports = config;
module.exports.assertConfig = assertConfig;
module.exports.parseDurationToMs = parseDurationToMs;
