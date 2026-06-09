const Anthropic = require('@anthropic-ai/sdk');
const logger = require('./logger');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are a Microsoft Purview Compliance Center expert. Convert the user's search request into a KQL (Keyword Query Language) query for M365 Content Search or eDiscovery.

Return ONLY valid JSON — no markdown, no backticks, no explanation:

{
  "intent": "One-sentence description of what this search does",
  "kql": "The complete KQL query string",
  "content_types": ["Email", "Teams chats"],
  "locations": {
    "mailboxes": ["upn@domain.com"],
    "sites": ["https://contoso.sharepoint.com/sites/finance"],
    "teams": ["Team display name"],
    "all_mailboxes": false,
    "all_sites": false
  },
  "purview_steps": [
    "In Purview, go to Content search → New search",
    "Paste the KQL into the Keywords box",
    "Under Locations, add the specific mailboxes listed",
    "Run the search, then export results as PST"
  ],
  "notes": "Any caveats — role required, expected volume, date sensitivity"
}

KQL syntax reference:
  Recipient:     to:john@contoso.com  or  recipients:john@contoso.com
  Sender:        from:sarah@contoso.com
  Received:      received:2026-01-01..2026-06-09   or   received>=2026-06-01
  Sent:          sent:2026-01-01..2026-06-09
  Subject:       subject:"wire transfer"
  Body keyword:  "confidential" AND "Q4 forecast"
  Attachment:    hasattachment:true
  File type:     filetype:pdf
  Teams msgs:    kind:im AND "budget discussion"
  SharePoint:    site:https://contoso.sharepoint.com AND "contract"
  Wildcards:     invest*   (matches invest, investor, investment)
  Exclusion:     NOT from:noreply@contoso.com

Rules:
- AND / OR / NOT must be UPPERCASE
- Multi-word phrases must be in double quotes
- Combine conditions with AND for specificity
- When no user is specified, set all_mailboxes: true and leave mailboxes array empty
- When a date range is implied (e.g. "last 7 days"), compute ISO dates relative to today
- Default content_types to ["Email"] unless the query implies Teams or SharePoint content
- Always populate purview_steps with the exact steps IT should follow in Purview`;

/**
 * Generates a Microsoft Purview KQL query from a natural language request.
 *
 * @param {string} nlQuery     - Plain English search request
 * @param {object} [hints]     - Optional structured hints from guided form fields
 * @param {string} [hints.scope]      - 'All' | 'Email' | 'Teams' | 'SharePoint' | 'OneDrive'
 * @param {string} [hints.user]       - Mailbox UPN
 * @param {string} [hints.dateFrom]   - ISO date string
 * @param {string} [hints.dateTo]     - ISO date string
 * @param {string} [hints.keywords]   - Keyword string
 * @returns {Promise<KqlPlan>}
 */
async function buildKqlPlan(nlQuery, hints = {}) {
  // Merge guided field hints into the prompt if no freeform NL was provided
  let prompt = nlQuery;

  if (!nlQuery && Object.values(hints).some(Boolean)) {
    const parts = [];
    if (hints.scope && hints.scope !== 'All') parts.push(`Content type: ${hints.scope}`);
    if (hints.user)     parts.push(`User/mailbox: ${hints.user}`);
    if (hints.dateFrom) parts.push(`From date: ${hints.dateFrom}`);
    if (hints.dateTo)   parts.push(`To date: ${hints.dateTo}`);
    if (hints.keywords) parts.push(`Keywords: ${hints.keywords}`);
    prompt = parts.join(', ');
  }

  if (!prompt) throw new Error('No query provided');

  logger.info('[kql] Building KQL plan', { prompt });

  const message = await client.messages.create({
    model:      'claude-opus-4-5',
    max_tokens: 1024,
    system:     SYSTEM_PROMPT,
    messages:   [{ role: 'user', content: prompt }],
  });

  const raw = message.content?.[0]?.text ?? '';

  let plan;
  try {
    plan = JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch (err) {
    logger.error('[kql] Failed to parse Claude response', { raw });
    throw new Error('KQL generation failed — try rephrasing your query');
  }

  logger.info('[kql] Plan built', { intent: plan.intent, kql: plan.kql });
  return plan;
}

module.exports = { buildKqlPlan };
