// src/reporters/release-set-html.js
const fs   = require('fs');
const path = require('path');

const HEALTH_STYLE = {
  Green:  { bg: '#d1fae5', text: '#065f46', dot: '#10b981' },
  Yellow: { bg: '#fef9c3', text: '#854d0e', dot: '#eab308' },
  Red:    { bg: '#fee2e2', text: '#991b1b', dot: '#ef4444' },
};
const FEASIBILITY_STYLE = {
  'On track':           { bg: '#d1fae5', text: '#065f46' },
  'At risk':            { bg: '#fef9c3', text: '#854d0e' },
  'Likely delayed':     { bg: '#fee2e2', text: '#991b1b' },
  'Should be descoped': { bg: '#fce7f3', text: '#9d174d' },
};
const RISK_BADGE = {
  High:   'background:#fee2e2;color:#991b1b',
  Medium: 'background:#fef9c3;color:#854d0e',
  Low:    'background:#dbeafe;color:#1e40af',
};

const pill = (bg, text, label) =>
  `<span style="background:${bg};color:${text};padding:2px 10px;border-radius:99px;font-size:11px;font-weight:700">${label}</span>`;

const badge = (style, label) =>
  `<span style="${style};padding:1px 8px;border-radius:99px;font-size:11px;font-weight:700">${label}</span>`;

function readinessBar(pct, height = 8) {
  const color = pct >= 80 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#ef4444';
  return `<div style="background:#f1f5f9;border-radius:99px;height:${height}px;overflow:hidden;min-width:80px">
    <div style="background:${color};width:${pct}%;height:100%;border-radius:99px"></div>
  </div>
  <span style="font-size:11px;color:#64748b">${pct}%</span>`;
}

function issueCards(items, type = 'blocker') {
  if (!items?.length) return '';
  return items.map(i => {
    if (type === 'blocker') return `
      <div style="border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;margin-bottom:8px">
        <span style="font-family:monospace;font-size:12px;font-weight:700;color:#3b82f6">${i.issueKey}</span>
        <div style="font-weight:600;margin:3px 0;color:#1e293b;font-size:14px">${i.title}</div>
        <div style="font-size:13px;color:#475569;border-top:1px solid #f1f5f9;padding-top:6px;margin-top:6px">
          ${i.impact ? `<strong>Impact:</strong> ${i.impact}<br>` : ''}
          💡 ${i.suggestedAction}
        </div>
      </div>`;
    if (type === 'risk') return `
      <div style="border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;margin-bottom:8px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
          ${badge(RISK_BADGE[i.level] || '', i.level)}
          <span style="font-family:monospace;font-size:12px;font-weight:700;color:#3b82f6">${i.issueKey}</span>
        </div>
        <div style="font-weight:600;color:#1e293b;font-size:14px">${i.title}</div>
        <div style="font-size:13px;color:#64748b;margin-top:3px">${i.reason}</div>
      </div>`;
    if (type === 'critical') return `
      <div style="border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;margin-bottom:8px">
        ${badge(RISK_BADGE[i.priority] || 'background:#f1f5f9;color:#475569', i.priority)}
        <span style="font-family:monospace;font-size:12px;font-weight:700;color:#3b82f6;margin-left:6px">${i.issueKey}</span>
        <div style="font-weight:600;color:#1e293b;font-size:14px;margin:3px 0">${i.title}</div>
        <div style="font-size:12px;color:#64748b">Status: ${i.status} · ${i.assignee}</div>
      </div>`;
    return '';
  }).join('');
}

function projectSection(p) {
  const h  = HEALTH_STYLE[p.health] || HEALTH_STYLE.Yellow;
  return `
  <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px 24px;margin-bottom:16px">
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:12px">
      <div>
        <span style="font-size:16px;font-weight:700;color:#0f172a">${p.projectKey}</span>
        ${p.projectName && p.projectName !== p.projectKey ? `<span style="color:#64748b;font-size:13px;margin-left:6px">${p.projectName}</span>` : ''}
      </div>
      <span style="background:${h.bg};color:${h.text};padding:3px 10px;border-radius:99px;font-size:12px;font-weight:700;display:inline-flex;align-items:center;gap:5px">
        <span style="width:7px;height:7px;border-radius:50%;background:${h.dot};display:inline-block"></span>${p.health}
      </span>
    </div>
    <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:14px">
      <div style="min-width:160px">${readinessBar(p.readiness || 0)}</div>
      <span style="font-size:13px;color:#64748b">✅ ${p.done}/${p.total} done · 🔄 ${p.inProgress} in progress · ⏳ ${p.notStarted} not started</span>
    </div>
    ${p.blockers?.length ? `<div style="margin-bottom:10px"><div style="font-size:13px;font-weight:600;margin-bottom:6px;color:#0f172a">🚧 Blockers</div>${issueCards(p.blockers,'blocker')}</div>` : ''}
    ${p.criticalUnfinished?.length ? `<div style="margin-bottom:10px"><div style="font-size:13px;font-weight:600;margin-bottom:6px;color:#0f172a">⛔ Critical unfinished</div>${issueCards(p.criticalUnfinished,'critical')}</div>` : ''}
    ${p.risks?.length ? `<div><div style="font-size:13px;font-weight:600;margin-bottom:6px;color:#0f172a">⚠️ Risks</div>${issueCards(p.risks,'risk')}</div>` : ''}
  </div>`;
}

