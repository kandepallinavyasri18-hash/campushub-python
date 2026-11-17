/**
 * End-to-end tests for the CampusHub authentication system.
 *
 * Run with:  npm test        (node --test "server/tests/*.test.js")
 *
 * The tests talk to the real Express app over HTTP (no mocks), so they cover
 * registration, login, cookies, role-based page protection, logout and
 * database persistence.
 *
 * Database selection:
 *   1. If TEST_MONGO_URI (default mongodb://127.0.0.1:27017/campushub_test)
 *      is reachable, that database is used and wiped before the run.
 *   2. Otherwise the tests fall back to a temporary in-memory MongoDB
 *      (mongodb-memory-server, a dev-only dependency).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

/* ------------------------------------------------------------------ *
 * Environment must be prepared before the app is required.
 * dotenv never overwrites variables that already exist, so these win.
 * ------------------------------------------------------------------ */
process.env.NODE_ENV = 'test';
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  process.env.JWT_SECRET = 'campushub_test_secret_key_please_change_0123456789';
}

const DEFAULT_TEST_URI = process.env.TEST_MONGO_URI || 'mongodb://127.0.0.1:27017/campushub_test';
const TEST_URI_OVERRIDE = process.env.TEST_MONGO_URI_OVERRIDE || DEFAULT_TEST_URI;

const PASSWORD = 'StudentPass123';
const FACULTY_PASSWORD = 'FacultyPass123';
const ADMIN_PASSWORD = 'AdminPass12345';

let memoryServer = null;
let server = null;
let baseUrl = '';
let appModule = null;
let User = null;
let Announcement = null;
let Resource = null;
let Question = null;
let Notification = null;
let databaseLabel = '';

/** Picks a database: a real MongoDB if reachable, otherwise an in-memory one. */
async function resolveDatabaseUri() {
  try {
    const probe = await mongoose.createConnection(TEST_URI_OVERRIDE, {
      serverSelectionTimeoutMS: 1500
    }).asPromise();
    await probe.close();
    databaseLabel = TEST_URI_OVERRIDE;
    return TEST_URI_OVERRIDE;
  } catch (error) {
    let MongoMemoryServer;
    try {
      ({ MongoMemoryServer } = require('mongodb-memory-server'));
    } catch (notInstalled) {
      throw new Error([
        '',
        `No MongoDB is reachable at ${TEST_URI_OVERRIDE} and the optional`,
        'mongodb-memory-server package is not installed, so the tests cannot run.',
        '',
        'Choose one of these options:',
        '  1. Start MongoDB locally   -> Windows: net start MongoDB',
        '  2. Point TEST_MONGO_URI in .env at another database (e.g. MongoDB Atlas)',
        '  3. Use a throwaway in-memory MongoDB (downloads a MongoDB binary once):',
        '       npm install --no-save mongodb-memory-server',
        ''
      ].join('\n'));
    }

    memoryServer = await MongoMemoryServer.create();
    databaseLabel = `${memoryServer.getUri()} (in-memory, temporary)`;
    console.log('[test] local MongoDB not reachable - using mongodb-memory-server');
    return memoryServer.getUri();
  }
}

/* ------------------------------------------------------------------ *
 * HTTP helper: fetch with a manual redirect mode so page guards can be
 * asserted, and a tiny cookie jar.
 * ------------------------------------------------------------------ */
async function request(path, options = {}) {
  const headers = Object.assign({ Accept: 'application/json' }, options.headers || {});
  let body;

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  } else if (options.formData !== undefined) {
    body = options.formData;
  }
  if (options.cookie) {
    headers.Cookie = options.cookie;
  }

  const response = await fetch(baseUrl + path, {
    method: options.method || 'GET',
    headers,
    body,
    redirect: 'manual'
  });

  const rawCookies = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [].concat(response.headers.get('set-cookie') || []);

  const text = await response.text();
  const contentType = response.headers.get('content-type') || '';
  const parsed = contentType.includes('application/json') && text ? JSON.parse(text) : null;

  return {
    status: response.status,
    headers: response.headers,
    location: response.headers.get('location'),
    cacheControl: response.headers.get('cache-control'),
    text,
    body: parsed,
    cookies: rawCookies,
    cookie: cookieFromHeader(rawCookies)
  };
}

