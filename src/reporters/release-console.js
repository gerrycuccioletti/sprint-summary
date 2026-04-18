// src/reporters/release-console.js
// Color terminal output for release health reports

const HEALTH_COLOR = { Green: '\x1b[32m', Yellow: '\x1b[33m', Red: '\x1b[31m' };
const RISK_COLOR   = { High: '\x1b[31m', Medium: '\x1b[33m', Low: '\x1b[36m' };
const RESET = '\x1b[0m', BOLD = '\x1b[1m', DIM = '\x1b[2m';

const c = (color, text) => `${color}${text}${RESET}`;

function readinessBar(pct) {
  const filled = Math.round(pct / 5);
  const bar    = '█'.repeat(filled) + '░'.repeat(20 - filled);
  const color  = pct >= 80 ? '\x1b[32m' : pct >= 50 ? '\x1b[33m' : '\x1b[31m';
  return `${color}${bar}${RESET} ${pct}%`;
}

function printReleaseReport(analysis, version) {
  const hColor = HEALTH_COLOR[analysis.overallHealth] || '';

  console.log('\n' + '═'.repeat(60));
  console.log(`${BOLD}  RELEASE HEALTH REPORT${RESET}`);
  console.log(`  ${DIM}${analysis.releaseName}${analysis.releaseDate ? ' · Target: ' + analysis.releaseDate : ''}${RESET}`);
  console.log('═'.repeat(60));

  console.log(`\n  Health      : ${c(hColor + BOLD, '● ' + analysis.overallHealth)}`);
  console.log(`  Feasibility : ${c(BOLD, analysis.releaseFeasibility || '—')}`);
  console.log(`  ${DIM}${analysis.healthReason}${RESET}`);

  console.log(`\n  Readiness   : ${readinessBar(analysis.readiness || 0)}`);

  console.log(`\n${BOLD}Summary${RESET}`);
  console.log(`  ${analysis.summary}`);

  console.log(`\n${BOLD}Issue breakdown${RESET}`);
  const s = analysis.stats;
  console.log(`  Total      : ${s.total}`);
  console.log(`  Done       : ${c('\x1b[32m', s.done)}`);
  console.log(`  In progress: ${s.inProgress}`);
  console.log(`  Not started: ${c(s.notStarted > 0 ? '\x1b[33m' : '', s.notStarted)}`);
  if (s.unassigned > 0) console.log(`  ${c('\x1b[33m', `⚠  ${s.unassigned} unassigned`)}`);

  if (analysis.blockers?.length) {
    console.log(`\n${BOLD}🚧 Blockers${RESET}`);
    analysis.blockers.forEach(b => {
      console.log(`  ${c('\x1b[31m', b.issueKey)} — ${b.title}`);
      console.log(`    ${DIM}${b.suggestedAction}${RESET}`);
    });
  }

  if (analysis.criticalUnfinished?.length) {
    console.log(`\n${BOLD}⛔ Critical unfinished${RESET}`);
    analysis.criticalUnfinished.forEach(i => {
      console.log(`  ${c('\x1b[31m', i.issueKey)} [${i.priority}] ${i.title}`);
      console.log(`    ${DIM}Status: ${i.status} · ${i.assignee}${RESET}`);
    });
  }

  if (analysis.risks?.length) {
    console.log(`\n${BOLD}⚠  Risks${RESET}`);
    analysis.risks.forEach(r => {
      console.log(`  ${c(RISK_COLOR[r.level] || '', `[${r.level}]`)} ${r.issueKey} — ${r.title}`);
      console.log(`    ${DIM}${r.reason}${RESET}`);
    });
  }

  if (analysis.recommendations?.length) {
    console.log(`\n${BOLD}💡 Recommendations${RESET}`);
    analysis.recommendations.forEach(r => console.log(`  • ${r}`));
  }

  console.log('\n' + '═'.repeat(60) + '\n');
}

module.exports = { printReleaseReport };
