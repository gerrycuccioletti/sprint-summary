// src/reporters/release-set-slack.js
const axios = require('axios');

const HEALTH_EMOJI      = { Green: '🟢', Yellow: '🟡', Red: '🔴' };
const FEASIBILITY_EMOJI = {
  'On track': '✅', 'At risk': '⚠️', 'Likely delayed': '🔴', 'Should be descoped': '✂️',
};

function getWebhookUrl(setName) {
  const url = process.env[`SLACK_WEBHOOK_SET_${setName}`]
           || process.env.SLACK_WEBHOOK_DEFAULT
           || process.env.SLACK_WEBHOOK_URL;
  if (!url) throw new Error(`No Slack webhook for set ${setName}. Set SLACK_WEBHOOK_SET_${setName} or SLACK_WEBHOOK_DEFAULT.`);
  return url;
}

function miniBar(pct) {
  const filled = Math.round(pct / 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled) + ` ${pct}%`;
}

async function sendReleaseSetSlack(analysis, setName) {
  const webhookUrl = getWebhookUrl(setName);
  const hEmoji     = HEALTH_EMOJI[analysis.overallHealth] || '⚪';
  const fEmoji     = FEASIBILITY_EMOJI[analysis.releaseFeasibility] || '❓';
  const blocks     = [];

  // Header
  blocks.push({ type: 'header', text: { type: 'plain_text', emoji: true,
    text: `${hEmoji} Release Set — ${analysis.setName}` } });
  blocks.push({ type: 'divider' });

  // Overview
  blocks.push({ type: 'section', fields: [
    { type: 'mrkdwn', text: `*Health*\n${hEmoji} ${analysis.overallHealth}` },
    { type: 'mrkdwn', text: `*Feasibility*\n${fEmoji} ${analysis.releaseFeasibility || '—'}` },
    { type: 'mrkdwn', text: `*Readiness*\n\`${miniBar(analysis.readiness || 0)}\`` },
    { type: 'mrkdwn', text: `*Scope*\n${analysis.stats.projectCount} projects · ${analysis.stats.teamCount} teams` },
  ]});
  blocks.push({ type: 'section', text: { type: 'mrkdwn',
    text: `*Issues*\n📋 ${analysis.stats.total} total · ✅ ${analysis.stats.done} done · 🔄 ${analysis.stats.inProgress} in progress · ⏳ ${analysis.stats.notStarted} not started` }});
  blocks.push({ type: 'section', text: { type: 'mrkdwn',
    text: `*All Fix versions found in the set*\n${(analysis.versionNames || []).join(', ') || '—'}` }});
  if (analysis.jqlExecuted) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn',
      text: `*JQL used*\n\`\`\`${analysis.jqlExecuted}\`\`\`` }});
  }
  blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*Summary*\n${analysis.summary}` }});
  blocks.push({ type: 'divider' });

  // By version
  if (analysis.byVersion?.length) {
    const rows = analysis.byVersion.map(v => {
      const pct = v.readiness || 0;
      return `• *${v.version}* · \`${miniBar(pct)}\` · ✅ ${v.done}/${v.total} · 🔄 ${v.inProgress} · ⏳ ${v.notStarted}`;
    }).join('\n');
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*By fix version*\n${rows}` }});
    blocks.push({ type: 'divider' });
  }

  // By project
  if (analysis.byProject?.length) {
    const rows = analysis.byProject.map(p => {
      const h = HEALTH_EMOJI[p.health] || '⚪';
      return `${h} *${p.projectKey}* · \`${miniBar(p.readiness||0)}\` · ✅ ${p.done}/${p.total}` +
             (p.blockers?.length ? ` · 🚧 ${p.blockers.length}` : '') +
             (p.criticalUnfinished?.length ? ` · ⛔ ${p.criticalUnfinished.length} critical` : '');
    }).join('\n');
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*By project*\n${rows}` }});
    blocks.push({ type: 'divider' });
  }

  // By team
  if (analysis.byTeam?.length) {
    const rows = analysis.byTeam.map(t => {
      const h = HEALTH_EMOJI[t.health] || '⚪';
      return `${h} *${t.team}* · \`${miniBar(t.readiness||0)}\` · ✅ ${t.done}/${t.total}` +
             (t.blockers?.length ? ` · 🚧 ${t.blockers.length}` : '');
    }).join('\n');
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*By team*\n${rows}` }});
    blocks.push({ type: 'divider' });
  }

  // Cross-project blockers
  if (analysis.crossProjectBlockers?.length) {
    const lines = analysis.crossProjectBlockers.map(b =>
      `• *[${b.projectKey}] ${b.issueKey}* — ${b.title}\n  _${b.impact}_`
    ).join('\n');
    blocks.push({ type: 'section', text: { type: 'mrkdwn',
      text: `*🚧 Cross-project blockers (${analysis.crossProjectBlockers.length})*\n${lines}` }});
    blocks.push({ type: 'divider' });
  }

  // Recommendations
  if (analysis.recommendations?.length) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn',
      text: `*💡 Recommendations*\n${analysis.recommendations.map(r => `• ${r}`).join('\n')}` }});
  }

  blocks.push({ type: 'context', elements: [{ type: 'mrkdwn',
    text: `Release Set · ${new Date().toLocaleString()} · Jira Data Center + Claude AI` }]});

  await axios.post(webhookUrl, {
    text:   `${hEmoji} Release Set ${analysis.setName} — ${analysis.overallHealth}`,
    blocks,
  }, { headers: { 'Content-Type': 'application/json' }});
}

module.exports = { sendReleaseSetSlack };