/** Reduces Set-Cookie headers to a single Cookie request header value. */
function cookieFromHeader(setCookieHeaders) {
  if (!setCookieHeaders || !setCookieHeaders.length) { return ''; }
  return setCookieHeaders
    .map((header) => header.split(';')[0])
    .filter(Boolean)
    .join('; ');
}

function register(body) {
  return request('/api/auth/register', { method: 'POST', body });
}

function login(email, password) {
  return request('/api/auth/login', { method: 'POST', body: { email, password } });
}

/* ------------------------------------------------------------------ *
 * Setup / teardown
 * ------------------------------------------------------------------ */
test.before(async () => {
  const uri = await resolveDatabaseUri();
  process.env.MONGO_URI = uri;

  appModule = require('../server');
  User = require('../models/User');
  Announcement = require('../models/Announcement');
  Resource = require('../models/Resource');
  Question = require('../models/Question');
  Notification = require('../models/Notification');

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
  await User.deleteMany({});

  server = await appModule.start(0);
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;

  console.log(`[test] server started on ${baseUrl}`);
  console.log(`[test] database: ${databaseLabel}`);
}, { timeout: 300000 });

test.after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await mongoose.disconnect();
  if (memoryServer) {
    await memoryServer.stop();
  }
});

/* ------------------------------------------------------------------ *
 * 1. Server basics and sensitive-file protection
 * ------------------------------------------------------------------ */
test('GET /api/health reports the service as healthy', async () => {
  const response = await request('/api/health');
  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.service, 'CampusHub');
});

test('no API route returns JSON 404 for unknown endpoints', async () => {
  const response = await request('/api/does-not-exist');
  assert.equal(response.status, 404);
  assert.equal(response.body.code, 'NOT_FOUND');
});

test('sensitive files are never served as static content', async () => {
  for (const path of ['/.env', '/.env.example', '/.gitignore', '/package.json', '/server/server.js']) {
    const response = await request(path);
    assert.equal(response.status, 404, `${path} must not be downloadable`);
    assert.ok(
      !/JWT_SECRET\s*=/.test(response.text) && !/mongodb(\+srv)?:\/\//.test(response.text),
      `${path} must not leak secrets`
    );
  }
});

test('css and js assets are served', async () => {
  const css = await request('/css/style.css');
  const js = await request('/js/script.js');
  assert.equal(css.status, 200);
  assert.equal(js.status, 200);
  assert.match(css.text, /--brand-600/);
  assert.match(js.text, /api\/auth\/login/);
});

test('public pages are reachable without a session', async () => {
  for (const path of ['/', '/index.html', '/register.html', '/login.html']) {
    const response = await request(path, { headers: { Accept: 'text/html' } });
    assert.equal(response.status, 200, `${path} should be public`);
    assert.match(response.text, /CampusHub/);
  }
});

/* ------------------------------------------------------------------ *
 * 2. Registration validation
 * ------------------------------------------------------------------ */
test('registration rejects missing fields', async () => {
  const response = await register({});
  assert.equal(response.status, 400);
  assert.equal(response.body.code, 'VALIDATION_ERROR');
  assert.ok(response.body.errors.fullName);
  assert.ok(response.body.errors.email);
  assert.ok(response.body.errors.password);
  assert.ok(response.body.errors.confirmPassword);
  assert.ok(response.body.errors.role);
});

test('registration rejects an invalid email format', async () => {
  const response = await register({
    fullName: 'Bad Email',
    email: 'not-an-email',
    password: PASSWORD,
    confirmPassword: PASSWORD,
    role: 'student'
  });
  assert.equal(response.status, 400);
  assert.match(response.body.errors.email, /valid email/i);
});

test('registration rejects mismatched passwords', async () => {
  const response = await register({
    fullName: 'Mismatch User',
    email: 'mismatch@college.edu',
    password: PASSWORD,
    confirmPassword: 'SomethingElse123',
    role: 'student'
  });
  assert.equal(response.status, 400);
  assert.match(response.body.errors.confirmPassword, /do not match/i);
});

test('registration rejects a short password', async () => {
  const response = await register({
    fullName: 'Short Password',
    email: 'short@college.edu',
    password: '123',
    confirmPassword: '123',
    role: 'student'
  });
  assert.equal(response.status, 400);
  assert.match(response.body.errors.password, /at least 6/i);
});

