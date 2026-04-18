// src/reporters/release-slack.js
const axios = require('axios');

const HEALTH_EMOJI    = { Green: '🟢', Yellow: '🟡', Red: '🔴' };
const FEASIBILITY_EMOJI = {
  'On track':           '✅',
  'At risk':            '⚠️',
  'Likely delayed':     '🔴',
  'Should be descoped': '✂️',
};
const RISK_EMOJI = { High: '🔴', Medium: '🟡', Low: '🔵' };

function getWebhookUrl(projectKey) {
  const specific = process.env[`SLACK_WEBHOOK_RELEASE_${projectKey}`];
  const fallback = process.env.SLACK_WEBHOOK_DEFAULT || process.env.SLACK_WEBHOOK_URL;
  const url = specific || fallback;
  if (!url) throw new Error(
    `No Slack webhook for release ${projectKey}. Set SLACK_WEBHOOK_RELEASE_${projectKey} or SLACK_WEBHOOK_DEFAULT.`
  );
  return url;
}

function readinessBar(pct) {
  const filled = Math.round(pct / 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled) + ` ${pct}%`;
}

async function sendReleaseSlackNotification(analysis, version, projectKey) {
  const webhookUrl  = getWebhookUrl(projectKey);
  const jiraBaseUrl = process.env.JIRA_BASE_URL || '';
  const hEmoji      = HEALTH_EMOJI[analysis.overallHealth] || '⚪';
  const fEmoji      = FEASIBILITY_EMOJI[analysis.releaseFeasibility] || '❓';
  const blocks      = [];

  blocks.push({
    type: 'header',
    text: { type: 'plain_text', text: `${hEmoji} Release Health — ${analysis.releaseName}`, emoji: true },
  });
  blocks.push({ type: 'divider' });

  blocks.push({
    type: 'section',
    fields: [
      { type: 'mrkdwn', text: `*Health*\n${hEmoji} ${analysis.overallHealth}` },
      { type: 'mrkdwn', text: `*Feasibility*\n${fEmoji} ${analysis.releaseFeasibility || '—'}` },
      { type: 'mrkdwn', text: `*Readiness*\n\`${readinessBar(analysis.readiness || 0)}\`` },
      { type: 'mrkdwn', text: `*Target date*\n${version.releaseDate || 'Not set'}` },
    ],
  });

  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: `*Summary*\n${analysis.summary}` },
  });

  blocks.push({
    type: 'section',
    fields: [
      { type: 'mrkdwn', text: `*Total*\n${analysis.stats.total}` },
      { type: 'mrkdwn', text: `*Done*\n✅ ${analysis.stats.done}` },
      { type: 'mrkdwn', text: `*In progress*\n🔄 ${analysis.stats.inProgress}` },
      { type: 'mrkdwn', text: `*Not started*\n${analysis.stats.notStarted > 0 ? '⏳ ' : ''}${analysis.stats.notStarted}` },
    ],
  });

  blocks.push({ type: 'divider' });

  if (analysis.blockers?.length) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*🚧 Blockers (${analysis.blockers.length})*` } });
    analysis.blockers.forEach(b => {
      const link = jiraBaseUrl ? `<${jiraBaseUrl}/browse/${b.issueKey}|${b.issueKey}>` : b.issueKey;
      blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `${link} — *${b.title}*\n_${b.suggestedAction}_` } });
    });
    blocks.push({ type: 'divider' });
  }

  if (analysis.criticalUnfinished?.length) {
    const lines = analysis.criticalUnfinished.map(i => {
      const link = jiraBaseUrl ? `<${jiraBaseUrl}/browse/${i.issueKey}|${i.issueKey}>` : i.issueKey;
      return `• ${link} [${i.priority}] ${i.title} — _${i.status} · ${i.assignee}_`;
    }).join('\n');
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*⛔ Critical unfinished (${analysis.criticalUnfinished.length})*\n${lines}` } });
    blocks.push({ type: 'divider' });
  }

  if (analysis.risks?.length) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*⚠️ Risks (${analysis.risks.length})*` } });
    analysis.risks.forEach(r => {
      const link = jiraBaseUrl ? `<${jiraBaseUrl}/browse/${r.issueKey}|${r.issueKey}>` : r.issueKey;
      blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `${RISK_EMOJI[r.level] || '⚪'} *[${r.level}]* ${link} — ${r.title}\n${r.reason}` } });
    });
    blocks.push({ type: 'divider' });
  }

  if (analysis.recommendations?.length) {
    const recText = analysis.recommendations.map(r => `• ${r}`).join('\n');
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*💡 Recommendations*\n${recText}` } });
  }

  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: `Release Health · ${projectKey} · ${new Date().toLocaleString()} · Jira DC + Claude AI` }],
  });

  const res = await axios.post(webhookUrl, {
    text:   `${hEmoji} Release Health — ${analysis.releaseName} · ${analysis.overallHealth}`,
    blocks,
  }, { headers: { 'Content-Type': 'application/json' } });

  if (res.status !== 200 || res.data !== 'ok') {
    throw new Error(`Slack error: ${res.status} ${JSON.stringify(res.data)}`);
  }
}

module.exports = { sendReleaseSlackNotification };
