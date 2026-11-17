/**
 * Authentication routes, mounted at /api/auth
 *
 *   POST /api/auth/register  create a student or faculty account
 *   POST /api/auth/login     verify credentials + start a session
 *   POST /api/auth/logout    end the session
 *   GET  /api/auth/me        current user (or authenticated: false)
 */
const express = require('express');
const { register, login, logout, me } = require('../controllers/authController');
const { optionalAuth } = require('../middleware/authMiddleware');

const router = express.Router();

router.post('/register', register);
router.post('/login', login);
router.post('/logout', logout);
router.get('/me', optionalAuth, me);

module.exports = router;