test('registration refuses the admin role (admin is created separately)', async () => {
  const response = await register({
    fullName: 'Sneaky Admin',
    email: 'sneaky@college.edu',
    password: 'AdminPass12345',
    confirmPassword: 'AdminPass12345',
    role: 'admin'
  });
  assert.equal(response.status, 400);
  assert.match(response.body.errors.role, /admin/i);
  assert.equal(await User.countDocuments({ role: 'admin' }), 0);
});

test('registration rejects an unknown role', async () => {
  const response = await register({
    fullName: 'Wrong Role',
    email: 'wrong-role@college.edu',
    password: PASSWORD,
    confirmPassword: PASSWORD,
    role: 'supervisor'
  });
  assert.equal(response.status, 400);
  assert.ok(response.body.errors.role);
});

/* ------------------------------------------------------------------ *
 * 3. Student registration + storage
 * ------------------------------------------------------------------ */
test('a student can register and the response never contains the password', async () => {
  const response = await register({
    fullName: 'Ananya Sharma',
    email: 'Ananya.Student@College.edu',
    password: PASSWORD,
    confirmPassword: PASSWORD,
    role: 'student'
  });

  assert.equal(response.status, 201);
  assert.equal(response.body.success, true);
  assert.equal(response.body.user.role, 'student');
  assert.equal(response.body.user.fullName, 'Ananya Sharma');
  // email is normalised to lower case
  assert.equal(response.body.user.email, 'ananya.student@college.edu');
  assert.ok(response.body.user.createdAt, 'createdAt should be returned');
  assert.equal(response.body.user.password, undefined);
  assert.ok(!/password/.test(JSON.stringify(response.body.user)));
});

test('the password is stored as a bcrypt hash, never as plain text', async () => {
  const user = await User.findByEmailWithPassword('ananya.student@college.edu');
  assert.ok(user, 'the registered user must exist in MongoDB');
  assert.notEqual(user.password, PASSWORD);
  assert.match(user.password, /^\$2[aby]\$/, 'expected a bcrypt hash');
  assert.ok(user.password.length > 50);
  // and the hash verifies correctly
  assert.equal(await user.comparePassword(PASSWORD), true);
  assert.equal(await user.comparePassword('WrongPassword'), false);
});

test('a duplicate email is rejected (also in a different letter case)', async () => {
  const response = await register({
    fullName: 'Impostor',
    email: 'ANANYA.STUDENT@COLLEGE.EDU',
    password: 'AnotherPass123',
    confirmPassword: 'AnotherPass123',
    role: 'student'
  });

  assert.equal(response.status, 409);
  assert.equal(response.body.code, 'EMAIL_TAKEN');
  assert.equal(await User.countDocuments({ email: 'ananya.student@college.edu' }), 1);
});

/* ------------------------------------------------------------------ *
 * 4. Login behaviour
 * ------------------------------------------------------------------ */
test('login with the wrong password fails with 401', async () => {
  const response = await login('ananya.student@college.edu', 'DefinitelyWrong123');
  assert.equal(response.status, 401);
  assert.equal(response.body.code, 'INVALID_CREDENTIALS');
  assert.match(response.body.message, /incorrect email or password/i);
  assert.equal(response.cookie, '', 'no session cookie may be issued');
});

test('login with an unknown email fails with the same generic message', async () => {
  const response = await login('nobody@college.edu', PASSWORD);
  assert.equal(response.status, 401);
  assert.match(response.body.message, /incorrect email or password/i);
});

test('login with missing fields fails with 400', async () => {
  const response = await login('', '');
  assert.equal(response.status, 400);
  assert.equal(response.body.code, 'VALIDATION_ERROR');
  assert.ok(response.body.errors.email);
  assert.ok(response.body.errors.password);
});

test('a student can log in and receives an httpOnly session cookie', async () => {
  const response = await login('ananya.student@college.edu', PASSWORD);

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.user.role, 'student');
  assert.equal(response.body.redirectTo, '/student-dashboard.html');
  assert.ok(response.cookie.includes('campushub_token='), 'session cookie expected');

  const setCookie = response.cookies.join(';');
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Lax/i);
  assert.match(setCookie, /Path=\//i);
});

/* ------------------------------------------------------------------ *
 * 5. Session endpoint
 * ------------------------------------------------------------------ */
