/**
 * services/claude.js — NL → Microsoft Graph API plan generator
 *
 * Used by POST /search to translate a natural language query into a structured
 * Microsoft Graph API call plan (endpoint, OData params, HTTP method, scopes).
 * The plan is then executed by services/graph.js against the live M365 tenant.
 *
 * For compliance/eDiscovery queries that should not access live data, use
 * services/kql.js instead — it generates Purview KQL without any data access.
 *
 * Model: claude-opus-4-5
 * Output: JSON — { intent, service, method, endpoint, full_url, params, scopes_needed, notes }
 */
const Anthropic = require('@anthropic-ai/sdk');
const logger    = require('./logger');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are a Microsoft Graph API expert. Convert a natural language search query into a precise, executable Microsoft Graph API call.

Return ONLY valid JSON — no markdown, no backticks, no explanation:

{
  "intent": "One-sentence description of what this query does",
  "service": "One of: Exchange | Teams | SharePoint | Azure AD | Calendar | OneDrive | Azure Monitor",
  "method": "GET or POST",
  "endpoint": "Graph API path only, e.g. /users/{userPrincipalName}/messages",
  "full_url": "Complete URL: https://graph.microsoft.com/v1.0{path}?{odata_params}",
  "params": {
    "$filter": "OData filter expression",
    "$select": "comma-separated fields to return",
    "$search": "search string if using $search instead of $filter",
    "$orderby": "field asc|desc",
    "$top": "max results (default 25)"
  },
  "body": null,
  "scopes_needed": ["Mail.Read.All"],
  "notes": "Caveats — admin consent, pagination, known limitations"
}

Rules:
- Only include params that are needed — omit empty fields
- Email: /users/{userPrincipalName}/messages with $filter on receivedDateTime, from, toRecipients/emailAddress/address
- Teams: /teams/{teamId}/channels/{channelId}/messages (teamId must be known)
- SharePoint: /sites/{siteId}/drive/root/search(q='{term}') or /search/query POST
- Audit logs: /auditLogs/signIns with $filter on userPrincipalName, status/errorCode
- Calendar: /users/{userPrincipalName}/events with $filter on subject, start/dateTime
- Dates: ISO 8601 — receivedDateTime ge 2026-06-01T00:00:00Z and le 2026-06-09T23:59:59Z
- Always include $select to limit payload size
- Default $top to 25 unless query implies otherwise`;

/**
 * Translates a plain-English query into an executable Microsoft Graph API plan.
 * @param {string} nlQuery  - e.g. "find emails to john@contoso.com last 7 days"
 * @returns {Promise<GraphPlan>}
 */
async function buildGraphPlan(nlQuery) {
  logger.debug('[claude] Building Graph plan', { query: nlQuery });

  const message = await client.messages.create({
    model:      'claude-opus-4-5',
    max_tokens: 1024,
    system:     SYSTEM_PROMPT,
    messages:   [{ role: 'user', content: nlQuery }],
  });

  const raw = message.content?.[0]?.text ?? '';

  let plan;
  try {
    plan = JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch {
    logger.error('[claude] Unparseable response', { raw });
    throw new Error('Failed to parse Graph API plan — try rephrasing your query');
  }

  logger.debug('[claude] Plan ready', { service: plan.service, method: plan.method });
  return plan;
}

module.exports = { buildGraphPlan };
