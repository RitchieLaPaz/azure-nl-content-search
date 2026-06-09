const Anthropic = require('@anthropic-ai/sdk');
const logger = require('./logger');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are a Microsoft Graph API expert. Your job is to convert a natural language search query into a precise, executable Microsoft Graph API call.

Return ONLY a valid JSON object — no markdown, no backticks, no explanation — with this exact shape:

{
  "intent": "One-sentence description of what this query does",
  "service": "One of: Exchange | Teams | SharePoint | Azure AD | Calendar | OneDrive | Azure Monitor",
  "method": "GET or POST",
  "endpoint": "Graph API path, e.g. /users/{userPrincipalName}/messages",
  "full_url": "Complete URL: https://graph.microsoft.com/v1.0{path}?{params}",
  "params": {
    "$filter": "OData filter expression if needed",
    "$select": "comma-separated field names to return",
    "$search": "search string if using $search instead of $filter",
    "$orderby": "field desc/asc",
    "$top": "max results as number string, default 25"
  },
  "body": null,
  "scopes_needed": ["Mail.Read.All"],
  "notes": "Any caveats — e.g. requires admin consent, pagination needed for large results"
}

Rules:
- Only include params that are actually needed. Omit empty/unused fields from "params".
- For email: /users/{userPrincipalName}/messages with $filter on receivedDateTime, from, toRecipients/emailAddress/address
- For Teams channel messages: /teams/{teamId}/channels/{channelId}/messages — note teamId must be known
- For SharePoint file search: /sites/{siteId}/drive/root/search(q='{term}') or /search/query (POST)
- For sign-in audit: /auditLogs/signIns with $filter on userPrincipalName, status/errorCode
- For calendar: /users/{userPrincipalName}/events with $filter on subject, start/dateTime
- For OneDrive shared items: /drives/{driveId}/root/children or /me/drive/sharedWithMe
- When a user is mentioned by first name only (e.g. "from Sarah"), use it in a comment in "notes" — the actual filter needs the email or UPN
- Date ranges: use ISO 8601, e.g. receivedDateTime ge 2026-06-01T00:00:00Z and receivedDateTime le 2026-06-08T23:59:59Z
- Always include $select to limit response payload — only request fields the caller needs
- Default $top to 25 unless the query implies a different limit`;

/**
 * Translates a plain-English query into a Graph API plan.
 * @param {string} nlQuery  - e.g. "find emails to john@contoso.com last 7 days"
 * @returns {Promise<GraphPlan>}
 */
async function buildGraphPlan(nlQuery) {
  logger.debug('[claude] Building Graph plan for:', nlQuery);

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
  } catch (err) {
    logger.error('[claude] Failed to parse response', { raw });
    throw new Error('Claude returned an unparseable response — try rephrasing your query');
  }

  logger.debug('[claude] Plan built:', { service: plan.service, method: plan.method, url: plan.full_url });
  return plan;
}

module.exports = { buildGraphPlan };
