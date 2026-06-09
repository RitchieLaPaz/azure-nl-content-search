const express = require('express');
const { buildKqlPlan } = require('../services/kql');
const logger = require('../services/logger');

const router = express.Router();

/**
 * POST /compliance
 *
 * Accepts a natural language query (and optional guided-field hints),
 * returns a Purview-ready KQL plan — no Graph API calls, no data access.
 *
 * Body:
 * {
 *   "query":    "find emails to john@contoso.com about wire transfers",  // freeform NL
 *   "scope":    "Email",        // optional: All | Email | Teams | SharePoint | OneDrive
 *   "user":     "john@c.com",  // optional: specific mailbox UPN
 *   "dateFrom": "2026-05-01",  // optional: ISO date
 *   "dateTo":   "2026-06-09",  // optional: ISO date
 *   "keywords": "wire transfer, invoice"  // optional: additional keywords
 * }
 *
 * Response:
 * {
 *   "ok": true,
 *   "query": "...",
 *   "plan": {
 *     "intent": "...",
 *     "kql": "to:john@contoso.com AND subject:\"wire transfer\" AND received:2026-05-01..2026-06-09",
 *     "content_types": ["Email"],
 *     "locations": { "mailboxes": ["john@contoso.com"], "all_mailboxes": false, ... },
 *     "purview_steps": ["Go to Purview...", "Paste KQL...", "Export PST..."],
 *     "notes": "Requires eDiscovery Manager or higher role"
 *   }
 * }
 */
router.post('/', async (req, res) => {
  const { query, scope, user, dateFrom, dateTo, keywords } = req.body;

  if (!query && !user && !keywords && !scope) {
    return res.status(400).json({
      ok: false,
      error: 'Provide at least a query string or one of: scope, user, dateFrom, dateTo, keywords',
    });
  }

  logger.info('[compliance] Request', { query, scope, user, dateFrom, dateTo });

  try {
    const plan = await buildKqlPlan(query || '', { scope, user, dateFrom, dateTo, keywords });
    return res.json({ ok: true, query: query || null, plan });
  } catch (err) {
    logger.error('[compliance] Error', { message: err.message });
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /compliance/build?q=...
 *
 * Quick GET version for simple NL queries — useful for testing from browser.
 * e.g. GET /compliance/build?q=emails+from+cfo+last+30+days
 */
router.get('/build', async (req, res) => {
  const q = req.query.q;
  if (!q) return res.status(400).json({ ok: false, error: 'q parameter required' });

  try {
    const plan = await buildKqlPlan(q.trim());
    return res.json({ ok: true, query: q, plan });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
