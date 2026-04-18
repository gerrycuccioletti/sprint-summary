// src/reporters/release-html.js
const fs   = require('fs');
const path = require('path');

const HEALTH_STYLE = {
  Green:  { bg: '#d1fae5', text: '#065f46', dot: '#10b981' },
  Yellow: { bg: '#fef9c3', text: '#854d0e', dot: '#eab308' },
  Red:    { bg: '#fee2e2', text: '#991b1b', dot: '#ef4444' },
};
const FEASIBILITY_STYLE = {
  'On track':          { bg: '#d1fae5', text: '#065f46' },
  'At risk':           { bg: '#fef9c3', text: '#854d0e' },
  'Likely delayed':    { bg: '#fee2e2', text: '#991b1b' },
  'Should be descoped':{ bg: '#fce7f3', text: '#9d174d' },
};
const RISK_BADGE = {
  High:   'background:#fee2e2;color:#991b1b',
  Medium: 'background:#fef9c3;color:#854d0e',
  Low:    'background:#dbeafe;color:#1e40af',
};

function badge(style, text) {
  return `<span style="${style};padding:2px 10px;border-radius:99px;font-size:11px;font-weight:700">${text}</span>`;
}

function readinessBar(pct) {
  const color = pct >= 80 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#ef4444';
  return `<div style="margin:4px 0">
    <div style="background:#f1f5f9;border-radius:99px;height:8px;overflow:hidden">
      <div style="background:${color};width:${pct}%;height:100%;border-radius:99px;transition:width .4s"></div>
    </div>
    <span style="font-size:12px;color:#64748b;margin-top:2px;display:inline-block">${pct}% ready</span>
  </div>`;
}