function teamSection(t) {
  const h = HEALTH_STYLE[t.health] || HEALTH_STYLE.Yellow;
  return `
  <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px 24px;margin-bottom:16px">
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:12px">
      <span style="font-size:16px;font-weight:700;color:#0f172a">${t.team}</span>
      <span style="background:${h.bg};color:${h.text};padding:3px 10px;border-radius:99px;font-size:12px;font-weight:700;display:inline-flex;align-items:center;gap:5px">
        <span style="width:7px;height:7px;border-radius:50%;background:${h.dot};display:inline-block"></span>${t.health}
      </span>
    </div>
    <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:10px">
      <div style="min-width:160px">${readinessBar(t.readiness || 0)}</div>
      <span style="font-size:13px;color:#64748b">✅ ${t.done}/${t.total} done · 🔄 ${t.inProgress} in progress · ⏳ ${t.notStarted} not started</span>
    </div>
    ${t.projects?.length ? `<div style="font-size:12px;color:#64748b;margin-bottom:10px">Projects: ${t.projects.join(', ')}</div>` : ''}
    ${t.blockers?.length ? `<div><div style="font-size:13px;font-weight:600;margin-bottom:6px;color:#0f172a">🚧 Blockers</div>${issueCards(t.blockers,'blocker')}</div>` : ''}
    ${t.risks?.length ? `<div style="margin-top:10px"><div style="font-size:13px;font-weight:600;margin-bottom:6px;color:#0f172a">⚠️ Risks</div>${issueCards(t.risks,'risk')}</div>` : ''}
  </div>`;
}

