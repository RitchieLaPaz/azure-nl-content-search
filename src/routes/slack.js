const express = require('express');
const { buildGraphPlan }  = require('../services/claude');
const { executeGraphPlan } = require('../services/graph');
const logger = require('../services/logger');

const router = express.Router();

/**
 * POST /slack/command
 *
 * Slack slash command endpoint.
 * Configure your Slack app's slash command URL to point here.
 *
 * Usage in Slack:  /msearch find emails to john@contoso.com last 7 days
 *
 * Slack requires a response within 3 seconds; for longer queries use
 * the response_url pattern (async response) below.
 */
router.post('/command', async (req, res) => {
  const { text, user_name, response_url } = req.body;

  // Acknowledge immediately so Slack doesn't time out
  res.json({
    response_type: 'ephemeral',
    text: `Searching for: _${text}_...`,
  });

  // Run the search async and post back via response_url
  try {
    const plan    = await buildGraphPlan(text);
    const results = await executeGraphPlan(plan);

    const items = Array.isArray(results.data) ? results.data : [results.data];
    const summary = formatSlackResponse(plan, results, items);

    await postToSlack(response_url, summary);

  } catch (err) {
    logger.error('[slack] Command error', { error: err.message });
    await postToSlack(response_url, {
      response_type: 'ephemeral',
      text: `Error: ${err.message}`,
    });
  }
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatSlackResponse(plan, results, items) {
  const count = results.count ?? items.length;

  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${plan.intent}*\n_${plan.service} · ${count} result${count !== 1 ? 's' : ''}_`,
      },
    },
    { type: 'divider' },
  ];

  // Show up to 5 items inline; link to full results if more
  items.slice(0, 5).forEach((item) => {
    const label = item.subject              // email
      ?? item.body?.content?.slice(0, 80)   // Teams message
      ?? item.name                          // file
      ?? item.displayName                   // user/calendar
      ?? JSON.stringify(item).slice(0, 80);

    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `• ${label}` },
    });
  });

  if (count > 5) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `_...and ${count - 5} more results_` }],
    });
  }

  if (results.nextLink) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: '_More pages available — use `planOnly` mode to get the full URL_' }],
    });
  }

  return { response_type: 'in_channel', blocks };
}

async function postToSlack(responseUrl, payload) {
  const axios = require('axios');
  try {
    await axios.post(responseUrl, payload);
  } catch (err) {
    logger.error('[slack] Failed to post response', { error: err.message });
  }
}

module.exports = router;
