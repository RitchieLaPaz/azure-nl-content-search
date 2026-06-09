/**
 * Lightweight API key middleware.
 * Callers must send:  Authorization: Bearer <API_SECRET_KEY>
 *
 * Skip entirely by not setting API_SECRET_KEY in .env (e.g. local dev behind VPN).
 */
function requireApiKey(req, res, next) {
  const secret = process.env.API_SECRET_KEY;
  if (!secret) return next(); // no key configured → open (dev mode)

  const authHeader = req.headers['authorization'] ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token || token !== secret) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Invalid or missing API key' });
  }
  next();
}

module.exports = { requireApiKey };
