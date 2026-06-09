/**
 * services/graph.js — Microsoft Graph API executor
 *
 * Executes Graph API plans produced by services/claude.js.
 * Handles Bearer token acquisition (via services/auth.js), request construction,
 * pagination, and maps common HTTP error codes to actionable messages.
 *
 * Used by POST /search for live M365 data access.
 * Not used by POST /compliance — that route only generates KQL without data access.
 *
 * Requires Azure AD application permissions with admin consent.
 * See README for the full list of required permissions.
 */
const axios            = require('axios');
const { getAccessToken } = require('./auth');
const logger           = require('./logger');

/**
 * Executes a single Graph API request from a Claude-generated plan.
 * Returns the response data, nextLink for pagination, and result count.
 *
 * @param {object} plan  - Output of buildGraphPlan() from services/claude.js
 * @returns {Promise<{ data, nextLink, count, service, intent, notes }>}
 */
async function executeGraphPlan(plan) {
  const token = await getAccessToken();

  const config = {
    method:  (plan.method || 'GET').toLowerCase(),
    url:     plan.full_url,
    headers: {
      Authorization:    `Bearer ${token}`,
      'Content-Type':   'application/json',
      ConsistencyLevel: 'eventual',  // required for $search and $count on some endpoints
    },
  };

  if (plan.method === 'POST' && plan.body) {
    config.data = plan.body;
  }

  logger.info('[graph] Executing', { method: config.method.toUpperCase(), url: config.url });

  try {
    const response = await axios(config);
    const data     = response.data;

    return {
      data:     data.value ?? data,
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

    if (status === 401) throw new Error('Graph API authentication failed — check your Azure app credentials');
    if (status === 403) throw new Error(`Insufficient permissions. Required: ${plan.scopes_needed?.join(', ')}`);
    if (status === 404) throw new Error('Resource not found — verify the user, site, or team ID');
    if (status === 429) throw new Error('Graph API rate limit hit — please retry in a moment');

    throw new Error(errBody?.message ?? 'Graph API request failed');
  }
}

/**
 * Follows @odata.nextLink to retrieve all pages of a Graph API response.
 * Use carefully — result sets can be very large for broad queries.
 *
 * @param {object} plan      - Initial plan from buildGraphPlan()
 * @param {number} maxPages  - Safety cap. Default 5 = up to 125 results at $top=25
 * @returns {Promise<{ data, nextLink, count, pagesfetched, service, intent, notes }>}
 */
async function executeGraphPlanPaginated(plan, maxPages = 5) {
  const token   = await getAccessToken();
  const headers = {
    Authorization:    `Bearer ${token}`,
    'Content-Type':   'application/json',
    ConsistencyLevel: 'eventual',
  };

  let url       = plan.full_url;
  let allItems  = [];
  let pageCount = 0;

  while (url && pageCount < maxPages) {
    logger.debug('[graph] Fetching page', { page: pageCount + 1 });
    const resp = await axios({ method: plan.method.toLowerCase(), url, headers });
    const data = resp.data;

    allItems = allItems.concat(data.value ?? []);
    url       = data['@odata.nextLink'] ?? null;
    pageCount++;
  }

  return {
    data:         allItems,
    nextLink:     url ?? null,   // non-null means more pages exist beyond maxPages cap
    count:        allItems.length,
    pagesfetched: pageCount,
    service:      plan.service,
    intent:       plan.intent,
    notes:        plan.notes ?? null,
  };
}

module.exports = { executeGraphPlan, executeGraphPlanPaginated };