function generateReleaseHtmlReport(analysis, version, projectKey, outputDir = './output') {
  const h  = HEALTH_STYLE[analysis.overallHealth] || HEALTH_STYLE.Yellow;
  const fs2 = FEASIBILITY_STYLE[analysis.releaseFeasibility] || { bg: '#f1f5f9', text: '#475569' };
  const now = new Date().toLocaleString();

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Release Health — ${analysis.releaseName}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8fafc;color:#1e293b;font-size:15px;line-height:1.6}
  .container{max-width:860px;margin:40px auto;padding:0 24px 64px}
  h1{font-size:26px;font-weight:700;color:#0f172a}
  .meta{color:#64748b;font-size:13px;margin-top:4px}
  .pill{display:inline-flex;align-items:center;gap:6px;padding:5px 14px;border-radius:99px;font-size:13px;font-weight:700;margin:4px 4px 4px 0}
  .dot{width:8px;height:8px;border-radius:50%}
  .summary-box{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px 24px;margin:20px 0;color:#334155}
  .stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;margin:20px 0}
  .stat-card{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px 18px}
  .stat-label{font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.06em}
  .stat-value{font-size:26px;font-weight:700;color:#0f172a;margin-top:2px}
  section{margin:28px 0}
  section h2{font-size:15px;font-weight:700;margin-bottom:10px;color:#0f172a}
  .issue-card{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px 18px;margin-bottom:8px}
  .issue-key{font-size:12px;font-weight:700;color:#3b82f6;font-family:monospace}
  .issue-title{font-weight:600;margin:3px 0;color:#1e293b}
  .issue-sub{font-size:13px;color:#64748b}
  .issue-action{font-size:13px;color:#475569;border-top:1px solid #f1f5f9;padding-top:8px;margin-top:8px}
  .rec-list{list-style:none}
  .rec-list li{background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:10px 14px;margin-bottom:8px;color:#334155;font-size:14px}
  .rec-list li::before{content:"→ ";color:#3b82f6;font-weight:700}
  footer{text-align:center;font-size:12px;color:#94a3b8;margin-top:48px}
</style>
</head>
<body>
<div class="container">
  <h1>${analysis.releaseName}</h1>
  <div class="meta">
    Project: ${projectKey}
    ${version.releaseDate ? ' · Target release: ' + version.releaseDate : ''}
    · Generated ${now}
  </div>

  <div style="margin:14px 0">
    <span class="pill" style="background:${h.bg};color:${h.text}">
      <span class="dot" style="background:${h.dot}"></span>
      ${analysis.overallHealth}
    </span>
    <span class="pill" style="background:${fs2.bg};color:${fs2.text}">
      ${analysis.releaseFeasibility || 'Unknown'}
    </span>
  </div>

  <div style="max-width:280px">${readinessBar(analysis.readiness || 0)}</div>
  <p style="font-size:13px;color:#64748b;margin-top:6px">${analysis.healthReason}</p>

  <div class="summary-box">${analysis.summary}</div>

  <div class="stats-grid">
    <div class="stat-card"><div class="stat-label">Total</div><div class="stat-value">${analysis.stats.total}</div></div>
    <div class="stat-card"><div class="stat-label">Done</div><div class="stat-value" style="color:#10b981">${analysis.stats.done}</div></div>
    <div class="stat-card"><div class="stat-label">In progress</div><div class="stat-value" style="color:#f59e0b">${analysis.stats.inProgress}</div></div>
    <div class="stat-card"><div class="stat-label">Not started</div><div class="stat-value" style="color:${analysis.stats.notStarted > 0 ? '#ef4444' : '#10b981'}">${analysis.stats.notStarted}</div></div>
    <div class="stat-card"><div class="stat-label">Unassigned</div><div class="stat-value" style="color:${analysis.stats.unassigned > 0 ? '#ef4444' : '#10b981'}">${analysis.stats.unassigned}</div></div>
  </div>

  ${analysis.blockers?.length ? `
  <section>
    <h2>🚧 Blockers</h2>
    ${analysis.blockers.map(b => `
    <div class="issue-card">
      <div class="issue-key">${b.issueKey}</div>
      <div class="issue-title">${b.title}</div>
      <div class="issue-action">💡 ${b.suggestedAction}</div>
    </div>`).join('')}
  </section>` : ''}

  ${analysis.criticalUnfinished?.length ? `
  <section>
    <h2>⛔ Critical unfinished</h2>
    ${analysis.criticalUnfinished.map(i => `
    <div class="issue-card">
      <div style="display:flex;gap:8px;align-items:center">
        ${badge(RISK_BADGE[i.priority] || 'background:#f1f5f9;color:#475569', i.priority)}
        <span class="issue-key">${i.issueKey}</span>
      </div>
      <div class="issue-title">${i.title}</div>
      <div class="issue-sub">Status: ${i.status} · ${i.assignee}</div>
    </div>`).join('')}
  </section>` : ''}

  ${analysis.risks?.length ? `
  <section>
    <h2>⚠️ Risks</h2>
    ${analysis.risks.map(r => `
    <div class="issue-card">
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">
        ${badge(RISK_BADGE[r.level] || '', r.level)}
        <span class="issue-key">${r.issueKey}</span>
      </div>
      <div class="issue-title">${r.title}</div>
      <div class="issue-sub">${r.reason}</div>
    </div>`).join('')}
  </section>` : ''}

  ${analysis.recommendations?.length ? `
  <section>
    <h2>💡 Recommendations</h2>
    <ul class="rec-list">
      ${analysis.recommendations.map(r => `<li>${r}</li>`).join('')}
    </ul>
  </section>` : ''}

  <footer>Release Health Report · ${projectKey} · Jira Data Center + Claude AI</footer>
</div>
</body>
</html>`;

  fs.mkdirSync(outputDir, { recursive: true });
  const filename = `release-${projectKey}-${version.name.replace(/[^a-zA-Z0-9.]/g, '-')}-${Date.now()}.html`;
  const filePath = path.join(outputDir, filename);
  fs.writeFileSync(filePath, html, 'utf8');
  return filePath;
}

module.exports = { generateReleaseHtmlReport };
