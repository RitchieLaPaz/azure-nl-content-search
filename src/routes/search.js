const express = require('express');
const { buildGraphPlan }    = require('../services/claude');
const { executeGraphPlan, executeGraphPlanPaginated } = require('../services/graph');
const logger = require('../services/logger');

const router = express.Router();

/**
 * POST /search
 *
 * Body:
 *   {
 *     "query":     "find all emails sent to john@contoso.com last 7 days",  // required
 *     "paginate":  false,   // optional — fetch all pages (default false)
 *     "maxPages":  5,       // optional — safety cap when paginate=true
 *     "planOnly":  false    // optional — return the Graph API plan without executing
 *   }
 *
 * Response:
 *   {
 *     "ok": true,
 *     "query": "...",
 *     "plan": { intent, service, method, full_url, ... },
 *     "results": { data: [...], count: N, nextLink: null|"...", ... }
 *   }
 */
router.post('/', async (req, res) => {
  const { query, paginate = false, maxPages = 5, planOnly = false } = req.body;

  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    return res.status(400).json({ ok: false, error: 'query is required and must be a non-empty string' });
  }

  logger.info('[search] Incoming query', { query: query.trim() });

  try {
    // Step 1: Claude translates NL → Graph API plan
    const plan = await buildGraphPlan(query.trim());

    // planOnly mode — useful for testing / UI preview
    if (planOnly) {
      return res.json({ ok: true, query, plan });
    }

    // Step 2: Execute the plan against Graph API
    const results = paginate
      ? await executeGraphPlanPaginated(plan, maxPages)
      : await executeGraphPlan(plan);

    return res.json({ ok: true, query, plan, results });

  } catch (err) {
    logger.error('[search] Error', { message: err.message });
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /search/plan?q=...
 *
 * Convenience endpoint — returns just the Graph API plan for a query.
 * Useful for frontend "preview before execute" flows.
 */
router.get('/plan', async (req, res) => {
  const query = req.query.q;

  if (!query) {
    return res.status(400).json({ ok: false, error: 'q parameter is required' });
  }

  try {
    const plan = await buildGraphPlan(query.trim());
    return res.json({ ok: true, query, plan });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
