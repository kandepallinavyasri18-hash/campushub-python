/**
 * MongoDB connection helper (Mongoose).
 *
 * We use MongoDB because user documents (name, email, hashed password, role,
 * created date) are simple, schema-light records - MongoDB + Mongoose gives us
 * a beginner-friendly model definition with built-in validation, and Atlas
 * offers a free cloud database so nobody needs to install a server locally.
 */
const mongoose = require('mongoose');
const config = require('./config');

let memoryServer = null;

// Do not build indexes automatically on every boot in production; use
// `npm run create-admin`/syncIndexes once instead.
mongoose.set('strictQuery', true);

/**
 * Connects to MongoDB.
 * If the configured URI is unreachable, this falls back to an ephemeral
 * MongoDB in memory so the app can still run in local dev and demo setups.
 * @param {string} [uri] optional override (used by the tests)
 * @returns {Promise<typeof mongoose>}
 */
async function connectDB(uri) {
  const configuredUri = uri || config.mongoUri;

  try {
    const connection = await mongoose.connect(configuredUri, {
      serverSelectionTimeoutMS: 8000,
      autoIndex: !config.isProduction
    });

    const { host, name } = connection.connection;
    console.log(`[db] connected to MongoDB -> ${host}/${name}`);
    return connection;
  } catch (error) {
    if (process.env.CAMPUSHUB_DISABLE_MEMORY_DB === 'true') {
      throw error;
    }

    try {
      const { MongoMemoryServer } = require('mongodb-memory-server');
      memoryServer = await MongoMemoryServer.create();
      const fallbackUri = memoryServer.getUri();
      process.env.MONGO_URI = fallbackUri;

      const connection = await mongoose.connect(fallbackUri, {
        serverSelectionTimeoutMS: 8000,
        autoIndex: !config.isProduction
      });

      const { host, name } = connection.connection;
      console.log(`[db] using in-memory MongoDB -> ${host}/${name}`);
      return connection;
    } catch (memoryError) {
      const hint = [
        '',
        'Could not connect to MongoDB.',
        `  Connection string: ${configuredUri}`,
        '  Checklist:',
        '    1. Is MongoDB running? (Windows: net start MongoDB / macOS: brew services start mongodb-community)',
        '    2. Or use a free MongoDB Atlas cluster and put its URI in MONGO_URI inside .env',
        '    3. Free Atlas URI format: mongodb+srv://<user>:<password>@<cluster>.mongodb.net/campushub',
        '',
        'The in-memory MongoDB fallback also failed:',
        `  ${memoryError.message}`,
        ''
      ].join('\n');

      error.message = `${error.message}\n${hint}`;
      throw error;
    }
  }
}

async function disconnectDB() {
  await mongoose.connection.close();
  if (memoryServer) {
    await memoryServer.stop();
    memoryServer = null;
  }
}

module.exports = { connectDB, disconnectDB, mongoose };
