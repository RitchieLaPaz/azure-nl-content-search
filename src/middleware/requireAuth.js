/**
 * middleware/requireAuth.js — Microsoft SSO session guard
 *
 * Validates the JWT cookie issued by /auth/callback after Microsoft SSO.
 * Two variants:
 *
 *   requireAuth    — for page routes: redirects unauthenticated users to /auth/login
 *   requireAuthApi — for API routes: returns 401 JSON so the frontend can handle it
 *
 * The JWT payload contains: { name, email, oid, iat, exp }
 * It is signed with JWT_SECRET and expires after 8 hours.
 *
 * See src/routes/auth.js for token issuance and src/services/msAuth.js
 * for the underlying MSAL auth code flow.
 */
const jwt             = require('jsonwebtoken');
const { COOKIE_NAME } = require('../routes/auth');

/**
 * Page guard — redirects unauthenticated requests to /auth/login.
 * Attaches decoded user to req.user for downstream use.
 */
function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return res.redirect('/auth/login');

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.clearCookie(COOKIE_NAME);
    res.redirect('/auth/login');
  }
}

/**
 * API guard — returns 401 JSON for unauthenticated or expired sessions.
 * The dashboard JS redirects to /auth/login on receiving a 401.
 */
function requireAuthApi(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) {
    return res.status(401).json({ ok: false, error: 'Not authenticated', redirect: '/auth/login' });
  }

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.clearCookie(COOKIE_NAME);
    res.status(401).json({ ok: false, error: 'Session expired — please sign in again', redirect: '/auth/login' });
  }
}

module.exports = { requireAuth, requireAuthApi };
