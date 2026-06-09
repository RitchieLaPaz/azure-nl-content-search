const axios  = require('axios');
const { getAccessToken } = require('./auth');
const logger = require('./logger');

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

/**
 * Executes a Graph API plan produced by claude.js.
 * Handles token acquisition, request construction, and basic error mapping.
 *
 * @param {object} plan  - Output of buildGraphPlan()
 * @returns {Promise<{ data: any, nextLink: string|null, count: number }>}
 */
async function executeGraphPlan(plan) {
  const token = await getAccessToken();

  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    ConsistencyLevel: 'eventual', // required for $search and $count on some endpoints
  };

  // Build request config from plan
  const config = {
    method:  (plan.method || 'GET').toLowerCase(),
    url:     plan.full_url,
    headers,
  };

  // Attach body for POST requests (e.g. /search/query)
  if (plan.method === 'POST' && plan.body) {
    config.data = plan.body;
  }

  logger.info('[graph] Executing', { method: config.method.toUpperCase(), url: config.url });

  try {
    const response = await axios(config);
    const data = response.data;

    return {
      data:     data.value ?? data,          // Graph usually wraps arrays in .value
      nextLink: data['@odata.nextLink'] ?? null,
      count:    data['@odata.count']    ?? (Array.isArray(data.value) ? data.value.length : 1),
      service:  plan.service,
      intent:   plan.intent,
      notes:    plan.notes ?? null,
    };

  } catch (err) {
    const status  = err.response?.status;
    const errBody = err.response?.data?.error;

    logger.error('[graph] API error', { status, code: errBody?.code, message: errBody?.message });

    // Translate common Graph errors into actionable messages
    if (status === 401) throw new Error('Graph API authentication failed — check your Azure app credentials');
    if (status === 403) throw new Error(`Insufficient permissions for this query. Scope needed: ${plan.scopes_needed?.join(', ')}`);
    if (status === 404) throw new Error('Resource not found — the user, site, or team ID may be incorrect');
    if (status === 429) throw new Error('Graph API rate limit hit — please retry in a moment');

    throw new Error(errBody?.message ?? 'Graph API request failed');
  }
}

/**
 * Fetches all pages of a Graph API response (follows @odata.nextLink).
 * Use carefully — unbounded for very large mailboxes.
 *
 * @param {object} plan      - Initial plan from buildGraphPlan()
 * @param {number} maxPages  - Safety cap (default 5 = up to 125 results at $top=25)
 */
async function executeGraphPlanPaginated(plan, maxPages = 5) {
  const token    = await getAccessToken();
  const headers  = {
    Authorization:    `Bearer ${token}`,
    'Content-Type':   'application/json',
    ConsistencyLevel: 'eventual',
  };

  let url       = plan.full_url;
  let allItems  = [];
  let pageCount = 0;

  while (url && pageCount < maxPages) {
    logger.debug('[graph] Fetching page', { page: pageCount + 1, url });
    const resp = await axios({ method: plan.method.toLowerCase(), url, headers });
    const data = resp.data;

    allItems = allItems.concat(data.value ?? []);
    url       = data['@odata.nextLink'] ?? null;
    pageCount++;
  }

  return {
    data:         allItems,
    nextLink:     url ?? null,    // null = fully fetched; non-null = more pages exist
    count:        allItems.length,
    pagesfetched: pageCount,
    service:      plan.service,
    intent:       plan.intent,
    notes:        plan.notes ?? null,
  };
}

module.exports = { executeGraphPlan, executeGraphPlanPaginated };
