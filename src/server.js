require('dotenv').config();

const path       = require('path');
const express    = require('express');
const cors       = require('cors');
const rateLimit  = require('express-rate-limit');
const logger     = require('./services/logger');
const { requireApiKey } = require('./middleware/auth');

const searchRouter     = require('./routes/search');
const slackRouter      = require('./routes/slack');
const complianceRouter = require('./routes/compliance');

const app  = express();
const PORT = process.env.PORT ?? 3000;

// ── Middleware ────────────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // needed for Slack payloads

// Rate limit: 60 requests per minute per IP
app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Too many requests — slow down' },
}));

// ── Static dashboard ──────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '..', 'public')));

// ── Routes ────────────────────────────────────────────────────────────────────

// Health check — no auth required
app.get('/health', (req, res) => res.json({
  ok: true,
  service: 'azure-nl-search',
  env: process.env.NODE_ENV,
  routes: {
    'POST /search':           'NL → Microsoft Graph API query + execution',
    'POST /compliance':       'NL → Purview KQL plan (no data access)',
    'GET  /compliance/build': 'Quick KQL build via ?q= param',
    'GET  /search/plan':      'Graph API plan preview via ?q= param',
    'POST /slack/command':    'Slack slash command handler',
  },
}));

// Core Graph API search — protected by API key (if configured)
app.use('/search', requireApiKey, searchRouter);

// Purview KQL generator — no data access, just KQL plan output
app.use('/compliance', requireApiKey, complianceRouter);

// Slack slash command — Slack sends its own verification token; no API key guard here
app.use('/slack', slackRouter);

// ── 404 + error handler ───────────────────────────────────────────────────────

app.use((req, res) => res.status(404).json({ ok: false, error: `Route ${req.method} ${req.path} not found` }));

app.use((err, req, res, _next) => {
  logger.error('[server] Unhandled error', { message: err.message, stack: err.stack });
  res.status(500).json({ ok: false, error: 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  logger.info(`azure-nl-search running on port ${PORT} [${process.env.NODE_ENV}]`);
});

module.exports = app;
