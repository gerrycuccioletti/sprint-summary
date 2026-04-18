// src/reporters/html.js
// Generates a standalone HTML report from the sprint analysis
const fs = require('fs');
const path = require('path');

const HEALTH_STYLE = {
  Green:  { bg: '#d1fae5', text: '#065f46', dot: '#10b981' },
  Yellow: { bg: '#fef9c3', text: '#854d0e', dot: '#eab308' },
  Red:    { bg: '#fee2e2', text: '#991b1b', dot: '#ef4444' },
};

const RISK_BADGE = {
  High:   'background:#fee2e2;color:#991b1b',
  Medium: 'background:#fef9c3;color:#854d0e',
  Low:    'background:#dbeafe;color:#1e40af',
};

function badge(level, text) {
  const style = RISK_BADGE[level] || 'background:#f3f4f6;color:#374151';
  return `<span style="${style};padding:2px 10px;border-radius:99px;font-size:11px;font-weight:700;letter-spacing:.05em">${text || level}</span>`;
}

function generateHtmlReport(analysis, sprint, outputDir = './output') {
  const h = HEALTH_STYLE[analysis.overallHealth] || HEALTH_STYLE.Yellow;
  const now = new Date().toLocaleString();

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sprint Report — ${analysis.sprintName}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f8fafc; color: #1e293b; font-size: 15px; line-height: 1.6; }
  .container { max-width: 860px; margin: 40px auto; padding: 0 24px 64px; }
  header { margin-bottom: 32px; }
  h1 { font-size: 26px; font-weight: 700; color: #0f172a; }
  .meta { color: #64748b; font-size: 13px; margin-top: 4px; }
  .health-badge { display: inline-flex; align-items: center; gap: 8px; padding: 6px 16px; border-radius: 99px; font-weight: 700; font-size: 14px; margin: 12px 0; background: ${h.bg}; color: ${h.text}; }
  .health-dot { width: 10px; height: 10px; border-radius: 50%; background: ${h.dot}; }
  .health-reason { color: #475569; font-size: 14px; }
  .summary-box { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px 24px; margin: 24px 0; }
  .summary-box p { color: #334155; }
  .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin: 24px 0; }
  .stat-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 16px 20px; }
  .stat-label { font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: .06em; }
  .stat-value { font-size: 28px; font-weight: 700; color: #0f172a; margin-top: 4px; }
  section { margin: 32px 0; }
  section h2 { font-size: 16px; font-weight: 700; color: #0f172a; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
  .issue-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 18px; margin-bottom: 10px; }
  .issue-key { font-size: 12px; font-weight: 700; color: #3b82f6; font-family: monospace; }
  .issue-title { font-weight: 600; margin: 4px 0; color: #1e293b; }
  .issue-meta { font-size: 13px; color: #64748b; }
  .issue-action { margin-top: 8px; font-size: 13px; color: #475569; border-top: 1px solid #f1f5f9; padding-top: 8px; }
  .rec-list { list-style: none; }
  .rec-list li { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 16px; margin-bottom: 8px; color: #334155; }
  .rec-list li::before { content: "→ "; color: #3b82f6; font-weight: 700; }
  .warn-list { list-style: none; }
  .warn-list li { background: #fefce8; border: 1px solid #fde047; border-radius: 8px; padding: 10px 14px; margin-bottom: 8px; color: #713f12; font-size: 14px; }
  footer { text-align: center; font-size: 12px; color: #94a3b8; margin-top: 48px; }
</style>
</head>
<body>
<div class="container">
  <header>
    <h1>${analysis.sprintName}</h1>
    <div class="meta">Generated on ${now} · ${sprint.startDate || '?'} → ${sprint.endDate || '?'}</div>
    <div class="health-badge">
      <span class="health-dot"></span>
      ${analysis.overallHealth}
    </div>
    <div class="health-reason">${analysis.healthReason}</div>
  </header>

  <div class="summary-box">
    <p>${analysis.summary}</p>
  </div>

  <!-- Stats -->
  <div class="stats-grid">
    <div class="stat-card">
      <div class="stat-label">Total Issues</div>
      <div class="stat-value">${analysis.stats.total}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Unassigned</div>
      <div class="stat-value" style="color:${analysis.stats.unassigned > 0 ? '#ef4444' : '#10b981'}">${analysis.stats.unassigned}</div>
    </div>
    ${Object.entries(analysis.stats.byStatus || {}).map(([status, count]) => `
    <div class="stat-card">
      <div class="stat-label">${status}</div>
      <div class="stat-value">${count}</div>
    </div>`).join('')}
  </div>

  <!-- Blockers -->
  ${analysis.blockers?.length > 0 ? `
  <section>
    <h2>🚧 Blockers</h2>
    ${analysis.blockers.map(b => `
    <div class="issue-card">
      <div class="issue-key">${b.issueKey}</div>
      <div class="issue-title">${b.title}</div>
      ${b.blockedSince ? `<div class="issue-meta">Blocked since: ${b.blockedSince}</div>` : ''}
      <div class="issue-action">💡 ${b.suggestedAction}</div>
    </div>`).join('')}
  </section>` : ''}

  <!-- Risks -->
  ${analysis.risks?.length > 0 ? `
  <section>
    <h2>⚠️ Risks</h2>
    ${analysis.risks.map(r => `
    <div class="issue-card">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        ${badge(r.level)}
        <span class="issue-key">${r.issueKey}</span>
      </div>
      <div class="issue-title">${r.title}</div>
      <div class="issue-meta" style="margin-top:4px">${r.reason}</div>
    </div>`).join('')}
  </section>` : ''}

  <!-- Workload warnings -->
  ${analysis.workloadWarnings?.length > 0 ? `
  <section>
    <h2>👥 Workload</h2>
    <ul class="warn-list">
      ${analysis.workloadWarnings.map(w => `<li>${w}</li>`).join('')}
    </ul>
  </section>` : ''}

  <!-- Recommendations -->
  ${analysis.recommendations?.length > 0 ? `
  <section>
    <h2>💡 Recommendations</h2>
    <ul class="rec-list">
      ${analysis.recommendations.map(r => `<li>${r}</li>`).join('')}
    </ul>
  </section>` : ''}

  <footer>Generated by Sprint Summary · Jira Data Center + Claude AI</footer>
</div>
</body>
</html>`;

  fs.mkdirSync(outputDir, { recursive: true });
  const filename = `sprint-report-${Date.now()}.html`;
  const filePath = path.join(outputDir, filename);
  fs.writeFileSync(filePath, html, 'utf8');
  return filePath;
}

module.exports = { generateHtmlReport };
