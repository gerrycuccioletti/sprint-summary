// src/reporters/sprint-analytics-html.js
const fs   = require('fs');
const path = require('path');

const HEALTH_STYLE = {
  Green:  { bg: '#d1fae5', text: '#065f46', dot: '#10b981' },
  Yellow: { bg: '#fef9c3', text: '#854d0e', dot: '#eab308' },
  Red:    { bg: '#fee2e2', text: '#991b1b', dot: '#ef4444' },
};

function readinessBar(pct, height = 8) {
  const color = pct >= 80 ? '#10b981' : pct >= 60 ? '#f59e0b' : '#ef4444';
  return `<div style="background:#f1f5f9;border-radius:99px;height:${height}px;overflow:hidden;flex:1">
    <div style="background:${color};width:${pct}%;height:100%;border-radius:99px"></div>
  </div>
  <span style="font-size:12px;color:#64748b;white-space:nowrap;min-width:36px">${pct}%</span>`;
}

function generateSprintAnalyticsHtml(analysis, boardId, outputDir = './output') {
  const sprint = analysis.sprintReport;
  const comp   = analysis.completion;
  const h      = HEALTH_STYLE[analysis.sprintHealth] || HEALTH_STYLE.Yellow;
  const now    = new Date().toLocaleString();
  const vs     = analysis.velocityStats;
  const pv     = analysis.platformVelocity || [];

  // Velocity chart data
  const velSprints  = (vs?.sprints || []).slice(-6);
  const velLabels   = JSON.stringify(velSprints.map(s => s.sprintName));
  const velCommitted = JSON.stringify(velSprints.map(s => s.committed));
  const velCompleted = JSON.stringify(velSprints.map(s => s.completed));

  // Platform breakdown per sprint: { sprintName → { platform → pts } }
  const platBySprint = {};
  velSprints.forEach(s => {
    platBySprint[s.sprintName] = {};
    pv.forEach(p => {
      const pts = p.bySprint[String(s.sprintId)];
      if (pts != null) platBySprint[s.sprintName][p.platform] = pts;
    });
  });
  const platBySprintJson = JSON.stringify(platBySprint);

  // Platform velocity chart data
  const platLabels = JSON.stringify(pv.map(p => p.platform));
  const platAvgs   = JSON.stringify(pv.map(p => p.avg));

  // Completion gauge data
  const issuesPct = comp.pct;
  const ptsPct    = comp.ptsPct;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sprint Analytics — ${sprint.sprintName}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8fafc;color:#1e293b;font-size:15px;line-height:1.6}
  .container{max-width:980px;margin:40px auto;padding:0 24px 64px}
  h1{font-size:26px;font-weight:700;color:#0f172a}
  .meta{color:#64748b;font-size:13px;margin-top:4px}
  .health-pill{display:inline-flex;align-items:center;gap:6px;padding:5px 14px;border-radius:99px;font-size:13px;font-weight:700;margin:10px 0}
  .dot{width:8px;height:8px;border-radius:50%}
  .card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px 24px;margin-bottom:16px}
  .card h2{font-size:15px;font-weight:700;color:#0f172a;margin-bottom:14px}
  .stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;margin-bottom:16px}
  .stat{background:#f8fafc;border-radius:8px;padding:12px 16px}
  .stat-label{font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.06em}
  .stat-value{font-size:22px;font-weight:700;color:#0f172a;margin-top:2px}
  .bar-row{display:flex;align-items:center;gap:10px;margin:6px 0}
  .bar-label{font-size:13px;color:#64748b;min-width:60px}
  .issue-table{width:100%;border-collapse:collapse;font-size:13px}
  .issue-table th{text-align:left;padding:8px 12px;color:#64748b;border-bottom:1px solid #e2e8f0;font-weight:500}
  .issue-table td{padding:8px 12px;border-bottom:1px solid #f1f5f9;color:#334155}
  .issue-table tr:last-child td{border-bottom:none}
  .issue-table tr:hover td{background:#f8fafc}
  .key{font-family:monospace;font-size:12px;font-weight:700;color:#3b82f6}
  .pill{display:inline-block;padding:1px 8px;border-radius:99px;font-size:11px;font-weight:600}
  .risk-High{background:#fee2e2;color:#991b1b}
  .risk-Medium{background:#fef9c3;color:#854d0e}
  .risk-Low{background:#dbeafe;color:#1e40af}
  .rec-list{list-style:none}
  .rec-list li{padding:8px 12px;background:#f8fafc;border-radius:6px;margin-bottom:6px;font-size:14px;color:#334155}
  .rec-list li::before{content:"→ ";color:#3b82f6;font-weight:700}
  footer{text-align:center;font-size:12px;color:#94a3b8;margin-top:48px}
  .tabs{display:flex;gap:0;border-bottom:2px solid #e2e8f0;margin:20px 0}
  .tab{padding:10px 18px;font-size:14px;font-weight:500;color:#64748b;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-2px}
  .tab.active{color:#0f172a;border-bottom-color:#0f172a}
  .panel{display:none}.panel.active{display:block}
  .charts-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px}
  .legend{display:flex;flex-wrap:wrap;gap:14px;margin-bottom:12px;font-size:12px;color:#64748b}
  .legend span{display:flex;align-items:center;gap:5px}
  .legend b{width:10px;height:10px;border-radius:2px;display:inline-block}
  .gauge-wrap{display:grid;grid-template-columns:1fr 1fr;gap:16px}
</style>
</head>
<body>
<div class="container">
  <h1>Sprint Analytics</h1>
  <div class="meta">${analysis.displayName || 'Board ' + boardId} · ${sprint.sprintName} · ID: ${sprint.sprintId} · ${sprint.startDate} → ${sprint.endDate} · Generated ${now}</div>
  ${sprint.sprintGoal ? `<div style="margin-top:8px;font-size:13px;color:#475569;font-style:italic">Goal: ${sprint.sprintGoal}</div>` : ''}

  <span class="health-pill" style="background:${h.bg};color:${h.text}">
    <span class="dot" style="background:${h.dot}"></span>${analysis.sprintHealth}
  </span>
  <p style="font-size:13px;color:#64748b;margin-bottom:20px">${analysis.healthReason}</p>

  <div class="card">
    <h2>Summary</h2>
    <p style="color:#334155;line-height:1.7">${analysis.summary}</p>
  </div>

  <div class="stats-grid">
    <div class="stat"><div class="stat-label">Issues done</div><div class="stat-value">${comp.completed}/${comp.total}</div></div>
    <div class="stat"><div class="stat-label">Completion</div><div class="stat-value">${comp.pct}%</div></div>
    <div class="stat"><div class="stat-label">Points done</div><div class="stat-value">${sprint.completedPoints}</div></div>
    <div class="stat"><div class="stat-label">Points total</div><div class="stat-value">${sprint.completedPoints + sprint.incompletedPoints}</div></div>
    <div class="stat"><div class="stat-label">Velocity avg</div><div class="stat-value">${vs?.avg || '—'}</div></div>
    <div class="stat"><div class="stat-label">Predicted</div><div class="stat-value">${analysis.predictedVelocity || '—'}</div></div>
    <div class="stat"><div class="stat-label">Incomplete</div><div class="stat-value" style="color:${sprint.incompletedIssues.length > 0 ? '#ef4444' : '#10b981'}">${sprint.incompletedIssues.length}</div></div>
    <div class="stat"><div class="stat-label">Removed</div><div class="stat-value">${sprint.removedIssues.length}</div></div>
  </div>

  <!-- Completion gauges -->
  <div class="card">
    <h2>Completion</h2>
    <div class="bar-row"><span class="bar-label">Issues</span>${readinessBar(comp.pct)}</div>
    <div class="bar-row" style="margin-top:8px"><span class="bar-label">Points</span>${readinessBar(comp.ptsPct)}</div>
    ${analysis.completionAssessment ? `<p style="font-size:13px;color:#64748b;margin-top:10px">${analysis.completionAssessment}</p>` : ''}
    <div class="gauge-wrap" style="margin-top:20px">
      <div>
        <p style="font-size:12px;color:#64748b;text-align:center;margin-bottom:4px">Issues</p>
        <div style="position:relative;height:180px"><canvas id="gaugeIssues" role="img" aria-label="Donut gauge showing ${issuesPct}% of issues completed."></canvas></div>
      </div>
      <div>
        <p style="font-size:12px;color:#64748b;text-align:center;margin-bottom:4px">Story points</p>
        <div style="position:relative;height:180px"><canvas id="gaugePts" role="img" aria-label="Donut gauge showing ${ptsPct}% of story points completed."></canvas></div>
      </div>
    </div>
  </div>

  <!-- Tabs -->
  <div class="tabs">
    <div class="tab active" onclick="show('velocity',this)">Velocity</div>
    ${pv.length ? `<div class="tab" onclick="show('platform',this)">Platform velocity</div>` : ''}
    <div class="tab" onclick="show('incomplete',this)">Not completed (${sprint.incompletedIssues.length})</div>
    ${sprint.completedOutsideIssues?.length ? `<div class="tab" onclick="show('outside',this)">Completed outside (${sprint.completedOutsideIssues.length})</div>` : ''}
    ${sprint.removedIssues.length ? `<div class="tab" onclick="show('removed',this)">Removed (${sprint.removedIssues.length})</div>` : ''}
    <div class="tab" onclick="show('completed',this)">Completed (${sprint.completedIssues.length})</div>
  </div>

  <!-- Velocity panel -->
  <div class="panel active" id="panel-velocity">
    <div class="card">
      <h2>Velocity — committed vs completed</h2>
      <div class="legend">
        <span><b style="background:#93c5fd"></b>Committed</span>
        <span><b style="background:#10b981"></b>Completed</span>
      </div>
      <div style="position:relative;width:100%;height:280px">
        <canvas id="velChart" role="img" aria-label="Velocity bar chart showing committed vs completed story points for last 6 sprints."></canvas>
      </div>
      ${analysis.velocityAssessment ? `<p style="font-size:13px;color:#64748b;margin-top:14px">${analysis.velocityAssessment}</p>` : ''}
    </div>
  </div>

  <!-- Platform velocity panel -->
  ${pv.length ? `
  <div class="panel" id="panel-platform">
    <div class="card">
      <h2>Avg velocity by platform</h2>
      <div style="position:relative;width:100%;height:${Math.max(200, pv.length * 52 + 80)}px">
        <canvas id="platChart" role="img" aria-label="Bar chart of average velocity by platform."></canvas>
      </div>
      <table class="issue-table" style="margin-top:20px">
        <thead><tr><th>Platform</th><th>Avg pts</th><th>Total pts</th><th>Sprints</th></tr></thead>
        <tbody>${pv.map(p => `
          <tr>
            <td style="font-weight:500">${p.platform}</td>
            <td>${p.avg} pts</td>
            <td>${p.total} pts</td>
            <td>${p.sprintCount}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
  </div>` : ''}

  <!-- Incomplete panel -->
  <div class="panel" id="panel-incomplete">
    <div class="card">
      <h2>Issues not completed</h2>
      ${sprint.incompletedIssues.length ? `
      <table class="issue-table">
        <thead><tr><th>Key</th><th>Summary</th><th>Pts</th><th>Status</th><th>Assignee</th></tr></thead>
        <tbody>${sprint.incompletedIssues.map(i => `
          <tr><td class="key">${i.key}</td><td>${i.summary}</td><td>${i.storyPoints}</td><td>${i.status}</td><td>${i.assigneeName}</td></tr>`).join('')}
        </tbody>
      </table>` : '<p style="color:#94a3b8">No incomplete issues.</p>'}
    </div>
  </div>

  ${sprint.completedOutsideIssues?.length ? `
  <div class="panel" id="panel-outside">
    <div class="card">
      <h2>Completed outside this sprint</h2>
      <table class="issue-table">
        <thead><tr><th>Key</th><th>Summary</th><th>Pts</th><th>Assignee</th></tr></thead>
        <tbody>${sprint.completedOutsideIssues.map(i => `
          <tr><td class="key">${i.key}</td><td>${i.summary}</td><td>${i.storyPoints}</td><td>${i.assigneeName}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>
  </div>` : ''}

  ${sprint.removedIssues.length ? `
  <div class="panel" id="panel-removed">
    <div class="card">
      <h2>Removed from sprint</h2>
      <table class="issue-table">
        <thead><tr><th>Key</th><th>Summary</th><th>Pts</th><th>Assignee</th></tr></thead>
        <tbody>${sprint.removedIssues.map(i => `
          <tr><td class="key">${i.key}</td><td>${i.summary}</td><td>${i.storyPoints}</td><td>${i.assigneeName}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>
  </div>` : ''}

  <div class="panel" id="panel-completed">
    <div class="card">
      <h2>Completed issues</h2>
      <table class="issue-table">
        <thead><tr><th>Key</th><th>Summary</th><th>Pts</th><th>Assignee</th></tr></thead>
        <tbody>${sprint.completedIssues.map(i => `
          <tr><td class="key">${i.key}</td><td>${i.summary}</td><td>${i.storyPoints}</td><td>${i.assigneeName}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>
  </div>

  ${analysis.risks?.length ? `
  <div class="card">
    <h2>Risks</h2>
    ${analysis.risks.map(r => `
    <div style="display:flex;gap:10px;align-items:flex-start;margin-bottom:10px">
      <span class="pill risk-${r.level}">${r.level}</span>
      <span style="font-size:14px;color:#334155">${r.description}</span>
    </div>`).join('')}
  </div>` : ''}

  ${analysis.recommendations?.length ? `
  <div class="card">
    <h2>Recommendations</h2>
    <ul class="rec-list">${analysis.recommendations.map(r => `<li>${r}</li>`).join('')}</ul>
  </div>` : ''}

  ${analysis.analysis ? (() => {
    const a = analysis.analysis;
    return `<div class="card">
      <h2>Analysis</h2>
      ${a.scopeChanges    ? `<p style="font-size:13px;color:#475569;margin-bottom:8px"><strong>Scope:</strong> ${a.scopeChanges}</p>` : ''}
      ${a.velocityInsight ? `<p style="font-size:13px;color:#475569;margin-bottom:8px"><strong>Velocity:</strong> ${a.velocityInsight}</p>` : ''}
      ${a.carryoverImpact ? `<p style="font-size:13px;color:#475569;margin-bottom:16px"><strong>Carryover:</strong> ${a.carryoverImpact}</p>` : ''}
      ${a.whatWentWell?.length ? `<p style="font-size:13px;font-weight:600;color:#065f46;margin-bottom:6px">What went well</p><ul class="rec-list" style="margin-bottom:16px">${a.whatWentWell.map(w => `<li style="color:#065f46">${w}</li>`).join('')}</ul>` : ''}
      ${a.whatDidntGoWell?.length ? `<p style="font-size:13px;font-weight:600;color:#991b1b;margin-bottom:6px">What didn't go well</p><ul class="rec-list" style="margin-bottom:16px">${a.whatDidntGoWell.map(w => `<li style="color:#991b1b">${w}</li>`).join('')}</ul>` : ''}
      ${a.retrospectiveActions?.length ? `<p style="font-size:13px;font-weight:600;color:#0f172a;margin-bottom:6px">Retrospective actions</p><ul class="rec-list">${a.retrospectiveActions.map(r => `<li>${r}</li>`).join('')}</ul>` : ''}
    </div>`;
  })() : ''}

  <footer>Sprint Analytics · ${analysis.displayName || 'Board ' + boardId} · Jira GreenHopper + Claude AI</footer>
</div>

<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js"></script>
<script>
function show(id, tab) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById('panel-' + id).classList.add('active');
  tab.classList.add('active');
}

const gridColor = 'rgba(0,0,0,0.06)';
const textColor = '#64748b';

// ── Velocity chart ──────────────────────────────────────────────────────
const velLabels    = ${velLabels};
const velCommitted = ${velCommitted};
const velCompleted = ${velCompleted};
const platBySprint = ${platBySprintJson};

new Chart(document.getElementById('velChart'), {
  type: 'bar',
  data: {
    labels: velLabels,
    datasets: [
      {
        label: 'Committed',
        data: velCommitted,
        backgroundColor: '#93c5fd',
        borderColor: '#3b82f6',
        borderWidth: 1,
        borderRadius: 3,
      },
      {
        label: 'Completed',
        data: velCompleted,
        backgroundColor: '#6ee7b7',
        borderColor: '#10b981',
        borderWidth: 1,
        borderRadius: 3,
      }
    ]
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          afterBody: items => {
            const sprintName = items[0].label;
            const plat = platBySprint[sprintName] || {};
            const lines = Object.entries(plat).map(([p, pts]) => p + ': ' + pts + 'pts');
            const pct = velCommitted[items[0].dataIndex] > 0
              ? Math.round((velCompleted[items[0].dataIndex] / velCommitted[items[0].dataIndex]) * 100) + '%'
              : '—';
            return ['Completion: ' + pct, ...lines];
          }
        }
      }
    },
    scales: {
      x: { ticks: { color: textColor, autoSkip: false }, grid: { color: gridColor } },
      y: { beginAtZero: true, ticks: { color: textColor, callback: v => v + 'pts' }, grid: { color: gridColor } }
    }
  }
});

// ── Completion gauges ───────────────────────────────────────────────────
function makeGauge(id, pct, label) {
  new Chart(document.getElementById(id), {
    type: 'doughnut',
    data: {
      datasets: [{
        data: [pct, 100 - pct],
        backgroundColor: ['#10b981', '#f1f5f9'],
        borderWidth: 0,
        circumference: 240,
        rotation: -120,
        borderRadius: 4,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '72%',
      plugins: { legend: { display: false }, tooltip: { enabled: false } }
    },
    plugins: [{
      id: 'centerText',
      afterDraw(chart) {
        const { ctx, chartArea: { left, right, top, bottom } } = chart;
        const cx = (left + right) / 2, cy = (top + bottom) / 2 + 10;
        ctx.save();
        ctx.textAlign = 'center';
        ctx.fillStyle = '#0f172a';
        ctx.font = '700 26px system-ui';
        ctx.fillText(pct + '%', cx, cy);
        ctx.fillStyle = '#64748b';
        ctx.font = '400 11px system-ui';
        ctx.fillText(label, cx, cy + 18);
        ctx.restore();
      }
    }]
  });
}
makeGauge('gaugeIssues', ${issuesPct}, '${comp.completed} / ${comp.total} issues');
makeGauge('gaugePts',    ${ptsPct},    '${comp.completedPts} / ${comp.totalPts} pts');

// ── Platform velocity chart ─────────────────────────────────────────────
const platEl = document.getElementById('platChart');
if (platEl) {
  const platLabels = ${platLabels};
  const platAvgs   = ${platAvgs};
  const platColors = ['#85B7EB','#AFA9EC','#5DCAA5','#FAC775','#F09595','#9FE1CB'];
  new Chart(platEl, {
    type: 'bar',
    data: {
      labels: platLabels,
      datasets: [{
        label: 'Avg pts',
        data: platAvgs,
        backgroundColor: platColors.slice(0, platLabels.length),
        borderRadius: 4,
        borderSkipped: false,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ' ' + ctx.raw + ' pts avg' } }
      },
      scales: {
        x: { type: 'category', grid: { display: false }, ticks: { color: textColor, font: { size: 13 } } },
        y: { type: 'linear', beginAtZero: true, ticks: { color: textColor, callback: v => v + ' pts' }, grid: { color: gridColor } }
      }
    }
  });
}
</script>
</body>
</html>`;

  fs.mkdirSync(outputDir, { recursive: true });
  const filename = `sprint-analytics-${boardId}-${Date.now()}.html`;
  const filePath = path.join(outputDir, filename);
  fs.writeFileSync(filePath, html, 'utf8');
  return filePath;
}

module.exports = { generateSprintAnalyticsHtml };
