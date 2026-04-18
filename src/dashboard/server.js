// src/dashboard/server.js
// Web dashboard: view all board summaries, drill into reports, trigger runs
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const express  = require('express');
const store        = require('../store');
const releaseStore = require('../release-store');
const setStore     = require('../release-set-store');
const { runMultiBoard, runPipeline, getBoardIdsFromEnv }                       = require('../pipeline');
const { runMultiVersionPipeline, runReleasePipeline, getReleaseConfigFromEnv } = require('../release-pipeline');
const { runAllReleaseSets, runReleaseSetPipeline, getReleaseSetConfigs }       = require('../release-set-pipeline');

const app  = express();
const PORT = process.env.DASHBOARD_PORT || 3000;

app.use(express.json());

// ─────────────────────────────────────────────────────────────────────────────
// API routes
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/summaries — one card per board (latest report only)
app.get('/api/summaries', (_req, res) => {
  res.json(store.getBoardSummaries());
});

// GET /api/reports/:boardId — full history for a board
app.get('/api/reports/:boardId', (req, res) => {
  const reports = store.getReports(req.params.boardId);
  if (!reports.length) return res.status(404).json({ error: 'No reports found for this board.' });
  res.json(reports);
});

// GET /api/reports/:boardId/latest — latest analysis for a board
app.get('/api/reports/:boardId/latest', (req, res) => {
  const report = store.getLatestReport(req.params.boardId);
  if (!report) return res.status(404).json({ error: 'No reports found for this board.' });
  res.json(report);
});

