const express = require('express');
const crypto  = require('crypto');
const jwt     = require('jsonwebtoken');
const { getAuthCodeUrl, acquireTokenByCode, REDIRECT_URI } = require('../services/msAuth');
const logger  = require('../services/logger');

const router      = express.Router();
const COOKIE_NAME = 'csa_session'; // compliance search app
const COOKIE_OPTS = {
  httpOnly: true,
  secure:   process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge:   8 * 60 * 60 * 1000, // 8-hour session
};

// In-memory CSRF state store (short-lived, 10 min TTL)
const pendingStates = new Map();
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [key, val] of pendingStates) {
    if (val.ts < cutoff) pendingStates.delete(key);
  }
}, 60 * 1000);

/**
 * GET /auth/login
 * Serves the login page (public/login.html).
 * The page shows a "Sign in with Microsoft" button and, if DEV_BYPASS_KEY
 * is set, a dev bypass button. Previously this redirected directly to
 * Microsoft — that redirect is now on /auth/sso.
 */
router.get('/login', (req, res) => {
  res.sendFile(require('path').join(__dirname, '..', '..', 'public', 'login.html'));
});

/**
 * GET /auth/sso
 * Initiates the Microsoft SSO flow — redirects to the Microsoft login page.
 * Called by the "Sign in with Microsoft" button on the login page.
 */
router.get('/sso', async (req, res) => {
  try {
    const state = crypto.randomBytes(16).toString('hex');
    pendingStates.set(state, { ts: Date.now() });
    const url = await getAuthCodeUrl(state);
    res.redirect(url);
  } catch (err) {
    logger.error('[auth] SSO redirect failed', { message: err.message });
    res.redirect('/auth/login?auth_error=' + encodeURIComponent('Microsoft login unavailable — check Azure AD configuration'));
  }
});

/**
 * GET /auth/dev-status
 * Returns whether the dev bypass is currently enabled.
 * Called by the login page on load to decide whether to show the bypass button.
 * Does not expose the bypass key value.
 */
router.get('/dev-status', (req, res) => {
  res.json({ available: !!process.env.DEV_BYPASS_KEY });
});

/**
 * GET /auth/dev-bypass
 * Issues a JWT session cookie for a mock "Dev User" without SSO.
 * Only works when DEV_BYPASS_KEY is set in the environment.
 * Linked from the login page — no key parameter needed here since
 * the route itself is only exposed when the env var is present.
 */
router.get('/dev-bypass', (req, res) => {
  if (!process.env.DEV_BYPASS_KEY) {
    return res.redirect('/auth/login');
  }

  const payload = {
    name:  'Dev User',
    email: 'dev@bypass.local',
    oid:   'dev-bypass',
  };

  const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '8h' });
  res.cookie(COOKIE_NAME, token, COOKIE_OPTS);

  logger.warn('[auth] Dev bypass login used — remove DEV_BYPASS_KEY before production');
  res.redirect('/');
});

/**
 * GET /auth/callback
 * Handles the redirect back from Microsoft after login.
 * Issues a signed JWT cookie and sends user back to the dashboard.
 */
router.get('/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;

  if (error) {
    logger.warn('[auth] OAuth error from Microsoft', { error, error_description });
    return res.redirect(`/?auth_error=${encodeURIComponent(error_description || error)}`);
  }

  if (!state || !pendingStates.has(state)) {
    logger.warn('[auth] Invalid or expired state param');
    return res.status(400).send('Login session expired — please try again. <a href="/auth/login">Sign in</a>');
  }
  pendingStates.delete(state);

  try {
    const result  = await acquireTokenByCode(code);
    const account = result.account;

    const payload = {
      name:  account.name,
      email: account.username,
      oid:   account.localAccountId,
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '8h' });
    res.cookie(COOKIE_NAME, token, COOKIE_OPTS);

    logger.info('[auth] Login successful', { email: account.username });
    res.redirect('/');

  } catch (err) {
    logger.error('[auth] Token exchange failed', { message: err.message });
    res.redirect(`/?auth_error=${encodeURIComponent('Sign-in failed — please try again')}`);
  }
});

/**
 * GET /auth/logout
 * Clears the session cookie and redirects to Microsoft logout.
 */
router.get('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME);
  const base        = REDIRECT_URI.replace('/auth/callback', '');
  const logoutUrl   = `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}/oauth2/v2.0/logout`
                    + `?post_logout_redirect_uri=${encodeURIComponent(base)}`;
  logger.info('[auth] Logout');
  res.redirect(logoutUrl);
});

/**
 * GET /auth/dev-login?key=<DEV_BYPASS_KEY>
 *
 * Bypass route for testing without Microsoft SSO.
 * Issues a real JWT session cookie with a mock "Dev User" identity.
 *
 * ONLY active when DEV_BYPASS_KEY is set in the environment.
 * Remove or unset DEV_BYPASS_KEY to disable before going to production.
 *
 * Usage:
 *   https://your-app.up.railway.app/auth/dev-login?key=your-dev-bypass-key
 */
router.get('/dev-login', (req, res) => {
  const bypassKey = process.env.DEV_BYPASS_KEY;

  if (!bypassKey) {
    return res.status(404).send('Not found');
  }

  if (req.query.key !== bypassKey) {
    logger.warn('[auth] Dev bypass — invalid key attempt');
    return res.status(401).send('Invalid bypass key');
  }

  const payload = {
    name:  'Dev User',
    email: 'dev@bypass.local',
    oid:   'dev-bypass',
  };

  const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '8h' });
  res.cookie(COOKIE_NAME, token, COOKIE_OPTS);

  logger.warn('[auth] Dev bypass login used — disable DEV_BYPASS_KEY before production');
  res.redirect('/');
});


 * Returns the current user's info from the session cookie.
 * Called by the dashboard on load to populate the topbar.
 */
router.get('/me', (req, res) => {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return res.status(401).json({ ok: false });
  try {
    const user = jwt.verify(token, process.env.JWT_SECRET);
    res.json({ ok: true, user: { name: user.name, email: user.email } });
  } catch {
    res.clearCookie(COOKIE_NAME);
    res.status(401).json({ ok: false });
  }
});

module.exports = { router, COOKIE_NAME };
