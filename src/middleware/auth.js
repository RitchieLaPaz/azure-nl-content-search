/**
 * middleware/auth.js — Legacy API key guard
 *
 * Optional fallback for non-browser callers (scripts, integrations) that
 * cannot use the SSO cookie flow. Callers supply:
 *   Authorization: Bearer <API_SECRET_KEY>
 *
 * If API_SECRET_KEY is not set in the environment this middleware is a no-op —
 * useful for local development behind a VPN or firewall.
 *
 * For the web dashboard, requireAuth / requireAuthApi (Microsoft SSO + JWT cookie)
 * in middleware/requireAuth.js is the primary auth mechanism.
 */
function requireApiKey(req, res, next) {
  const secret = process.env.API_SECRET_KEY;
  if (!secret) return next();

  const authHeader = req.headers['authorization'] ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token || token !== secret) {
    return res.status(401).json({ ok: false, error: 'Unauthorized — invalid or missing API key' });
  }
  next();
}

module.exports = { requireApiKey };