test('GET /api/auth/me reports the signed-in user', async () => {
  const session = await login('ananya.student@college.edu', PASSWORD);
  const response = await request('/api/auth/me', { cookie: session.cookie });

  assert.equal(response.status, 200);
  assert.equal(response.body.authenticated, true);
  assert.equal(response.body.user.email, 'ananya.student@college.edu');
  assert.equal(response.body.dashboard, '/student-dashboard.html');
  assert.equal(response.body.user.password, undefined);
});

test('GET /api/auth/me returns authenticated:false without a cookie', async () => {
  const response = await request('/api/auth/me');
  assert.equal(response.status, 200);
  assert.equal(response.body.authenticated, false);
  assert.equal(response.body.user, null);
});

/* ------------------------------------------------------------------ *
 * 6. Protected pages + role-based access
 * ------------------------------------------------------------------ */
test('dashboards cannot be opened without a session', async () => {
  for (const path of ['/student-dashboard.html', '/faculty-dashboard.html', '/admin-dashboard.html']) {
    const response = await request(path, { headers: { Accept: 'text/html' } });
    assert.equal(response.status, 302, `${path} must redirect when not logged in`);
    assert.match(response.location, /^\/login\.html\?error=auth_required/);
    assert.ok(!/Student Dashboard|Faculty Dashboard|Admin Dashboard/.test(response.text));
  }
});

test('a student can open the student dashboard but not the other two', async () => {
  const session = await login('ananya.student@college.edu', PASSWORD);

  const own = await request('/student-dashboard.html', { cookie: session.cookie });
  assert.equal(own.status, 200);
  assert.match(own.text, /Student Dashboard/);
  assert.match(own.text, /Search Resources/);
  assert.match(own.text, /My Resources/);
  assert.match(own.text, /Questions/);
  assert.match(own.text, /Announcements/);
  assert.match(own.text, /Profile/);
  // protected pages must not be cached
  assert.match(own.cacheControl || '', /no-store/);

  const faculty = await request('/faculty-dashboard.html', { cookie: session.cookie });
  assert.equal(faculty.status, 302);
  assert.match(faculty.location, /error=role_not_allowed/);
  assert.ok(!/Upload Resource/.test(faculty.text));

  const admin = await request('/admin-dashboard.html', { cookie: session.cookie });
  assert.equal(admin.status, 302);
  assert.match(admin.location, /error=role_not_allowed/);
  assert.ok(!/Registered users/.test(admin.text));
});

test('a tampered role inside the token does not grant admin access', async () => {
  const user = await User.findOne({ email: 'ananya.student@college.edu' });
  const jwt = require('jsonwebtoken');
  const config = require('../config/config');

  // Forge a token that claims role=admin, signed with the real secret.
  const forged = jwt.sign(
    { sub: String(user._id), role: 'admin' },
    config.jwtSecret,
    { expiresIn: '1h', issuer: config.issuer }
  );

  const response = await request('/admin-dashboard.html', {
    cookie: `campushub_token=${forged}`,
    headers: { Accept: 'text/html' }
  });

  assert.equal(response.status, 302, 'the database role must win over the token');
  assert.ok(!/Registered users/.test(response.text));
});

test('a token signed with the wrong secret is rejected', async () => {
  const jwt = require('jsonwebtoken');
  const user = await User.findOne({ email: 'ananya.student@college.edu' });
  const forged = jwt.sign(
    { sub: String(user._id), role: 'admin' },
    'not-the-real-secret-but-32-characters-long'
  );

  const page = await request('/admin-dashboard.html', { cookie: `campushub_token=${forged}` });
  assert.equal(page.status, 302);
  assert.match(page.location, /error=auth_required/);

  const me = await request('/api/auth/me', { cookie: `campushub_token=${forged}` });
  assert.equal(me.status, 200);
  assert.equal(me.body.authenticated, false);
});

test('a logged-in user is redirected away from login/register pages', async () => {
  const session = await login('ananya.student@college.edu', PASSWORD);

  const loginPage = await request('/login.html', { cookie: session.cookie });
  assert.equal(loginPage.status, 302);
  assert.equal(loginPage.location, '/student-dashboard.html');

  const registerPage = await request('/register.html', { cookie: session.cookie });
  assert.equal(registerPage.status, 302);
  assert.equal(registerPage.location, '/student-dashboard.html');
});