// POST /api/run — trigger a fresh pipeline run
// Body: { boardId?: string, all?: boolean, slack?: boolean, html?: boolean }
app.post('/api/run', async (req, res) => {
  const { boardId, all, slack, html } = req.body || {};

  const opts = {
    console: true,
    slack:   slack  ?? (process.env.SEND_SLACK !== 'false'),
    html:    html   ?? (process.env.SAVE_HTML_REPORT === 'true'),
    store:   true,
  };

  try {
    if (all || !boardId) {
      const boardIds = getBoardIdsFromEnv();
      const results  = await runMultiBoard(boardIds, opts);
      res.json({ ok: true, ran: boardIds, results: results.map(r => ({
        boardId:  r.boardId,
        sprint:   r.sprint?.name,
        health:   r.analysis?.overallHealth,
        error:    r.error,
      }))});
    } else {
      const result = await runPipeline(boardId, opts);
      res.json({ ok: true, boardId, sprint: result.sprint.name, health: result.analysis.overallHealth });
    }
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/release-sets — all set summaries
app.get('/api/release-sets', (_req, res) => {
  res.json(setStore.getAllSetSummaries());
});

// GET /api/release-sets/:setName — full history for a set
app.get('/api/release-sets/:setName', (req, res) => {
  const reports = setStore.getSetReports(req.params.setName);
  if (!reports.length) return res.status(404).json({ error: 'No reports found.' });
  res.json(reports);
});

// POST /api/release-set/run — trigger a fresh release set pipeline
// Body: { setName?, all?: boolean, slack?: boolean, html?: boolean }
app.post('/api/release-set/run', async (req, res) => {
  const { setName, all, slack, html } = req.body || {};
  const opts = {
    console: true,
    slack:   slack ?? (process.env.SEND_SLACK !== 'false'),
    html:    html  ?? (process.env.SAVE_HTML_REPORT === 'true'),
    store:   true,
  };
  try {
    if (all || !setName) {
      const results = await runAllReleaseSets(opts);
      res.json({ ok: true, results: results.map(r => ({
        setName:  r.setName,
        health:   r.analysis?.overallHealth,
        readiness:r.analysis?.readiness,
        error:    r.error,
      }))});
    } else {
      let configs;
      try { configs = getReleaseSetConfigs(); } catch { return res.status(400).json({ error: 'JIRA_RELEASE_SETS not configured.' }); }
      const cfg = configs.find(c => c.setName === setName);
      if (!cfg) return res.status(404).json({ error: `Set "${setName}" not found in config.` });
      const result = await runReleaseSetPipeline(cfg.setName, cfg.versionNames, opts, cfg.pattern, cfg.jqlClause);
      res.json({ ok: true, setName, health: result.analysis.overallHealth, readiness: result.analysis.readiness });
    }
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});


app.get('/api/releases', (_req, res) => {
  res.json(releaseStore.getAllReleaseSummaries());
});

// GET /api/releases/:projectKey/:versionName — full history for a version
app.get('/api/releases/:projectKey/:versionName', (req, res) => {
  const reports = releaseStore.getReleaseReports(req.params.projectKey, req.params.versionName);
  if (!reports.length) return res.status(404).json({ error: 'No reports found.' });
  res.json(reports);
});

// POST /api/release/run — trigger a fresh release pipeline run
// Body: { projectKey, versionName?, all?: boolean, slack?: boolean, html?: boolean }
app.post('/api/release/run', async (req, res) => {
  const { projectKey, versionName, all, slack, html } = req.body || {};
  const opts = {
    console: true,
    slack:   slack ?? (process.env.SEND_SLACK !== 'false'),
    html:    html  ?? (process.env.SAVE_HTML_REPORT === 'true'),
    store:   true,
  };

  try {
    if (!projectKey) return res.status(400).json({ error: 'projectKey is required.' });

    if (all || !versionName) {
      let configs;
      try { configs = getReleaseConfigFromEnv(); } catch { configs = [{ projectKey, versions: [] }]; }
      const cfg     = configs.find(c => c.projectKey === projectKey) || { projectKey, versions: [] };
      const results = await runMultiVersionPipeline(cfg.projectKey, cfg.versions, opts);
      res.json({ ok: true, projectKey, results: results.map(r => ({
        versionName: r.versionName,
        health:      r.analysis?.overallHealth,
        readiness:   r.analysis?.readiness,
        error:       r.error,
      }))});
    } else {
      const result = await runReleasePipeline(projectKey, versionName, opts);
      res.json({ ok: true, projectKey, versionName, health: result.analysis.overallHealth, readiness: result.analysis.readiness });
    }
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard HTML (single-page, self-contained)
// ─────────────────────────────────────────────────────────────────────────────
app.get('/', (_req, res) => res.send(dashboardHtml()));

function dashboardHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sprint & Release Dashboard</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8fafc;color:#1e293b;font-size:15px;line-height:1.6}
  .topbar{background:#fff;border-bottom:1px solid #e2e8f0;padding:0 32px;height:56px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:10}
  .topbar h1{font-size:17px;font-weight:600;color:#0f172a}
  .topbar .meta{font-size:13px;color:#64748b}
  .tabs{display:flex;gap:0;border-bottom:1px solid #e2e8f0;background:#fff;padding:0 32px;position:sticky;top:56px;z-index:9}
  .tab{padding:12px 20px;font-size:14px;font-weight:500;color:#64748b;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px;transition:color .15s,border-color .15s}
  .tab:hover{color:#0f172a}
  .tab.active{color:#0f172a;border-bottom-color:#0f172a}
  .tab-panel{display:none}.tab-panel.active{display:block}
  .container{max-width:1100px;margin:0 auto;padding:32px 24px}
  .section-title{font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.07em;color:#94a3b8;margin-bottom:16px}
  .cards-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;margin-bottom:40px}
  .card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px;cursor:pointer;transition:box-shadow .15s,border-color .15s}
  .card:hover{border-color:#94a3b8;box-shadow:0 4px 12px rgba(0,0,0,.06)}
  .card.selected{border-color:#3b82f6;box-shadow:0 0 0 3px rgba(59,130,246,.15)}
  .card-name{font-weight:600;font-size:15px;color:#0f172a;margin-bottom:4px}
  .card-sub{font-size:13px;color:#64748b;margin-bottom:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .health-pill{display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:99px;font-size:12px;font-weight:700}
  .health-pill.Green{background:#d1fae5;color:#065f46}
  .health-pill.Yellow{background:#fef9c3;color:#854d0e}
  .health-pill.Red{background:#fee2e2;color:#991b1b}
  .health-pill.Unknown{background:#f1f5f9;color:#64748b}
  .health-dot{width:7px;height:7px;border-radius:50%}
  .Green .health-dot{background:#10b981}.Yellow .health-dot{background:#eab308}
  .Red .health-dot{background:#ef4444}.Unknown .health-dot{background:#94a3b8}
  .card-stats{display:flex;gap:16px;margin-top:12px;font-size:13px;color:#64748b}
  .readiness-track{background:#f1f5f9;border-radius:99px;height:6px;overflow:hidden;margin:8px 0 4px}
  .readiness-fill{height:100%;border-radius:99px;transition:width .4s}
  .readiness-label{font-size:11px;color:#64748b}
  .feasibility-pill{display:inline-block;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:600;margin-top:6px}
  .feasibility-pill.on-track{background:#d1fae5;color:#065f46}
  .feasibility-pill.at-risk{background:#fef9c3;color:#854d0e}
  .feasibility-pill.likely-delayed{background:#fee2e2;color:#991b1b}
  .feasibility-pill.descoped{background:#fce7f3;color:#9d174d}
  .run-bar{display:flex;align-items:center;gap:10px;margin-bottom:32px;flex-wrap:wrap}
  .btn{padding:8px 16px;border-radius:8px;border:1px solid #e2e8f0;background:#fff;font-size:13px;font-weight:500;cursor:pointer;color:#334155;transition:background .15s,border-color .15s}
  .btn:hover{background:#f8fafc;border-color:#94a3b8}
  .btn.primary{background:#0f172a;border-color:#0f172a;color:#fff}
  .btn.primary:hover{background:#1e293b}
  .btn:disabled{opacity:.5;cursor:default}
  .spinner{display:none;width:14px;height:14px;border:2px solid #e2e8f0;border-top-color:#64748b;border-radius:50%;animation:spin .7s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}
  .spinner.visible{display:inline-block}
  .status-msg{font-size:13px;color:#64748b;min-height:20px}
  .status-msg.ok{color:#059669}.status-msg.err{color:#dc2626}
  .detail{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:24px;margin-bottom:32px;display:none}
  .detail.visible{display:block}
  .detail-header{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px}
  .detail-title{font-size:19px;font-weight:700;color:#0f172a}
  .detail-meta{font-size:13px;color:#64748b;margin-top:4px}
  .summary-text{color:#334155;margin-bottom:20px;padding:16px;background:#f8fafc;border-radius:8px;font-size:14px;line-height:1.7}
  .stats-row{display:flex;flex-wrap:wrap;gap:12px;margin-bottom:24px}
  .stat-pill{background:#f1f5f9;border-radius:8px;padding:10px 16px;font-size:13px;min-width:100px}
  .stat-pill .label{color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:.05em}
  .stat-pill .value{font-size:22px;font-weight:700;color:#0f172a}
  .section{margin-bottom:24px}
  .section h3{font-size:14px;font-weight:600;color:#0f172a;margin-bottom:10px}
  .issue-row{border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;margin-bottom:8px;font-size:14px}
  .issue-key{font-family:monospace;font-size:12px;font-weight:700;color:#3b82f6}
  .issue-title{font-weight:500;margin:3px 0;color:#1e293b}
  .issue-sub{font-size:12px;color:#64748b}
  .issue-action{font-size:13px;color:#475569;border-top:1px solid #f1f5f9;padding-top:8px;margin-top:8px}
  .risk-badge{display:inline-block;padding:1px 8px;border-radius:99px;font-size:11px;font-weight:700;margin-right:6px}
  .risk-High{background:#fee2e2;color:#991b1b}
  .risk-Medium{background:#fef9c3;color:#854d0e}
  .risk-Low{background:#dbeafe;color:#1e40af}
  .rec-list{list-style:none}
  .rec-list li{padding:8px 12px;background:#f8fafc;border-radius:6px;margin-bottom:6px;font-size:14px;color:#334155}
  .rec-list li::before{content:"→ ";color:#3b82f6;font-weight:700}
  .history-table{width:100%;border-collapse:collapse;font-size:13px}
  .history-table th{text-align:left;padding:8px 12px;color:#64748b;border-bottom:1px solid #e2e8f0;font-weight:500}
  .history-table td{padding:8px 12px;border-bottom:1px solid #f1f5f9;color:#334155}
  .history-table tr:last-child td{border-bottom:none}
  .history-table tr:hover td{background:#f8fafc}
  .empty{text-align:center;padding:48px 24px;color:#94a3b8;font-size:14px}
  .readiness-bar-lg{margin:8px 0}
  .readiness-bar-lg .track{background:#f1f5f9;border-radius:99px;height:10px;overflow:hidden}
  .readiness-bar-lg .fill{height:100%;border-radius:99px}
  .readiness-bar-lg .pct{font-size:13px;color:#64748b;margin-top:4px}
</style>
</head>
<body>

<div class="topbar">
  <h1>Sprint &amp; Release Dashboard</h1>
  <span class="meta" id="last-refresh">Loading...</span>
</div>

<div class="tabs">
  <div class="tab active" onclick="switchTab('sprints')">Sprints</div>
  <div class="tab"        onclick="switchTab('releases')">Releases</div>
  <div class="tab"        onclick="switchTab('release-sets')">Release sets</div>
</div>

<!-- ══ SPRINTS TAB ══════════════════════════════════════════════════════ -->
<div class="tab-panel active" id="tab-sprints">
<div class="container">
  <div class="section-title">Boards</div>
  <div class="cards-grid" id="boards-grid"><div class="empty">Loading...</div></div>

  <div class="detail" id="sprint-detail">
    <div class="detail-header">
      <div>
        <div class="detail-title" id="sd-title"></div>
        <div class="detail-meta"  id="sd-meta"></div>
      </div>
      <div id="sd-health"></div>
    </div>
    <div class="summary-text" id="sd-summary"></div>
    <div class="stats-row"    id="sd-stats"></div>
    <div class="section" id="sd-blockers-sec" style="display:none"><h3>Blockers</h3><div id="sd-blockers"></div></div>
    <div class="section" id="sd-risks-sec"    style="display:none"><h3>Risks</h3><div id="sd-risks"></div></div>
    <div class="section" id="sd-recs-sec"     style="display:none"><h3>Recommendations</h3><ul class="rec-list" id="sd-recs"></ul></div>
    <div class="section-title" style="margin-top:28px">Run history</div>
    <table class="history-table">
      <thead><tr><th>Run at</th><th>Sprint</th><th>Health</th><th>Issues</th><th>Risks</th><th>Blockers</th></tr></thead>
      <tbody id="sd-history"></tbody>
    </table>
  </div>

  <div class="run-bar">
    <button class="btn primary" onclick="runAllSprints()">Run all boards</button>
    <button class="btn" id="btn-run-board" onclick="runSelectedBoard()" disabled>Run selected board</button>
    <span class="spinner" id="sp-spinner"></span>
    <span class="status-msg" id="sp-status"></span>
  </div>
</div>
</div>

<!-- ══ RELEASES TAB ═════════════════════════════════════════════════════ -->
<div class="tab-panel" id="tab-releases">
<div class="container">
  <div class="section-title">Releases</div>
  <div class="cards-grid" id="releases-grid"><div class="empty">Loading...</div></div>

  <div class="detail" id="release-detail">
    <div class="detail-header">
      <div>
        <div class="detail-title" id="rd-title"></div>
        <div class="detail-meta"  id="rd-meta"></div>
      </div>
      <div id="rd-health"></div>
    </div>
    <div id="rd-readiness" class="readiness-bar-lg" style="max-width:320px;margin-bottom:16px"></div>
    <div class="summary-text" id="rd-summary"></div>
    <div class="stats-row"    id="rd-stats"></div>
    <div class="section" id="rd-blockers-sec"  style="display:none"><h3>Blockers</h3><div id="rd-blockers"></div></div>
    <div class="section" id="rd-critical-sec"  style="display:none"><h3>Critical unfinished</h3><div id="rd-critical"></div></div>
    <div class="section" id="rd-risks-sec"     style="display:none"><h3>Risks</h3><div id="rd-risks"></div></div>
    <div class="section" id="rd-recs-sec"      style="display:none"><h3>Recommendations</h3><ul class="rec-list" id="rd-recs"></ul></div>
    <div class="section-title" style="margin-top:28px">Run history</div>
    <table class="history-table">
      <thead><tr><th>Run at</th><th>Version</th><th>Health</th><th>Readiness</th><th>Feasibility</th><th>Done</th><th>Total</th></tr></thead>
      <tbody id="rd-history"></tbody>
    </table>
  </div>

  <div class="run-bar">
    <button class="btn primary" onclick="runAllReleases()">Run all releases</button>
    <button class="btn" id="btn-run-release" onclick="runSelectedRelease()" disabled>Run selected release</button>
    <span class="spinner" id="rl-spinner"></span>
    <span class="status-msg" id="rl-status"></span>
  </div>
</div>
</div>

<!-- ══ RELEASE SETS TAB ═════════════════════════════════════════════════ -->
<div class="tab-panel" id="tab-release-sets">
<div class="container">
  <div class="section-title">Release sets</div>
  <div class="cards-grid" id="sets-grid"><div class="empty">Loading...</div></div>

  <div class="detail" id="set-detail">
    <div class="detail-header">
      <div>
        <div class="detail-title" id="setd-title"></div>
        <div class="detail-meta"  id="setd-meta"></div>
      </div>
      <div id="setd-health"></div>
    </div>
    <div id="setd-readiness" style="max-width:320px;margin-bottom:16px"></div>
    <div class="summary-text" id="setd-summary"></div>
    <div class="stats-row"    id="setd-stats"></div>

    <!-- Sub-tabs: Overview / By project / By team -->
    <div style="display:flex;gap:0;border-bottom:1px solid #e2e8f0;margin:20px 0 16px">
      <div class="subtab active" onclick="showSubTab('overview',this)" style="padding:8px 16px;font-size:13px;font-weight:500;color:#64748b;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px">Overview</div>
      <div class="subtab" onclick="showSubTab('byversion',this)" style="padding:8px 16px;font-size:13px;font-weight:500;color:#64748b;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px">By version</div>
      <div class="subtab" onclick="showSubTab('byproject',this)" style="padding:8px 16px;font-size:13px;font-weight:500;color:#64748b;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px">By project</div>
      <div class="subtab" onclick="showSubTab('byteam',this)" style="padding:8px 16px;font-size:13px;font-weight:500;color:#64748b;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px">By team</div>
      <div class="subtab" id="subtab-tickets" onclick="showSubTab('tickets',this)" style="padding:8px 16px;font-size:13px;font-weight:500;color:#64748b;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px;display:none">Tickets</div>
    </div>
    <div id="subpanel-overview"><div id="setd-crossblockers"></div><ul class="rec-list" id="setd-recs" style="margin-top:12px"></ul></div>
    <div id="subpanel-byversion" style="display:none"><div id="setd-byversion"></div></div>
    <div id="subpanel-byproject" style="display:none"><div id="setd-byproject"></div></div>
    <div id="subpanel-byteam"    style="display:none"><div id="setd-byteam"></div></div>
    <div id="subpanel-tickets"   style="display:none"><div id="setd-tickets"></div></div>

    <div class="section-title" style="margin-top:28px">Run history</div>
    <table class="history-table">
      <thead><tr><th>Run at</th><th>Versions</th><th>Health</th><th>Readiness</th><th>Done</th><th>Total</th><th>Projects</th><th>Teams</th></tr></thead>
      <tbody id="setd-history"></tbody>
    </table>
  </div>

  <div class="run-bar">
    <button class="btn primary" onclick="runAllSets()">Run all release sets</button>
    <button class="btn" id="btn-run-set" onclick="runSelectedSet()" disabled>Run selected set</button>
    <span class="spinner" id="rs-spinner"></span>
    <span class="status-msg" id="rs-status"></span>
  </div>
</div>
</div>

<script>
// ── Tab switching ─────────────────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.tab').forEach((t,i) => t.classList.toggle('active', ['sprints','releases','release-sets'][i] === name));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
}

// ── Shared helpers ────────────────────────────────────────────────────────
function healthPill(h) {
  const health = h || 'Unknown';
  return \`<span class="health-pill \${health}"><span class="health-dot"></span>\${health}</span>\`;
}
function riskBadge(level) {
  return \`<span class="risk-badge risk-\${level}">\${level}</span>\`;
}
function feasibilityPill(f) {
  if (!f) return '';
  const cls = f === 'On track' ? 'on-track' : f === 'At risk' ? 'at-risk' : f.includes('delayed') ? 'likely-delayed' : 'descoped';
  return \`<span class="feasibility-pill \${cls}">\${f}</span>\`;
}
function readinessBar(pct) {
  const color = pct >= 80 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#ef4444';
  return \`<div class="track"><div class="fill" style="width:\${pct}%;background:\${color}"></div></div>
          <div class="pct">\${pct}% ready</div>\`;
}
async function triggerRun(url, body, spinnerId, statusId, onSuccess) {
  const spinner = document.getElementById(spinnerId);
  const msg     = document.getElementById(statusId);
  spinner.classList.add('visible');
  msg.className = 'status-msg';
  msg.textContent = 'Running…';
  document.querySelectorAll('.btn').forEach(b => b.disabled = true);
  try {
    const res  = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
    const data = await res.json();
    if (data.ok) {
      msg.className = 'status-msg ok'; msg.textContent = 'Done! Refreshing…';
      await onSuccess();
    } else {
      msg.className = 'status-msg err'; msg.textContent = 'Error: ' + data.error;
    }
  } catch(err) {
    msg.className = 'status-msg err'; msg.textContent = 'Failed: ' + err.message;
  } finally {
    spinner.classList.remove('visible');
    document.querySelectorAll('.btn').forEach(b => b.disabled = false);
    document.getElementById('btn-run-board').disabled    = !selectedBoardId;
    document.getElementById('btn-run-release').disabled  = !selectedRelease;
    setTimeout(() => { if (msg.classList.contains('ok')) msg.textContent = ''; }, 4000);
  }
}

// ── SPRINTS ───────────────────────────────────────────────────────────────
let selectedBoardId = null;

async function loadSprints() {
  const res  = await fetch('/api/summaries');
  const data = await res.json();
  document.getElementById('last-refresh').textContent = 'Refreshed ' + new Date().toLocaleTimeString();
  const grid = document.getElementById('boards-grid');
  if (!data.length) { grid.innerHTML = '<div class="empty">No sprint reports yet. Click "Run all boards" to start.</div>'; return; }
  grid.innerHTML = data.map(s => {
    const health = s.health || 'Unknown';
    const ran    = s.latestRun ? new Date(s.latestRun).toLocaleString() : 'Never';
    return \`<div class="card \${selectedBoardId === s.boardId ? 'selected' : ''}" onclick="selectBoard('\${s.boardId}')">
      <div class="card-name">Board \${s.boardId}</div>
      <div class="card-sub">\${s.sprintName || '—'}</div>
      \${healthPill(health)}
      <div class="card-stats">
        <span><strong>\${s.totalIssues}</strong> issues</span>
        <span><strong>\${s.riskCount}</strong> risks</span>
        <span><strong>\${s.blockerCount}</strong> blockers</span>
      </div>
      <div style="font-size:11px;color:#94a3b8;margin-top:8px">Last run: \${ran}</div>
    </div>\`;
  }).join('');
}

async function selectBoard(boardId) {
  selectedBoardId = boardId;
  document.getElementById('btn-run-board').disabled = false;
  await loadSprints();
  const res = await fetch(\`/api/reports/\${boardId}\`);
  if (!res.ok) return;
  renderSprintDetail(boardId, await res.json());
}

function renderSprintDetail(boardId, reports) {
  const panel  = document.getElementById('sprint-detail');
  const latest = reports[0];
  const a      = latest.analysis;
  panel.classList.add('visible');
  document.getElementById('sd-title').textContent   = latest.sprintName;
  document.getElementById('sd-meta').textContent    = 'Board ' + boardId + ' · Last run: ' + new Date(latest.runAt).toLocaleString();
  document.getElementById('sd-health').innerHTML    = healthPill(a.overallHealth);
  document.getElementById('sd-summary').textContent = a.summary;
  document.getElementById('sd-stats').innerHTML     = [
    \`<div class="stat-pill"><div class="label">Total</div><div class="value">\${a.stats.total}</div></div>\`,
    ...Object.entries(a.stats.byStatus||{}).map(([s,n]) => \`<div class="stat-pill"><div class="label">\${s}</div><div class="value">\${n}</div></div>\`)
  ].join('');
  const bSec = document.getElementById('sd-blockers-sec');
  if (a.blockers?.length) {
    bSec.style.display = 'block';
    document.getElementById('sd-blockers').innerHTML = a.blockers.map(b =>
      \`<div class="issue-row"><div class="issue-key">\${b.issueKey}</div><div class="issue-title">\${b.title}</div><div class="issue-action">\${b.suggestedAction}</div></div>\`).join('');
  } else bSec.style.display = 'none';
  const rSec = document.getElementById('sd-risks-sec');
  if (a.risks?.length) {
    rSec.style.display = 'block';
    document.getElementById('sd-risks').innerHTML = a.risks.map(r =>
      \`<div class="issue-row">\${riskBadge(r.level)}<span class="issue-key">\${r.issueKey}</span><div class="issue-title">\${r.title}</div><div class="issue-sub">\${r.reason}</div></div>\`).join('');
  } else rSec.style.display = 'none';
  const recSec = document.getElementById('sd-recs-sec');
  if (a.recommendations?.length) {
    recSec.style.display = 'block';
    document.getElementById('sd-recs').innerHTML = a.recommendations.map(r => \`<li>\${r}</li>\`).join('');
  } else recSec.style.display = 'none';
  document.getElementById('sd-history').innerHTML = reports.map(r =>
    \`<tr><td>\${new Date(r.runAt).toLocaleString()}</td><td>\${r.sprintName}</td><td>\${healthPill(r.analysis.overallHealth)}</td>
     <td>\${r.analysis.stats.total}</td><td>\${r.analysis.risks?.length||0}</td><td>\${r.analysis.blockers?.length||0}</td></tr>\`).join('');
  panel.scrollIntoView({ behavior:'smooth', block:'start' });
}

async function runAllSprints()    { await triggerRun('/api/run', {all:true}, 'sp-spinner', 'sp-status', async()=>{ await loadSprints(); if(selectedBoardId) await selectBoard(selectedBoardId); }); }
async function runSelectedBoard() { if(!selectedBoardId) return; await triggerRun('/api/run', {boardId:selectedBoardId}, 'sp-spinner', 'sp-status', async()=>{ await loadSprints(); await selectBoard(selectedBoardId); }); }

// ── RELEASES ──────────────────────────────────────────────────────────────
let selectedRelease = null; // { projectKey, versionName }

async function loadReleases() {
  const res  = await fetch('/api/releases');
  const data = await res.json();
  const grid = document.getElementById('releases-grid');
  if (!data.length) { grid.innerHTML = '<div class="empty">No release reports yet. Click "Run all releases" to start.</div>'; return; }
  grid.innerHTML = data.map(r => {
    const selKey = selectedRelease ? selectedRelease.projectKey + '::' + selectedRelease.versionName : null;
    const thisKey = r.projectKey + '::' + r.versionName;
    const pct   = r.readiness || 0;
    const color = pct >= 80 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#ef4444';
    const ran   = r.latestRun ? new Date(r.latestRun).toLocaleString() : 'Never';
    return \`<div class="card \${selKey === thisKey ? 'selected' : ''}" onclick="selectRelease('\${r.projectKey}','\${r.versionName}')">
      <div class="card-name">\${r.versionName}</div>
      <div class="card-sub">\${r.projectKey}\${r.releaseDate ? ' · ' + r.releaseDate : ''}</div>
      \${healthPill(r.health)}
      \${feasibilityPill(r.feasibility)}
      <div class="readiness-track" style="margin-top:10px">
        <div class="readiness-fill" style="width:\${pct}%;background:\${color}"></div>
      </div>
      <div class="readiness-label">\${pct}% ready</div>
      <div class="card-stats">
        <span><strong>\${r.done}</strong>/\${r.totalIssues} done</span>
        <span><strong>\${r.riskCount}</strong> risks</span>
        <span><strong>\${r.criticalCount}</strong> critical</span>
      </div>
      <div style="font-size:11px;color:#94a3b8;margin-top:8px">Last run: \${ran}</div>
    </div>\`;
  }).join('');
}

async function selectRelease(projectKey, versionName) {
  selectedRelease = { projectKey, versionName };
  document.getElementById('btn-run-release').disabled = false;
  await loadReleases();
  const res = await fetch(\`/api/releases/\${projectKey}/\${encodeURIComponent(versionName)}\`);
  if (!res.ok) return;
  renderReleaseDetail(projectKey, versionName, await res.json());
}

function renderReleaseDetail(projectKey, versionName, reports) {
  const panel  = document.getElementById('release-detail');
  const latest = reports[0];
  const a      = latest.analysis;
  panel.classList.add('visible');
  document.getElementById('rd-title').textContent   = a.releaseName;
  document.getElementById('rd-meta').innerHTML      = \`\${projectKey} · \${a.releaseDate ? 'Target: ' + a.releaseDate + ' · ' : ''}Last run: \${new Date(latest.runAt).toLocaleString()} \${feasibilityPill(a.releaseFeasibility)}\`;
  document.getElementById('rd-health').innerHTML    = healthPill(a.overallHealth);
  document.getElementById('rd-readiness').innerHTML = readinessBar(a.readiness || 0);
  document.getElementById('rd-summary').textContent = a.summary;
  document.getElementById('rd-stats').innerHTML     = [
    \`<div class="stat-pill"><div class="label">Total</div><div class="value">\${a.stats.total}</div></div>\`,
    \`<div class="stat-pill"><div class="label">Done</div><div class="value" style="color:#10b981">\${a.stats.done}</div></div>\`,
    \`<div class="stat-pill"><div class="label">In progress</div><div class="value" style="color:#f59e0b">\${a.stats.inProgress}</div></div>\`,
    \`<div class="stat-pill"><div class="label">Not started</div><div class="value" style="color:\${a.stats.notStarted>0?'#ef4444':'#0f172a'}">\${a.stats.notStarted}</div></div>\`,
    \`<div class="stat-pill"><div class="label">Unassigned</div><div class="value" style="color:\${a.stats.unassigned>0?'#ef4444':'#0f172a'}">\${a.stats.unassigned}</div></div>\`,
  ].join('');
  const bSec = document.getElementById('rd-blockers-sec');
  if (a.blockers?.length) {
    bSec.style.display = 'block';
    document.getElementById('rd-blockers').innerHTML = a.blockers.map(b =>
      \`<div class="issue-row"><div class="issue-key">\${b.issueKey}</div><div class="issue-title">\${b.title}</div><div class="issue-action">\${b.suggestedAction}</div></div>\`).join('');
  } else bSec.style.display = 'none';
  const cSec = document.getElementById('rd-critical-sec');
  if (a.criticalUnfinished?.length) {
    cSec.style.display = 'block';
    document.getElementById('rd-critical').innerHTML = a.criticalUnfinished.map(i =>
      \`<div class="issue-row">\${riskBadge(i.priority)}<span class="issue-key">\${i.issueKey}</span>
       <div class="issue-title">\${i.title}</div><div class="issue-sub">Status: \${i.status} · \${i.assignee}</div></div>\`).join('');
  } else cSec.style.display = 'none';
  const rSec = document.getElementById('rd-risks-sec');
  if (a.risks?.length) {
    rSec.style.display = 'block';
    document.getElementById('rd-risks').innerHTML = a.risks.map(r =>
      \`<div class="issue-row">\${riskBadge(r.level)}<span class="issue-key">\${r.issueKey}</span>
       <div class="issue-title">\${r.title}</div><div class="issue-sub">\${r.reason}</div></div>\`).join('');
  } else rSec.style.display = 'none';
  const recSec = document.getElementById('rd-recs-sec');
  if (a.recommendations?.length) {
    recSec.style.display = 'block';
    document.getElementById('rd-recs').innerHTML = a.recommendations.map(r => \`<li>\${r}</li>\`).join('');
  } else recSec.style.display = 'none';
  document.getElementById('rd-history').innerHTML = reports.map(r =>
    \`<tr><td>\${new Date(r.runAt).toLocaleString()}</td><td>\${r.versionName}</td>
     <td>\${healthPill(r.analysis.overallHealth)}</td>
     <td>\${r.analysis.readiness || 0}%</td>
     <td>\${feasibilityPill(r.analysis.releaseFeasibility)}</td>
     <td>\${r.analysis.stats.done}</td><td>\${r.analysis.stats.total}</td></tr>\`).join('');
  panel.scrollIntoView({ behavior:'smooth', block:'start' });
}

async function runAllReleases() {
  await triggerRun('/api/release/run', {all:true}, 'rl-spinner', 'rl-status', async()=>{
    await loadReleases();
    if (selectedRelease) await selectRelease(selectedRelease.projectKey, selectedRelease.versionName);
  });
}
async function runSelectedRelease() {
  if (!selectedRelease) return;
  await triggerRun('/api/release/run', selectedRelease, 'rl-spinner', 'rl-status', async()=>{
    await loadReleases();
    await selectRelease(selectedRelease.projectKey, selectedRelease.versionName);
  });
}

// ── Sub-tab switching (inside set detail) ────────────────────────────────
function showSubTab(id, tab) {
  ['overview','byversion','byproject','byteam','tickets'].forEach(p => {
    document.getElementById('subpanel-' + p).style.display = p === id ? 'block' : 'none';
  });
  document.querySelectorAll('.subtab').forEach(t => {
    t.style.color = '#64748b'; t.style.borderBottomColor = 'transparent';
  });
  tab.style.color = '#0f172a'; tab.style.borderBottomColor = '#0f172a';
}

// ── RELEASE SETS ──────────────────────────────────────────────────────────
let selectedSetName = null;

async function loadReleaseSets() {
  const res  = await fetch('/api/release-sets');
  const data = await res.json();
  const grid = document.getElementById('sets-grid');
  if (!data.length) { grid.innerHTML = '<div class="empty">No release set reports yet. Click "Run all release sets" to start.</div>'; return; }
  grid.innerHTML = data.map(s => {
    const pct   = s.readiness || 0;
    const color = pct >= 80 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#ef4444';
    const ran   = s.latestRun ? new Date(s.latestRun).toLocaleString() : 'Never';
    return \`<div class="card \${selectedSetName === s.setName ? 'selected' : ''}" onclick="selectSet('\${s.setName}')">
      <div class="card-name">\${s.setName}</div>
      <div class="card-sub" style="font-size:12px">\${s.versionNames?.join(', ') || '—'}</div>
      \${healthPill(s.health)}
      \${s.feasibility ? \`<span class="feasibility-pill" style="margin-left:4px">\${s.feasibility}</span>\` : ''}
      <div class="readiness-track" style="margin-top:10px">
        <div class="readiness-fill" style="width:\${pct}%;background:\${color}"></div>
      </div>
      <div class="readiness-label">\${pct}% ready</div>
      <div class="card-stats">
        <span><strong>\${s.done}</strong>/\${s.totalIssues} done</span>
        <span><strong>\${s.projectCount}</strong> projects</span>
        <span><strong>\${s.teamCount}</strong> teams</span>
        \${s.crossBlockers ? \`<span><strong>\${s.crossBlockers}</strong> cross-blockers</span>\` : ''}
      </div>
      <div style="font-size:11px;color:#94a3b8;margin-top:8px">Last run: \${ran}</div>
    </div>\`;
  }).join('');
}

async function selectSet(setName) {
  selectedSetName = setName;
  document.getElementById('btn-run-set').disabled = false;
  await loadReleaseSets();
  const res = await fetch(\`/api/release-sets/\${encodeURIComponent(setName)}\`);
  if (!res.ok) return;
  renderSetDetail(setName, await res.json());
}

function renderSetDetail(setName, reports) {
  const panel  = document.getElementById('set-detail');
  const latest = reports[0];
  const a      = latest.analysis;
  panel.classList.add('visible');

  document.getElementById('setd-title').textContent   = a.setName;
  document.getElementById('setd-meta').textContent    =
    \`Versions: \${(latest.versionNames||[]).join(', ')} · Last run: \${new Date(latest.runAt).toLocaleString()}\`;
  document.getElementById('setd-health').innerHTML    = healthPill(a.overallHealth);
  document.getElementById('setd-readiness').innerHTML =
    \`<div class="readiness-bar-lg"><div class="track"><div class="fill" style="width:\${a.readiness||0}%;background:\${(a.readiness||0)>=80?'#10b981':(a.readiness||0)>=50?'#f59e0b':'#ef4444'}"></div></div><div class="pct">\${a.readiness||0}% ready · \${a.releaseFeasibility||''}</div></div>\`;
  document.getElementById('setd-summary').textContent = a.summary;

  const s = a.stats;
  document.getElementById('setd-stats').innerHTML = [
    \`<div class="stat-pill"><div class="label">Total</div><div class="value">\${s.total}</div></div>\`,
    \`<div class="stat-pill"><div class="label">Done</div><div class="value" style="color:#10b981">\${s.done}</div></div>\`,
    \`<div class="stat-pill"><div class="label">In progress</div><div class="value" style="color:#f59e0b">\${s.inProgress}</div></div>\`,
    \`<div class="stat-pill"><div class="label">Not started</div><div class="value" style="color:\${s.notStarted>0?'#ef4444':'#0f172a'}">\${s.notStarted}</div></div>\`,
    \`<div class="stat-pill"><div class="label">Projects</div><div class="value">\${s.projectCount}</div></div>\`,
    \`<div class="stat-pill"><div class="label">Teams</div><div class="value">\${s.teamCount}</div></div>\`,
  ].join('');

  // Overview: cross-project blockers + recommendations
  document.getElementById('setd-crossblockers').innerHTML = a.crossProjectBlockers?.length
    ? \`<h3 style="font-size:14px;font-weight:600;margin-bottom:10px">🚧 Cross-project blockers</h3>\` +
      a.crossProjectBlockers.map(b => \`<div class="issue-row">
        <div><span class="issue-key">[<strong>\${b.projectKey}</strong>] \${b.issueKey}</span></div>
        <div class="issue-title">\${b.title}</div>
        <div class="issue-sub">Impact: \${b.impact}</div>
        <div class="issue-action">💡 \${b.suggestedAction}</div>
      </div>\`).join('') : '<div style="color:#94a3b8;font-size:14px">No cross-project blockers.</div>';

  document.getElementById('setd-recs').innerHTML = (a.recommendations||[]).map(r => \`<li>\${r}</li>\`).join('');

  // By version
  document.getElementById('setd-byversion').innerHTML = (a.byVersion||[]).length
    ? \`<table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="border-bottom:2px solid #e2e8f0">
          <th style="text-align:left;padding:8px 12px;color:#64748b;font-weight:500">Fix version</th>
          <th style="text-align:left;padding:8px 12px;color:#64748b;font-weight:500;min-width:150px">Readiness</th>
          <th style="text-align:right;padding:8px 12px;color:#64748b;font-weight:500">Done</th>
          <th style="text-align:right;padding:8px 12px;color:#64748b;font-weight:500">In progress</th>
          <th style="text-align:right;padding:8px 12px;color:#64748b;font-weight:500">Not started</th>
          <th style="text-align:right;padding:8px 12px;color:#64748b;font-weight:500">Total</th>
          <th style="text-align:left;padding:8px 12px;color:#64748b;font-weight:500">Projects</th>
        </tr></thead>
        <tbody>\${(a.byVersion||[]).map(v => {
          const pct = v.readiness||0;
          const bc  = pct>=80?'#10b981':pct>=50?'#f59e0b':'#ef4444';
          return \`<tr style="border-bottom:1px solid #f1f5f9">
            <td style="padding:10px 12px;font-weight:600;color:#0f172a">\${v.version}</td>
            <td style="padding:10px 12px">
              <div style="display:flex;align-items:center;gap:8px">
                <div style="flex:1;background:#f1f5f9;border-radius:99px;height:6px;overflow:hidden">
                  <div style="background:\${bc};width:\${pct}%;height:100%;border-radius:99px"></div>
                </div>
                <span style="font-size:12px;color:#64748b">\${pct}%</span>
              </div>
            </td>
            <td style="padding:10px 12px;text-align:right;color:#10b981;font-weight:600">\${v.done}</td>
            <td style="padding:10px 12px;text-align:right;color:#f59e0b">\${v.inProgress}</td>
            <td style="padding:10px 12px;text-align:right;color:\${v.notStarted>0?'#ef4444':'#64748b'}">\${v.notStarted}</td>
            <td style="padding:10px 12px;text-align:right;font-weight:600;color:#0f172a">\${v.total}</td>
            <td style="padding:10px 12px;color:#64748b;font-size:12px">\${(v.projects||[]).join(', ')}</td>
          </tr>\`;
        }).join('')}</tbody>
      </table>\`
    : '<div style="color:#94a3b8;font-size:14px">No version data.</div>';

  // By project
  document.getElementById('setd-byproject').innerHTML = (a.byProject||[]).map(p => {
    const h = { Green:'#d1fae5', Yellow:'#fef9c3', Red:'#fee2e2' }[p.health] || '#f1f5f9';
    const t = { Green:'#065f46', Yellow:'#854d0e', Red:'#991b1b' }[p.health] || '#475569';
    const pct = p.readiness||0;
    const bc  = pct>=80?'#10b981':pct>=50?'#f59e0b':'#ef4444';
    return \`<div class="issue-row">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <strong style="font-size:15px">\${p.projectKey}</strong>
        <span style="background:\${h};color:\${t};padding:2px 10px;border-radius:99px;font-size:11px;font-weight:700">\${p.health}</span>
      </div>
      <div style="display:flex;align-items:center;gap:12px;margin:8px 0;flex-wrap:wrap">
        <div style="background:#f1f5f9;border-radius:99px;height:6px;width:140px;overflow:hidden">
          <div style="background:\${bc};width:\${pct}%;height:100%;border-radius:99px"></div>
        </div>
        <span style="font-size:12px;color:#64748b">\${pct}% · ✅ \${p.done}/\${p.total}</span>
      </div>
      \${p.blockers?.length ? \`<div style="font-size:12px;color:#ef4444">🚧 \${p.blockers.length} blocker(s)</div>\` : ''}
      \${p.criticalUnfinished?.length ? \`<div style="font-size:12px;color:#f59e0b">⛔ \${p.criticalUnfinished.length} critical unfinished</div>\` : ''}
      \${p.risks?.length ? \`<div style="font-size:12px;color:#64748b">⚠️ \${p.risks.length} risk(s)</div>\` : ''}
    </div>\`;
  }).join('') || '<div style="color:#94a3b8;font-size:14px">No project data.</div>';

  // By team
  document.getElementById('setd-byteam').innerHTML = (a.byTeam||[]).map(t => {
    const h  = { Green:'#d1fae5', Yellow:'#fef9c3', Red:'#fee2e2' }[t.health] || '#f1f5f9';
    const tc = { Green:'#065f46', Yellow:'#854d0e', Red:'#991b1b' }[t.health] || '#475569';
    const pct = t.readiness||0;
    const bc  = pct>=80?'#10b981':pct>=50?'#f59e0b':'#ef4444';
    return \`<div class="issue-row">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <strong style="font-size:15px">\${t.team}</strong>
        <span style="background:\${h};color:\${tc};padding:2px 10px;border-radius:99px;font-size:11px;font-weight:700">\${t.health}</span>
      </div>
      <div style="display:flex;align-items:center;gap:12px;margin:8px 0;flex-wrap:wrap">
        <div style="background:#f1f5f9;border-radius:99px;height:6px;width:140px;overflow:hidden">
          <div style="background:\${bc};width:\${pct}%;height:100%;border-radius:99px"></div>
        </div>
        <span style="font-size:12px;color:#64748b">\${pct}% · ✅ \${t.done}/\${t.total}</span>
      </div>
      \${t.projects?.length ? \`<div style="font-size:12px;color:#64748b">Projects: \${t.projects.join(', ')}</div>\` : ''}
      \${t.blockers?.length ? \`<div style="font-size:12px;color:#ef4444">🚧 \${t.blockers.length} blocker(s)</div>\` : ''}
    </div>\`;
  }).join('') || '<div style="color:#94a3b8;font-size:14px">No team data.</div>';

  // Tickets tab — only shown when team scope was active
  const ticketsTab = document.getElementById('subtab-tickets');
  if (a.tickets?.length) {
    ticketsTab.style.display = 'block';
    ticketsTab.textContent   = \`Tickets (\${a.tickets.length})\`;
    const catColor = cat => cat === 'done' ? '#10b981' : cat === 'indeterminate' ? '#f59e0b' : '#64748b';
    const priBg    = p => ({ Highest:'#fee2e2',High:'#fee2e2',Critical:'#fee2e2',Blocker:'#fee2e2',Medium:'#fef9c3',Low:'#dbeafe',Lowest:'#f1f5f9' }[p]||'#f1f5f9');
    const priColor = p => ({ Highest:'#991b1b',High:'#991b1b',Critical:'#991b1b',Blocker:'#991b1b',Medium:'#854d0e',Low:'#1e40af',Lowest:'#475569' }[p]||'#475569');
    document.getElementById('setd-tickets').innerHTML =
      \`<table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="border-bottom:2px solid #e2e8f0">
          <th style="text-align:left;padding:8px 12px;color:#64748b;font-weight:500">Key</th>
          <th style="text-align:left;padding:8px 12px;color:#64748b;font-weight:500">Summary</th>
          <th style="text-align:left;padding:8px 12px;color:#64748b;font-weight:500">Project</th>
          <th style="text-align:left;padding:8px 12px;color:#64748b;font-weight:500">Status</th>
          <th style="text-align:left;padding:8px 12px;color:#64748b;font-weight:500">Priority</th>
          <th style="text-align:left;padding:8px 12px;color:#64748b;font-weight:500">Assignee</th>
          <th style="text-align:left;padding:8px 12px;color:#64748b;font-weight:500">Team</th>
          <th style="text-align:left;padding:8px 12px;color:#64748b;font-weight:500">Fix versions</th>
        </tr></thead>
        <tbody>\${a.tickets.map(t => \`<tr style="border-bottom:1px solid #f1f5f9">
          <td style="padding:8px 12px;font-family:monospace;font-size:12px;font-weight:700;color:#3b82f6;white-space:nowrap">\${t.key}</td>
          <td style="padding:8px 12px;color:#1e293b;max-width:260px">\${t.summary}</td>
          <td style="padding:8px 12px;color:#64748b;font-size:12px">\${t.projectKey}</td>
          <td style="padding:8px 12px;white-space:nowrap">
            <span style="display:inline-flex;align-items:center;gap:4px">
              <span style="width:6px;height:6px;border-radius:50%;background:\${catColor(t.statusCategory)};display:inline-block"></span>
              <span style="font-size:12px;color:#334155">\${t.status}</span>
            </span>
          </td>
          <td style="padding:8px 12px">
            <span style="background:\${priBg(t.priority)};color:\${priColor(t.priority)};padding:1px 8px;border-radius:99px;font-size:11px;font-weight:600">\${t.priority}</span>
          </td>
          <td style="padding:8px 12px;color:#64748b;font-size:12px;white-space:nowrap">\${t.assignee}</td>
          <td style="padding:8px 12px;color:#64748b;font-size:12px">\${t.team}</td>
          <td style="padding:8px 12px;color:#64748b;font-size:12px">\${(t.fixVersions||[]).join(', ')}</td>
        </tr>\`).join('')}</tbody>
      </table>\`;
  } else {
    ticketsTab.style.display = 'none';
  }

  // History
  document.getElementById('setd-history').innerHTML = reports.map(r =>
    \`<tr>
      <td>\${new Date(r.runAt).toLocaleString()}</td>
      <td style="font-size:12px">\${(r.versionNames||[]).join(', ')}</td>
      <td>\${healthPill(r.analysis.overallHealth)}</td>
      <td>\${r.analysis.readiness||0}%</td>
      <td>\${r.analysis.stats.done}</td>
      <td>\${r.analysis.stats.total}</td>
      <td>\${r.analysis.stats.projectCount||'—'}</td>
      <td>\${r.analysis.stats.teamCount||'—'}</td>
    </tr>\`).join('');

  panel.scrollIntoView({ behavior:'smooth', block:'start' });
}

async function runAllSets() {
  await triggerRun('/api/release-set/run', {all:true}, 'rs-spinner', 'rs-status', async()=>{
    await loadReleaseSets();
    if (selectedSetName) await selectSet(selectedSetName);
  });
}
async function runSelectedSet() {
  if (!selectedSetName) return;
  await triggerRun('/api/release-set/run', {setName:selectedSetName}, 'rs-spinner', 'rs-status', async()=>{
    await loadReleaseSets();
    await selectSet(selectedSetName);
  });
}

// ── Boot ──────────────────────────────────────────────────────────────────
async function init() {
  await Promise.all([loadSprints(), loadReleases(), loadReleaseSets()]);
}
init();
setInterval(() => { loadSprints(); loadReleases(); loadReleaseSets(); }, 5 * 60 * 1000);
</script>
</body>
</html>`;
}
// ─────────────────────────────────────────────────────────────────────────────
// Start
// ─────────────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🖥  Sprint Dashboard running at http://localhost:${PORT}`);
  console.log(`   Press Ctrl+C to stop.\n`);
});

module.exports = app;
