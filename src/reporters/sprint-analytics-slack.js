// src/reporters/sprint-analytics-slack.js
const axios = require('axios');

const HEALTH_EMOJI = { Green: '🟢', Yellow: '🟡', Red: '🔴' };
const TREND_EMOJI  = { improving: '📈', stable: '➡️', declining: '📉' };
const BURN_EMOJI   = { 'on track': '✅', 'slightly behind': '⚠️', 'behind': '🔴' };

function getWebhookUrl(boardId) {
  const url = process.env[`SLACK_WEBHOOK_BOARD_${boardId}`]
           || process.env.SLACK_WEBHOOK_DEFAULT
           || process.env.SLACK_WEBHOOK_URL;
  if (!url) throw new Error(`No Slack webhook for board ${boardId}.`);
  return url;
}

function miniBar(pct, width = 10) {
  const filled = Math.round((pct / 100) * width);
  return '█'.repeat(Math.min(filled, width)) + '░'.repeat(Math.max(0, width - filled)) + ` ${pct}%`;
}

async function sendSprintAnalyticsSlack(analysis, boardId) {
  const webhookUrl = getWebhookUrl(boardId);
  const sprint     = analysis.sprintReport;
  const comp       = analysis.completion;
  const hEmoji     = HEALTH_EMOJI[analysis.sprintHealth] || '⚪';
  const blocks     = [];

  // Header
  blocks.push({ type: 'header', text: { type: 'plain_text', emoji: true,
    text: `${hEmoji} Sprint Analytics — ${analysis.displayName || `Board ${boardId}`}` }});
  blocks.push({ type: 'section', text: { type: 'mrkdwn',
    text: `*Sprint:* ${sprint.sprintName}  ·  *ID:* ${sprint.sprintId}` }});
  blocks.push({ type: 'divider' });
  blocks.push({ type: 'divider' });

  // Overview
  blocks.push({ type: 'section', fields: [
    { type: 'mrkdwn', text: `*Health*\n${hEmoji} ${analysis.sprintHealth}` },
    { type: 'mrkdwn', text: `*Period*\n${sprint.startDate} → ${sprint.endDate}` },
    { type: 'mrkdwn', text: `*Goal met*\n${analysis.goalMet === true ? '✅ Yes' : analysis.goalMet === false ? '❌ No' : '❓ Unknown'}` },
    { type: 'mrkdwn', text: `*Removed*\n${sprint.removedIssues.length} issue(s) mid-sprint` },
  ]});

  if (sprint.sprintGoal) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn',
      text: `*Sprint goal*\n_${sprint.sprintGoal}_` }});
  }

  // Velocity
  if (analysis.velocityStats?.sprints?.length) {
    const sprints     = analysis.velocityStats.sprints.slice(-6);
    const tEmoji      = TREND_EMOJI[analysis.velocityStats.trend] || '➡️';
    const pv          = analysis.platformVelocity || [];
    const sprintNameW = Math.min(18, Math.max(10, ...sprints.map(s => s.sprintName.length)));
    const velRows     = sprints.map(s => {
      const pct      = s.committed > 0 ? Math.round((s.completed / s.committed) * 100) : 0;
      const filled   = Math.min(10, Math.round((pct / 100) * 10));
      const bar      = pct >= 100
        ? '🟩'.repeat(10)
        : '🟢'.repeat(filled) + '🟡'.repeat(10 - filled);
      const sprintId = String(s.sprintId);
      const platLine = pv
        .filter(p => p.bySprint[sprintId] != null)
        .map(p => `${p.platform}:${p.bySprint[sprintId]}`)
        .join('  ');
      const name = s.sprintName.length > sprintNameW
        ? s.sprintName.substring(0, sprintNameW - 1) + '…'
        : s.sprintName;
      return `\`${name.padEnd(sprintNameW)}\` ${bar} \`${String(s.completed).padStart(4)}/${String(s.committed).padStart(4)}pts  ${String(pct).padStart(3)}%\`` +
             (platLine ? `\n  _${platLine}_` : '');
    }).join('\n');
    blocks.push({ type: 'section', text: { type: 'mrkdwn',
      text: `*Velocity* ${tEmoji} ${analysis.velocityStats.trend} · avg ${analysis.velocityStats.avg}pts · predicted ${analysis.predictedVelocity}pts\n${velRows}` }});
  }

  // Average velocity by platform
  if (analysis.platformVelocity?.length) {
    const maxAvg = Math.max(...analysis.platformVelocity.map(p => p.avg), 1);
    const rows   = analysis.platformVelocity.map(p => {
      const filled = Math.round((p.avg / maxAvg) * 10);
      const bar_   = '█'.repeat(filled) + '░'.repeat(10 - filled);
      return `\`${p.platform.padEnd(20)} ${bar_} ${String(p.avg).padStart(4)}pts avg\``;
    }).join('\n');
    const n = analysis.platformVelocity[0]?.sprintCount || '';
    blocks.push({ type: 'section', text: { type: 'mrkdwn',
      text: `*📊 Avg velocity by platform${n ? ` (last ${n} sprints)` : ''}*\n${rows}` }});
  }

  blocks.push({ type: 'divider' });

  // Summary
  blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*Summary*\n${analysis.summary}` }});

  // Sprint Data
  const isClosed_ = sprint.state === 'closed';

  const addedIssues   = sprint.addedDuringSprintCount || 0;
  const addedPoints   = sprint.addedDuringSprintPoints || 0;
  const removedIssues = sprint.removedIssues?.length || 0;
  const removedPoints = sprint.removedPoints || 0;

  const initialIssues = (sprint.completedIssues.length
    + (sprint.incompletedIssues?.length || 0)
    + removedIssues
    + (isClosed_ ? (sprint.completedOutsideIssues?.length || 0) : 0))
    - addedIssues;

  const initialPoints = (sprint.completedPoints || 0)
    + (sprint.incompletedPoints || 0)
    + removedPoints
    + (isClosed_ ? (sprint.completedOutsidePoints || 0) : 0)
    - addedPoints;

  const remainingIssues = sprint.completedIssues.length + (sprint.incompletedIssues?.length || 0);
  const remainingPoints = (sprint.completedPoints || 0) + (sprint.incompletedPoints || 0);

  blocks.push({ type: 'section', text: { type: 'mrkdwn',
    text: `*Sprint data*\n` +
      `📌 Initial commitment    ${initialIssues} issues · ${initialPoints}pts\n` +
      `➕ Added during sprint   ${addedIssues} issues · ${addedPoints}pts\n` +
      `🗑️ Removed from sprint   ${removedIssues} issues · ${removedPoints}pts\n` +
      `📊 Remaining in sprint   ${remainingIssues} issues · ${remainingPoints}pts`
  }});

  // Issue categories
  blocks.push({ type: 'section', text: { type: 'mrkdwn',
    text: `*Issue categories*\n` +
      `✅ Completed in sprint    ${sprint.completedIssues.length} issues · ${sprint.completedPoints}pts\n` +
      `⚠️ Not completed          ${sprint.incompletedIssues?.length || 0} issues · ${sprint.incompletedPoints || 0}pts\n` +
      `🔄 Completed outside      ${sprint.completedOutsideIssues?.length || 0} issues · ${sprint.completedOutsidePoints || 0}pts`
  }});

  // Completion + time elapsed
  const timeElapsedLine = (() => {
    if (!sprint.startDate || !sprint.endDate) return '';
    const start       = new Date(sprint.startDate).getTime();
    const end         = new Date(sprint.endDate).getTime();
    const now         = Date.now();
    const elapsed     = Math.min(100, Math.max(0, Math.round(((now - start) / (end - start)) * 100)));
    const daysTotal   = Math.round((end - start) / 86400000);
    const daysElapsed = Math.min(daysTotal, Math.max(0, Math.round((now - start) / 86400000)));
    const paceEmoji   = elapsed > comp.pct + 15 ? '🔴' : elapsed > comp.pct + 5 ? '🟡' : '🟢';
    return `\n⏱️ Time    : \`${miniBar(elapsed)}\`  ${daysElapsed}/${daysTotal} days  ${paceEmoji}`;
  })();

  blocks.push({ type: 'section', text: { type: 'mrkdwn',
    text: `*Completion*\n` +
      `📋 Issues : \`${miniBar(comp.pct)}\`  ${comp.completed}/${comp.total}\n` +
      `⚡ Points : \`${miniBar(comp.ptsPct)}\`  ${comp.completedPts}/${comp.totalPts}` +
      (comp.completedOutside > 0 ? `\n_includes ${comp.completedOutside} issue(s) completed outside sprint_` : '') +
      timeElapsedLine }});

  blocks.push({ type: 'divider' });

  // Analysis — closed sprints only
  if (sprint.state === 'closed' && analysis.analysis) {
    const a = analysis.analysis;
    if (a.whatWentWell?.length) {
      blocks.push({ type: 'section', text: { type: 'mrkdwn',
        text: `*✅ What went well*\n${a.whatWentWell.map(w => `• ${w}`).join('\n')}` }});
    }
    if (a.whatDidntGoWell?.length) {
      blocks.push({ type: 'section', text: { type: 'mrkdwn',
        text: `*❌ What didn't go well*\n${a.whatDidntGoWell.map(w => `• ${w}`).join('\n')}` }});
    }
    const insights = [
      a.scopeChanges    ? `📦 *Scope:* ${a.scopeChanges}`       : null,
      a.velocityInsight ? `📈 *Velocity:* ${a.velocityInsight}` : null,
      a.carryoverImpact ? `🔄 *Carryover:* ${a.carryoverImpact}` : null,
    ].filter(Boolean);
    if (insights.length) {
      blocks.push({ type: 'section', text: { type: 'mrkdwn', text: insights.join('\n') }});
    }
    if (a.retrospectiveActions?.length) {
      blocks.push({ type: 'section', text: { type: 'mrkdwn',
        text: `*🔁 Retrospective actions*\n${a.retrospectiveActions.map(r => `• ${r}`).join('\n')}` }});
    }
  }

  // Risks — active sprints only
  if (sprint.state !== 'closed' && analysis.risks?.length) {
    const rEmoji = { High: '🔴', Medium: '🟡', Low: '🔵' };
    const lines  = analysis.risks.map(r => `${rEmoji[r.level] || '⚪'} *[${r.level}]* ${r.description}`).join('\n');
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*Risks*\n${lines}` }});
  }

  // Recommendations — active sprints only
  if (sprint.state !== 'closed' && analysis.recommendations?.length) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn',
      text: `*💡 Recommendations*\n${analysis.recommendations.map(r => `• ${r}`).join('\n')}` }});
  }

  blocks.push({ type: 'context', elements: [{ type: 'mrkdwn',
    text: `Sprint Analytics · ${analysis.displayName || `Board ${boardId}`} · ${new Date().toLocaleString()} · Jira Data Center + Claude AI` }]});

  await axios.post(webhookUrl, {
    text:   `${hEmoji} Sprint Analytics — ${sprint.sprintName}`,
    blocks,
  }, { headers: { 'Content-Type': 'application/json' }});
}

module.exports = { sendSprintAnalyticsSlack };
