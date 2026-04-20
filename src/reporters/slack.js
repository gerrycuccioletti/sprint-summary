// src/reporters/slack.js
// Sends a rich Slack notification using Block Kit
const axios = require('axios');

const HEALTH_EMOJI = { Green: '🟢', Yellow: '🟡', Red: '🔴' };
const RISK_EMOJI   = { High: '🔴', Medium: '🟡', Low: '🔵' };

// Build Slack Block Kit payload from the Claude analysis
function buildSlackPayload(analysis, sprint, jiraBaseUrl) {
  const emoji  = HEALTH_EMOJI[analysis.overallHealth] || '⚪';
  const blocks = [];

  // ── Header ──────────────────────────────────────────────────────────────
  blocks.push({
    type: 'header',
    text: { type: 'plain_text', text: `${emoji} Sprint Report — ${analysis.sprintName}`, emoji: true },
  });

  blocks.push({ type: 'divider' });

  // ── Health + summary ────────────────────────────────────────────────────
  blocks.push({
    type: 'section',
    fields: [
      { type: 'mrkdwn', text: `*Health*\n${emoji} ${analysis.overallHealth}` },
      { type: 'mrkdwn', text: `*Sprint window*\n${sprint.startDate || '?'} → ${sprint.endDate || '?'}` },
    ],
  });

  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: `*Summary*\n${analysis.summary}` },
  });

  // ── Stats ────────────────────────────────────────────────────────────────
  const statusText = Object.entries(analysis.stats.byStatus || {})
    .map(([s, n]) => `• ${s}: *${n}*`)
    .join('\n');

  blocks.push({
    type: 'section',
    fields: [
      { type: 'mrkdwn', text: `*Total issues*\n${analysis.stats.total}` },
      { type: 'mrkdwn', text: `*Unassigned*\n${analysis.stats.unassigned > 0 ? `⚠️ ${analysis.stats.unassigned}` : '✅ 0'}` },
    ],
  });

  if (statusText) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Status breakdown*\n${statusText}` },
    });
  }

  blocks.push({ type: 'divider' });

  // ── Blockers ─────────────────────────────────────────────────────────────
  if (analysis.blockers?.length > 0) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*🚧 Blockers (${analysis.blockers.length})*` },
    });

    analysis.blockers.forEach((b) => {
      const link = jiraBaseUrl
        ? `<${jiraBaseUrl}/browse/${b.issueKey}|${b.issueKey}>`
        : b.issueKey;

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${link} — *${b.title}*\n_Action: ${b.suggestedAction}_`,
        },
      });
    });

    blocks.push({ type: 'divider' });
  }

  // ── Risks ────────────────────────────────────────────────────────────────
  if (analysis.risks?.length > 0) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*⚠️ Risks (${analysis.risks.length})*` },
    });

    analysis.risks.forEach((r) => {
      const rEmoji = RISK_EMOJI[r.level] || '⚪';
      const link = jiraBaseUrl
        ? `<${jiraBaseUrl}/browse/${r.issueKey}|${r.issueKey}>`
        : r.issueKey;

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${rEmoji} *[${r.level}]* ${link} — ${r.title}\n${r.reason}`,
        },
      });
    });

    blocks.push({ type: 'divider' });
  }

  // ── Workload warnings ────────────────────────────────────────────────────
  if (analysis.workloadWarnings?.length > 0) {
    const warnText = analysis.workloadWarnings.map((w) => `• ${w}`).join('\n');
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*👥 Workload*\n${warnText}` },
    });
    blocks.push({ type: 'divider' });
  }

  // ── Recommendations ───────────────────────────────────────────────────────
  if (analysis.recommendations?.length > 0) {
    const recText = analysis.recommendations.map((r) => `• ${r}`).join('\n');
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*💡 Recommendations*\n${recText}` },
    });
  }

  // ── Footer ────────────────────────────────────────────────────────────────
  blocks.push({
    type: 'context',
    elements: [{
      type: 'mrkdwn',
      text: `Sprint Summary · Generated ${new Date().toLocaleString()} · Jira Data Center + Claude AI`,
    }],
  });

  return {
    text: `${emoji} Sprint Report — ${analysis.sprintName} · ${analysis.overallHealth}`,
    blocks,
  };
}

// Resolve the correct webhook URL for a given board
function getWebhookUrl(boardId) {
  const specific = boardId && process.env[`SLACK_WEBHOOK_BOARD_${boardId}`];
  const fallback = process.env.SLACK_WEBHOOK_DEFAULT
                || process.env.SLACK_WEBHOOK_URL;
  const url = specific || fallback;

  if (!url) throw new Error(
    `No Slack webhook found for board ${boardId}. ` +
    `Set SLACK_WEBHOOK_BOARD_${boardId} or SLACK_WEBHOOK_DEFAULT in .env`
  );

  return url;
}

// Post the Slack notification
async function sendSlackNotification(analysis, sprint, boardId) {
  const webhookUrl  = getWebhookUrl(boardId);
  const jiraBaseUrl = process.env.JIRA_BASE_URL || '';
  const payload     = buildSlackPayload(analysis, sprint, jiraBaseUrl);

  const res = await axios.post(webhookUrl, payload, {
    headers: { 'Content-Type': 'application/json' },
  });

  if (res.status !== 200 || res.data !== 'ok') {
    throw new Error(`Slack API error: ${res.status} ${JSON.stringify(res.data)}`);
  }

  return true;
}

module.exports = { sendSlackNotification };