function generateReleaseSetHtml(analysis, setName, outputDir = './output') {
  const h   = HEALTH_STYLE[analysis.overallHealth] || HEALTH_STYLE.Yellow;
  const fs2 = FEASIBILITY_STYLE[analysis.releaseFeasibility] || { bg: '#f1f5f9', text: '#475569' };
  const now = new Date().toLocaleString();
  const s   = analysis.stats;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Release Set — ${analysis.setName}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8fafc;color:#1e293b;font-size:15px;line-height:1.6}
  .container{max-width:960px;margin:0 auto;padding:40px 24px 64px}
  .tabs{display:flex;gap:0;border-bottom:2px solid #e2e8f0;margin:24px 0}
  .tab{padding:10px 20px;font-size:14px;font-weight:500;color:#64748b;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-2px}
  .tab.active{color:#0f172a;border-bottom-color:#0f172a}
  .panel{display:none}.panel.active{display:block}
  .stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:12px;margin:20px 0}
  .stat-card{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px 18px}
  .stat-label{font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.06em}
  .stat-value{font-size:24px;font-weight:700;color:#0f172a;margin-top:2px}
  .summary-box{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px 24px;margin:20px 0;color:#334155;font-size:14px;line-height:1.7}
  .rec-list{list-style:none;margin-top:8px}
  .rec-list li{background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:10px 14px;margin-bottom:8px;font-size:14px;color:#334155}
  .rec-list li::before{content:"→ ";color:#3b82f6;font-weight:700}
  footer{text-align:center;font-size:12px;color:#94a3b8;margin-top:48px}
</style>
</head>
<body>
<div class="container">
  <h1 style="font-size:26px;font-weight:700;color:#0f172a">${analysis.setName}</h1>
  <div style="color:#64748b;font-size:13px;margin-top:4px">Fix versions: ${(analysis.versionNames||[]).join(', ')} · Generated ${now}</div>

  <div style="margin:14px 0;display:flex;flex-wrap:wrap;gap:6px;align-items:center">
    <span style="background:${h.bg};color:${h.text};padding:5px 14px;border-radius:99px;font-size:13px;font-weight:700;display:inline-flex;align-items:center;gap:6px">
      <span style="width:8px;height:8px;border-radius:50%;background:${h.dot}"></span>${analysis.overallHealth}
    </span>
    <span style="background:${fs2.bg};color:${fs2.text};padding:5px 14px;border-radius:99px;font-size:13px;font-weight:700">${analysis.releaseFeasibility||'—'}</span>
  </div>

  <div style="max-width:300px;margin-bottom:8px">${readinessBar(analysis.readiness||0, 10)}</div>
  <div style="font-size:13px;color:#64748b;margin-bottom:16px">${analysis.healthReason}</div>

  <div class="stats-grid">
    <div class="stat-card"><div class="stat-label">Total</div><div class="stat-value">${s.total}</div></div>
    <div class="stat-card"><div class="stat-label">Done</div><div class="stat-value" style="color:#10b981">${s.done}</div></div>
    <div class="stat-card"><div class="stat-label">In progress</div><div class="stat-value" style="color:#f59e0b">${s.inProgress}</div></div>
    <div class="stat-card"><div class="stat-label">Not started</div><div class="stat-value" style="color:${s.notStarted>0?'#ef4444':'#10b981'}">${s.notStarted}</div></div>
    <div class="stat-card"><div class="stat-label">Projects</div><div class="stat-value">${s.projectCount}</div></div>
    <div class="stat-card"><div class="stat-label">Teams</div><div class="stat-value">${s.teamCount}</div></div>
  </div>

  <div class="summary-box">${analysis.summary}</div>

  <div class="tabs">
    <div class="tab active" onclick="show('overview',this)">Overview</div>
    <div class="tab" onclick="show('versions',this)">By version</div>
    <div class="tab" onclick="show('projects',this)">By project</div>
    <div class="tab" onclick="show('teams',this)">By team</div>
    ${(analysis.tickets?.length) ? `<div class="tab" onclick="show('tickets',this)">Tickets (${analysis.tickets.length})</div>` : ''}
  </div>

  <!-- Overview -->
  <div class="panel active" id="panel-overview">
    ${analysis.crossProjectBlockers?.length ? `
    <h2 style="font-size:15px;font-weight:700;margin-bottom:12px;color:#0f172a">🚧 Cross-project blockers</h2>
    ${issueCards(analysis.crossProjectBlockers,'blocker')}` : ''}
    ${analysis.recommendations?.length ? `
    <h2 style="font-size:15px;font-weight:700;margin:24px 0 12px;color:#0f172a">💡 Recommendations</h2>
    <ul class="rec-list">${analysis.recommendations.map(r=>`<li>${r}</li>`).join('')}</ul>` : ''}
  </div>

  <!-- By version -->
  <div class="panel" id="panel-versions">
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead>
        <tr style="border-bottom:2px solid #e2e8f0">
          <th style="text-align:left;padding:8px 12px;color:#64748b;font-weight:500">Fix version</th>
          <th style="text-align:left;padding:8px 12px;color:#64748b;font-weight:500">Readiness</th>
          <th style="text-align:right;padding:8px 12px;color:#64748b;font-weight:500">Done</th>
          <th style="text-align:right;padding:8px 12px;color:#64748b;font-weight:500">In progress</th>
          <th style="text-align:right;padding:8px 12px;color:#64748b;font-weight:500">Not started</th>
          <th style="text-align:right;padding:8px 12px;color:#64748b;font-weight:500">Total</th>
          <th style="text-align:left;padding:8px 12px;color:#64748b;font-weight:500">Projects</th>
        </tr>
      </thead>
      <tbody>
        ${(analysis.byVersion || []).map(v => {
          const pct   = v.readiness || 0;
          const color = pct >= 80 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#ef4444';
          return `<tr style="border-bottom:1px solid #f1f5f9">
            <td style="padding:10px 12px;font-weight:600;color:#0f172a">${v.version}</td>
            <td style="padding:10px 12px;min-width:160px">
              <div style="display:flex;align-items:center;gap:8px">
                <div style="flex:1;background:#f1f5f9;border-radius:99px;height:6px;overflow:hidden">
                  <div style="background:${color};width:${pct}%;height:100%;border-radius:99px"></div>
                </div>
                <span style="font-size:12px;color:#64748b;white-space:nowrap">${pct}%</span>
              </div>
            </td>
            <td style="padding:10px 12px;text-align:right;color:#10b981;font-weight:600">${v.done}</td>
            <td style="padding:10px 12px;text-align:right;color:#f59e0b">${v.inProgress}</td>
            <td style="padding:10px 12px;text-align:right;color:${v.notStarted > 0 ? '#ef4444' : '#64748b'}">${v.notStarted}</td>
            <td style="padding:10px 12px;text-align:right;font-weight:600;color:#0f172a">${v.total}</td>
            <td style="padding:10px 12px;color:#64748b;font-size:12px">${(v.projects || []).join(', ')}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  </div>

  <!-- By project -->
  <div class="panel" id="panel-projects">
    ${(analysis.byProject||[]).map(projectSection).join('')}
  </div>

  <!-- By team -->
  <div class="panel" id="panel-teams">
    ${(analysis.byTeam||[]).map(teamSection).join('')}
  </div>

  <!-- Tickets -->
  ${(analysis.tickets?.length) ? `
  <div class="panel" id="panel-tickets">
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead>
        <tr style="border-bottom:2px solid #e2e8f0">
          <th style="text-align:left;padding:8px 12px;color:#64748b;font-weight:500">Key</th>
          <th style="text-align:left;padding:8px 12px;color:#64748b;font-weight:500">Summary</th>
          <th style="text-align:left;padding:8px 12px;color:#64748b;font-weight:500">Project</th>
          <th style="text-align:left;padding:8px 12px;color:#64748b;font-weight:500">Status</th>
          <th style="text-align:left;padding:8px 12px;color:#64748b;font-weight:500">Priority</th>
          <th style="text-align:left;padding:8px 12px;color:#64748b;font-weight:500">Assignee</th>
          <th style="text-align:left;padding:8px 12px;color:#64748b;font-weight:500">Team</th>
          <th style="text-align:left;padding:8px 12px;color:#64748b;font-weight:500">Fix versions</th>
        </tr>
      </thead>
      <tbody>
        ${(analysis.tickets||[]).map(t => {
          const catColor = t.statusCategory === 'done'
            ? '#10b981' : t.statusCategory === 'indeterminate'
            ? '#f59e0b' : '#64748b';
          const priBg = { Highest:'#fee2e2', High:'#fee2e2', Critical:'#fee2e2',
            Blocker:'#fee2e2', Medium:'#fef9c3', Low:'#dbeafe', Lowest:'#f1f5f9' }[t.priority] || '#f1f5f9';
          const priColor = { Highest:'#991b1b', High:'#991b1b', Critical:'#991b1b',
            Blocker:'#991b1b', Medium:'#854d0e', Low:'#1e40af', Lowest:'#475569' }[t.priority] || '#475569';
          return `<tr style="border-bottom:1px solid #f1f5f9">
            <td style="padding:8px 12px;font-family:monospace;font-size:12px;font-weight:700;color:#3b82f6;white-space:nowrap">${t.key}</td>
            <td style="padding:8px 12px;color:#1e293b;max-width:280px">${t.summary}</td>
            <td style="padding:8px 12px;color:#64748b;font-size:12px">${t.projectKey}</td>
            <td style="padding:8px 12px;white-space:nowrap">
              <span style="display:inline-flex;align-items:center;gap:4px">
                <span style="width:6px;height:6px;border-radius:50%;background:${catColor};display:inline-block"></span>
                <span style="font-size:12px;color:#334155">${t.status}</span>
              </span>
            </td>
            <td style="padding:8px 12px">
              <span style="background:${priBg};color:${priColor};padding:1px 8px;border-radius:99px;font-size:11px;font-weight:600">${t.priority}</span>
            </td>
            <td style="padding:8px 12px;color:#64748b;font-size:12px;white-space:nowrap">${t.assignee}</td>
            <td style="padding:8px 12px;color:#64748b;font-size:12px">${t.team}</td>
            <td style="padding:8px 12px;color:#64748b;font-size:12px">${(t.fixVersions||[]).join(', ')}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  </div>` : ''}

  <footer>Release Set Report · Jira Data Center + Claude AI</footer>
</div>
<script>
function show(id, tab) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById('panel-' + id).classList.add('active');
  tab.classList.add('active');
}
</script>
</body>
</html>`;

  fs.mkdirSync(outputDir, { recursive: true });
  const filename = `release-set-${setName}-${Date.now()}.html`;
  const filePath = path.join(outputDir, filename);
  fs.writeFileSync(filePath, html, 'utf8');
  return filePath;
}

module.exports = { generateReleaseSetHtml };