/* ------------------------------------------------------------------ *
 * 7. Faculty registration + login
 * ------------------------------------------------------------------ */
test('faculty can register and reach the faculty dashboard', async () => {
  const registration = await register({
    fullName: 'Dr. Ravi Kulkarni',
    email: 'ravi.faculty@college.edu',
    password: FACULTY_PASSWORD,
    confirmPassword: FACULTY_PASSWORD,
    role: 'faculty'
  });
  assert.equal(registration.status, 201);
  assert.equal(registration.body.user.role, 'faculty');

  const session = await login('ravi.faculty@college.edu', FACULTY_PASSWORD);
  assert.equal(session.status, 200);
  assert.equal(session.body.redirectTo, '/faculty-dashboard.html');

  const own = await request('/faculty-dashboard.html', { cookie: session.cookie });
  assert.equal(own.status, 200);
  assert.match(own.text, /Faculty Dashboard/);
  assert.match(own.text, /Upload Resource/);

  const student = await request('/student-dashboard.html', { cookie: session.cookie });
  assert.equal(student.status, 302);
  assert.match(student.location, /error=role_not_allowed/);

  const admin = await request('/admin-dashboard.html', { cookie: session.cookie });
  assert.equal(admin.status, 302);
});

/* ------------------------------------------------------------------ *
 * 8. Admin account (created outside the public form)
 * ------------------------------------------------------------------ */
test('an admin created like the create-admin script can use the admin dashboard', async () => {
  const admin = await User.create({
    fullName: 'CampusHub Administrator',
    email: 'admin@college.edu',
    password: ADMIN_PASSWORD,
    role: 'admin'
  });
  assert.equal(admin.role, 'admin');

  const session = await login('admin@college.edu', ADMIN_PASSWORD);
  assert.equal(session.status, 200);
  assert.equal(session.body.redirectTo, '/admin-dashboard.html');

  const own = await request('/admin-dashboard.html', { cookie: session.cookie });
  assert.equal(own.status, 200);
  assert.match(own.text, /Admin Dashboard/);
  assert.match(own.text, /Categories/);
  assert.match(own.text, /Statistics/);

  // an admin is not a student: the student dashboard stays closed
  const studentPage = await request('/student-dashboard.html', { cookie: session.cookie });
  assert.equal(studentPage.status, 302);
});

/* ------------------------------------------------------------------ *
 * 9. Logout
 * ------------------------------------------------------------------ */
test('logout clears the session cookie and ends the session on the server', async () => {
  const session = await login('ananya.student@college.edu', PASSWORD);

  const stillIn = await request('/student-dashboard.html', { cookie: session.cookie });
  assert.equal(stillIn.status, 200);

  const logout = await request('/api/auth/logout', { method: 'POST', cookie: session.cookie });
  assert.equal(logout.status, 200);
  assert.equal(logout.body.success, true);

  const cleared = logout.cookies.join(';');
  assert.match(cleared, /campushub_token=;/);
  assert.match(cleared, /Expires=Thu, 01 Jan 1970/i);

  // The browser no longer sends the cookie at all.
  const noCookie = await request('/student-dashboard.html');
  assert.equal(noCookie.status, 302);
  assert.match(noCookie.location, /error=auth_required/);

  // Even a *copy* of the pre-logout token must be rejected now.
  const replay = await request('/student-dashboard.html', { cookie: session.cookie });
  assert.equal(replay.status, 302, 'a replayed token must not be accepted after logout');
  assert.match(replay.location, /error=auth_required/);

  const meWithOldToken = await request('/api/auth/me', { cookie: session.cookie });
  assert.equal(meWithOldToken.body.authenticated, false);
});

test('a user can log in again after logging out', async () => {
  const first = await login('ananya.student@college.edu', PASSWORD);
  await request('/api/auth/logout', { method: 'POST', cookie: first.cookie });

  const second = await login('ananya.student@college.edu', PASSWORD);
  assert.equal(second.status, 200);
  assert.notEqual(second.cookie, first.cookie);

  const dashboard = await request('/student-dashboard.html', { cookie: second.cookie });
  assert.equal(dashboard.status, 200);
  await request('/api/auth/logout', { method: 'POST', cookie: second.cookie });
});

