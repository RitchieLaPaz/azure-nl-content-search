require('dotenv').config();

const path       = require('path');
const express    = require('express');
const cors       = require('cors');
const cookies    = require('cookie-parser');
const rateLimit  = require('express-rate-limit');
const logger     = require('./services/logger');
const { requireAuth, requireAuthApi } = require('./middleware/requireAuth');

const { router: authRouter } = require('./routes/auth');
const searchRouter            = require('./routes/search');
const complianceRouter        = require('./routes/compliance');
const slackRouter             = require('./routes/slack');

const app  = express();
const PORT = process.env.PORT ?? 3000;

// ── Middleware ────────────────────────────────────────────────────────────────

app.use(cors({ origin: false }));  // same-origin only in production
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookies());

app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Too many requests — slow down' },
}));

// ── Public routes (no auth) ───────────────────────────────────────────────────

// Health check
app.get('/health', (req, res) => res.json({
  ok: true,
  service: 'azure-nl-search',
  env: process.env.NODE_ENV,
  bypass: !!process.env.DEV_BYPASS_KEY,
  routes: {
    'GET  /auth/login':       'Login page (MS SSO + optional dev bypass)',
    'GET  /auth/sso':         'Initiates Microsoft SSO redirect',
    'GET  /auth/callback':    'OAuth callback — issues session cookie',
    'GET  /auth/logout':      'Clears session + Microsoft logout',
    'GET  /auth/dev-status':  'Returns whether dev bypass is enabled',
    'GET  /auth/dev-bypass':  'Issues session without SSO (requires DEV_BYPASS_KEY)',
    'GET  /api/me':           'Returns current user info',
    'POST /compliance':       'NL → Purview KQL plan',
    'GET  /compliance/build': 'Quick KQL build via ?q= param',
    'POST /search':           'NL → Microsoft Graph API execution',
    'GET  /search/plan':      'Graph API plan preview',
    'POST /slack/command':    'Slack slash command handler',
  },
}));

// SSO routes — must be before static/protected middleware
app.use('/auth', authRouter);

// Slack — uses its own token verification
app.use('/slack', slackRouter);

// ── Protected API routes ──────────────────────────────────────────────────────

app.use('/api', requireAuthApi, authRouter);      // /api/me
app.use('/compliance', requireAuthApi, complianceRouter);
app.use('/search',     requireAuthApi, searchRouter);

// ── Protected dashboard (static files) ───────────────────────────────────────

// Serve the dashboard — redirect to login if no valid session
app.get('/', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// All other static assets (css, js, etc.) — no auth needed
app.use(express.static(path.join(__dirname, '..', 'public')));

// ── 404 + error handler ───────────────────────────────────────────────────────

app.use((req, res) => res.status(404).json({ ok: false, error: `${req.method} ${req.path} not found` }));

app.use((err, req, res, _next) => {
  logger.error('[server] Unhandled error', { message: err.message });
  res.status(500).json({ ok: false, error: 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  logger.info(`azure-nl-search running on :${PORT} [${process.env.NODE_ENV}]`);
  if (!process.env.JWT_SECRET)        logger.warn('JWT_SECRET not set — SSO will not work');
  if (!process.env.AZURE_REDIRECT_URI) logger.warn('AZURE_REDIRECT_URI not set — SSO will not work');
});

module.exports = app;
