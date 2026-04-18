// src/reporters/release-set-console.js
const HEALTH_COLOR = { Green: '\x1b[32m', Yellow: '\x1b[33m', Red: '\x1b[31m' };
const RESET = '\x1b[0m', BOLD = '\x1b[1m', DIM = '\x1b[2m';
const c = (col, txt) => `${col}${txt}${RESET}`;

function bar(pct, width = 20) {
  const filled = Math.round(pct / (100 / width));
  const color  = pct >= 80 ? '\x1b[32m' : pct >= 50 ? '\x1b[33m' : '\x1b[31m';
  return `${color}${'█'.repeat(filled)}${'░'.repeat(width - filled)}${RESET} ${pct}%`;
}

function healthDot(h) {
  const col = HEALTH_COLOR[h] || '';
  return c(col + BOLD, `● ${h}`);
}

function printTable(rows, cols) {
  const widths = cols.map((col, i) => Math.max(col.length, ...rows.map(r => String(r[i] ?? '').length)));
  const hr     = '─'.repeat(widths.reduce((s, w) => s + w + 3, 1));
  const fmt    = row => '│ ' + cols.map((_, i) => String(row[i] ?? '').padEnd(widths[i])).join(' │ ') + ' │';
  console.log('┌' + hr + '┐');
  console.log(fmt(cols));
  console.log('├' + hr + '┤');
  rows.forEach(r => console.log(fmt(r)));
  console.log('└' + hr + '┘');
}

function printReleaseSetReport(analysis) {
  const hCol = HEALTH_COLOR[analysis.overallHealth] || '';

  console.log('\n' + '═'.repeat(70));
  console.log(`${BOLD}  RELEASE SET: ${analysis.setName}${RESET}`);
  console.log(`  ${DIM}Fix versions: ${(analysis.versionNames || []).join(', ')}${RESET}`);
  console.log('═'.repeat(70));

  console.log(`\n  Health      : ${healthDot(analysis.overallHealth)}`);
  console.log(`  Feasibility : ${c(BOLD, analysis.releaseFeasibility || '—')}`);
  console.log(`  ${DIM}${analysis.healthReason}${RESET}`);
  console.log(`\n  Readiness   : ${bar(analysis.readiness || 0)}`);

  const s = analysis.stats;
  console.log(`\n  Issues: ${s.total} total · ${c('\x1b[32m', s.done + ' done')} · ${s.inProgress} in progress · ${s.notStarted} not started`);
  console.log(`  Scope : ${s.projectCount} project(s) · ${s.teamCount} team(s)`);

  console.log(`\n${BOLD}Summary${RESET}`);
  console.log(`  ${analysis.summary}`);

  // ── By version ────────────────────────────────────────────────────────────
  if (analysis.byVersion?.length) {
    console.log(`\n${BOLD}By fix version${RESET}`);
    printTable(
      analysis.byVersion.map(v => [
        v.version,
        bar(v.readiness || 0, 10),
        `${v.done}/${v.total}`,
        v.inProgress,
        v.notStarted,
        (v.projects || []).join(', '),
      ]),
      ['Fix version', 'Readiness', 'Done/Total', 'In progress', 'Not started', 'Projects'],
    );
  }

  // ── By project ───────────────────────────────────────────────────────────
  if (analysis.byProject?.length) {
    console.log(`\n${BOLD}By project${RESET}`);
    printTable(
      analysis.byProject.map(p => [
        p.projectKey,
        healthDot(p.health),
        bar(p.readiness || 0, 10),
        `${p.done}/${p.total}`,
        p.blockers?.length || 0,
        p.risks?.length || 0,
        p.criticalUnfinished?.length || 0,
      ]),
      ['Project', 'Health', 'Readiness', 'Done/Total', 'Blockers', 'Risks', 'Critical'],
    );
  }

  // ── By team ───────────────────────────────────────────────────────────────
  if (analysis.byTeam?.length) {
    console.log(`\n${BOLD}By team${RESET}`);
    printTable(
      analysis.byTeam.map(t => [
        t.team,
        healthDot(t.health),
        bar(t.readiness || 0, 10),
        `${t.done}/${t.total}`,
        (t.projects || []).join(', '),
        t.blockers?.length || 0,
      ]),
      ['Team', 'Health', 'Readiness', 'Done/Total', 'Projects', 'Blockers'],
    );
  }

  // ── Ticket list (shown when team scope is active) ─────────────────────
  if (analysis.tickets?.length) {
    console.log(`\n${BOLD}Tickets (${analysis.tickets.length})${RESET}`);
    printTable(
      analysis.tickets.map(t => [
        t.key,
        t.projectKey,
        t.status,
        t.priority,
        t.assignee,
        t.team,
        t.fixVersions.join(', '),
      ]),
      ['Key', 'Project', 'Status', 'Priority', 'Assignee', 'Team', 'Fix versions'],
    );
  }

  // ── Cross-project blockers ────────────────────────────────────────────────
  if (analysis.crossProjectBlockers?.length) {
    console.log(`\n${BOLD}🚧 Cross-project blockers${RESET}`);
    analysis.crossProjectBlockers.forEach(b => {
      console.log(`  ${c('\x1b[31m', `[${b.projectKey}] ${b.issueKey}`)} — ${b.title}`);
      console.log(`    ${DIM}Impact: ${b.impact}${RESET}`);
      console.log(`    ${DIM}Action: ${b.suggestedAction}${RESET}`);
    });
  }

  // ── Recommendations ───────────────────────────────────────────────────────
  if (analysis.recommendations?.length) {
    console.log(`\n${BOLD}💡 Recommendations${RESET}`);
    analysis.recommendations.forEach(r => console.log(`  • ${r}`));
  }

  console.log('\n' + '═'.repeat(70) + '\n');
}

module.exports = { printReleaseSetReport };