test('GET /logout also ends the session (no-JavaScript fallback)', async () => {
  const session = await login('ananya.student@college.edu', PASSWORD);
  const response = await request('/logout', { cookie: session.cookie });
  assert.equal(response.status, 302);
  assert.equal(response.location, '/login.html?loggedout=1');
});

test('admin can publish announcements and the public list is available', async () => {
  const adminSession = await login('admin@college.edu', ADMIN_PASSWORD);
  assert.equal(adminSession.status, 200);

  const created = await request('/api/announcements', {
    method: 'POST',
    cookie: adminSession.cookie,
    body: {
      title: 'Orientation update',
      message: 'All students should attend the orientation session on Friday at 10:00 AM.',
      audience: 'student'
    }
  });

  assert.equal(created.status, 201);
  assert.equal(created.body.success, true);
  assert.equal(created.body.announcement.title, 'Orientation update');

  const list = await request('/api/announcements');
  assert.equal(list.status, 200);
  assert.equal(list.body.success, true);
  assert.ok(Array.isArray(list.body.announcements));
  assert.ok(list.body.announcements.some((item) => item.title === 'Orientation update'));

  const count = await Announcement.countDocuments({ title: 'Orientation update' });
  assert.equal(count, 1);
});

test('faculty can upload a resource and view their uploaded resources', async () => {
  const facultySession = await login('ravi.faculty@college.edu', FACULTY_PASSWORD);
  assert.equal(facultySession.status, 200);

  const created = await request('/api/resources', {
    method: 'POST',
    cookie: facultySession.cookie,
    body: {
      title: 'Data Structures notes',
      description: 'A concise summary of stacks, queues and linked lists for the upcoming assessment.',
      category: 'Notes',
      url: 'https://example.com/data-structures-notes.pdf'
    }
  });

  test('resources support search and resource questions notify the uploader', async () => {
    const facultySession = await login('ravi.faculty@college.edu', FACULTY_PASSWORD);
    const studentSession = await login('ananya.student@college.edu', PASSWORD);
    const search = await request('/api/resources?q=Data%20Structures', { cookie: studentSession.cookie });
    assert.equal(search.status, 200);
    assert.ok(search.body.resources.some((item) => item.title === 'Data Structures notes'));

    const resource = search.body.resources.find((item) => item.title === 'Data Structures notes');
    assert.equal(resource.questionCount, 0);
    const asked = await request('/api/questions', {
      method: 'POST', cookie: studentSession.cookie, body: { resourceId: resource.id, text: 'Which topics should I revise first?' }
    });
    assert.equal(asked.status, 201);
    assert.equal(asked.body.question.question, 'Which topics should I revise first?');
    assert.equal(await Question.countDocuments({ resource: resource.id }), 1);
    assert.equal(await Notification.countDocuments({ type: 'question' }), 1);

    const resourceAfterQuestion = await request('/api/resources?q=Data%20Structures', { cookie: studentSession.cookie });
    assert.equal(resourceAfterQuestion.body.resources.find((item) => item.id === resource.id).questionCount, 1);

    const studentQuestions = await request('/api/questions', { cookie: studentSession.cookie });
    assert.equal(studentQuestions.status, 200);
    assert.equal(studentQuestions.body.questions[0].resource.title, 'Data Structures notes');
    assert.equal(studentQuestions.body.questions[0].answer, '');

    const studentCannotAnswer = await request(`/api/questions/${asked.body.question.id}/answers`, {
      method: 'POST', cookie: studentSession.cookie, body: { text: 'A student answer should be rejected.' }
    });
    assert.equal(studentCannotAnswer.status, 403);

    const secondStudent = await register({
      fullName: 'Priya Second Student',
      email: 'priya.second@college.edu',
      password: PASSWORD,
      confirmPassword: PASSWORD,
      role: 'student'
    });
    assert.equal(secondStudent.status, 201);
    const secondStudentSession = await login('priya.second@college.edu', PASSWORD);
    const studentAnswer = await request(`/api/questions/${asked.body.question.id}/answers`, {
      method: 'POST', cookie: secondStudentSession.cookie, body: { text: 'A classmate answer.' }
    });
    assert.equal(studentAnswer.status, 200);
    assert.equal(studentAnswer.body.question.answer, 'A classmate answer.');
    await User.deleteOne({ email: 'priya.second@college.edu' });

    const notifications = await request('/api/notifications', { cookie: facultySession.cookie });
    assert.equal(notifications.status, 200);
    assert.equal(notifications.body.notifications.length, 1);
    const facultyCannotAsk = await request('/api/questions', {
      method: 'POST', cookie: facultySession.cookie, body: { resourceId: resource.id, text: 'Faculty cannot ask this.' }
    });
    assert.equal(facultyCannotAsk.status, 403);
    const answered = await request(`/api/questions/${asked.body.question.id}/answers`, {
      method: 'POST', cookie: facultySession.cookie, body: { text: 'Start with stacks and queues.' }
    });
    assert.equal(answered.status, 200);
    assert.equal(answered.body.question.answer, 'Start with stacks and queues.');

    const studentQuestionsAfterAnswer = await request('/api/questions', { cookie: studentSession.cookie });
    assert.equal(studentQuestionsAfterAnswer.body.questions[0].answer, 'Start with stacks and queues.');
    assert.equal(studentQuestionsAfterAnswer.body.questions[0].answeredBy.fullName, 'Dr. Ravi Kulkarni');
    const read = await request(`/api/notifications/${notifications.body.notifications[0].id}/read`, {
      method: 'PATCH', cookie: facultySession.cookie, body: {}
    });
    assert.equal(read.status, 200);
    assert.equal(read.body.notification.read, true);
  });

  test('students can upload and download a real document', async () => {
    const studentSession = await login('ananya.student@college.edu', PASSWORD);
    const form = new FormData();
    form.append('title', 'Student lab document');
    form.append('description', 'A real uploaded document used for integration coverage.');
    form.append('category', 'Lab Manual');
    form.append('file', new Blob(['learnloop document content'], { type: 'text/plain' }), 'lab.txt');
    const uploaded = await request('/api/resources', {
      method: 'POST', cookie: studentSession.cookie, formData: form
    });
    assert.equal(uploaded.status, 201);
    assert.equal(uploaded.body.resource.file.name, 'lab.txt');
    const downloaded = await request(`/api/resources/${uploaded.body.resource.id}/download`, { cookie: studentSession.cookie });
    assert.equal(downloaded.status, 200);
    assert.equal(downloaded.text, 'learnloop document content');
    assert.match(downloaded.headers.get('content-disposition') || '', /^attachment;/);
    const previewed = await request(`/api/resources/${uploaded.body.resource.id}/preview`, { cookie: studentSession.cookie });
    assert.equal(previewed.status, 200);
    assert.equal(previewed.text, 'learnloop document content');
    assert.match(previewed.headers.get('content-disposition') || '', /^inline;/);
  });

  assert.equal(created.status, 201);
  assert.equal(created.body.success, true);
  assert.equal(created.body.resource.title, 'Data Structures notes');
  assert.equal(created.body.resource.category, 'Notes');

  const myResources = await request('/api/resources/my', { cookie: facultySession.cookie });
  assert.equal(myResources.status, 200);
  assert.equal(myResources.body.success, true);
  assert.ok(Array.isArray(myResources.body.resources));
  assert.ok(myResources.body.resources.some((item) => item.title === 'Data Structures notes'));

  const stored = await Resource.countDocuments({ title: 'Data Structures notes' });
  assert.equal(stored, 1);
});

/* ------------------------------------------------------------------ *
 * 10. Persistence across a server restart
 * ------------------------------------------------------------------ */
test('accounts survive a full server restart', async () => {
  // Stop the HTTP server and drop the database connection, then boot again
  // exactly like `npm start` would.
  await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();

  server = await appModule.start(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const usersInDb = await User.countDocuments({});
  assert.equal(usersInDb, 3, 'student + faculty + admin must still be stored in MongoDB');

  const session = await login('ananya.student@college.edu', PASSWORD);
  assert.equal(session.status, 200);
  assert.equal(session.body.user.email, 'ananya.student@college.edu');
  assert.equal(session.body.redirectTo, '/student-dashboard.html');

  const dashboard = await request('/student-dashboard.html', { cookie: session.cookie });
  assert.equal(dashboard.status, 200);

  const wrongPassword = await login('ananya.student@college.edu', 'Nope12345');
  assert.equal(wrongPassword.status, 401);
});
