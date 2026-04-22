// src/reporters/qa-kickback-slack.js
const axios = require('axios');

function ratioEmoji(ratio) {
  if (ratio === 0)  return '🟢';
  if (ratio <= 10)  return '🟡';
  if (ratio <= 25)  return '🟠';
  return '🔴';
}

function miniBar(ratio, width = 10) {
  const filled = Math.min(width, Math.round((ratio / 100) * width));
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

async function sendQAKickbackSlack(results, fromDate, toDate) {
  const webhookUrl = process.env.SLACK_WEBHOOK_DEFAULT || process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) { console.warn('[QAKickback] No SLACK_WEBHOOK_DEFAULT set'); return; }

  const valid = results.filter(r => !r.error);
  const total = {
    denominator:  valid.reduce((s, r) => s + r.denominator,          0),
    denominator2: valid.reduce((s, r) => s + (r.denominator2 || 0),  0),
    numerator:    valid.reduce((s, r) => s + r.numerator,            0),
  };
  const totalRatio  = total.denominator  > 0 ? Math.round((total.numerator / total.denominator)  * 1000) / 10 : 0;
  const totalRatio2 = total.denominator2 > 0 ? Math.round((total.numerator / total.denominator2) * 1000) / 10 : 0;

  const hEmoji = ratioEmoji(totalRatio);
  const blocks = [];

  blocks.push({ type: 'header', text: { type: 'plain_text', emoji: true,
    text: `${hEmoji} QA Kickback Ratio Report` }});

  blocks.push({ type: 'section', text: { type: 'mrkdwn',
    text: `*Period:* ${fromDate} → ${toDate}\n*In QA → ReOpen kickbacks*` }});

  blocks.push({ type: 'divider' });

  const rows = results.map(r => {
    if (r.error) return `\`${r.projectKey.padEnd(10)}\` ❌ ${r.error}`;
    const e1 = ratioEmoji(r.ratio);
    const e2 = ratioEmoji(r.ratio2 || 0);
    return `\`${r.projectKey.padEnd(10)} ${miniBar(r.ratio)}  →QA:${String(r.denominator).padStart(3)}  InQA:${String(r.denominator2 || 0).padStart(3)}  ←:${String(r.numerator).padStart(3)}  R1:${String(r.ratio + '%').padStart(5)} ${e1}  R2:${String((r.ratio2 || 0) + '%').padStart(5)} ${e2}\``;
  }).join('\n');

  blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*By project*\n${rows}` }});

  blocks.push({ type: 'section', fields: [
    { type: 'mrkdwn', text: `*→ In QA (D1)*\n${total.denominator} tickets` },
    { type: 'mrkdwn', text: `*In QA (D2)*\n${total.denominator2} tickets` },
    { type: 'mrkdwn', text: `*Kicked back*\n${total.numerator} tickets` },
    { type: 'mrkdwn', text: `*Ratio 1* _(back/entered)_\n${ratioEmoji(totalRatio)} ${totalRatio}%` },
    { type: 'mrkdwn', text: `*Ratio 2* _(back/in QA)_\n${ratioEmoji(totalRatio2)} ${totalRatio2}%` },
  ]});

  blocks.push({ type: 'section', text: { type: 'mrkdwn',
    text: `_D1 = tickets that moved TO In QA · D2 = tickets IN QA at any point · R1 = kickbacks/D1 · R2 = kickbacks/D2_` }});

  blocks.push({ type: 'divider' });

  for (const r of valid) {
    if (!r.details?.kickedBack?.length) continue;
    const lines = r.details.kickedBack.slice(0, 10).map(i =>
      `• <${process.env.JIRA_BASE_URL}/browse/${i.key}|${i.key}> ${i.summary.substring(0, 50)}`
    ).join('\n');
    blocks.push({ type: 'section', text: { type: 'mrkdwn',
      text: `*${r.projectKey}* — ${r.numerator} kickback${r.numerator !== 1 ? 's' : ''} · R1: ${r.ratio}% · R2: ${r.ratio2 || 0}%\n${lines}` }});
  }

  blocks.push({ type: 'context', elements: [{ type: 'mrkdwn',
    text: `QA Kickback Ratio · ${new Date().toLocaleString()} · Jira Data Center` }]});

  await axios.post(webhookUrl, {
    text: `${hEmoji} QA Kickback Ratio — ${fromDate} → ${toDate} — R1: ${totalRatio}% · R2: ${totalRatio2}%`,
    blocks,
  }, { headers: { 'Content-Type': 'application/json' }});
}

module.exports = { sendQAKickbackSlack };
