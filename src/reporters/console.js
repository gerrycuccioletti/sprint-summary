// src/reporters/console.js
// Pretty console output for sprint analysis

const HEALTH_COLORS = {
  Green:  '\x1b[32m',
  Yellow: '\x1b[33m',
  Red:    '\x1b[31m',
};
const RISK_COLORS = {
  High:   '\x1b[31m',
  Medium: '\x1b[33m',
  Low:    '\x1b[36m',
};
const RESET = '\x1b[0m';
const BOLD  = '\x1b[1m';
const DIM   = '\x1b[2m';

function colorize(color, text) {
  return `${color}${text}${RESET}`;
}

function printConsoleReport(analysis, sprint) {
  const hColor = HEALTH_COLORS[analysis.overallHealth] || '';

  console.log('\n' + '═'.repeat(60));
  console.log(`${BOLD}  SPRINT SUMMARY${RESET}`);
  console.log(`  ${DIM}${sprint.name}${RESET}`);
  console.log('═'.repeat(60));

  // Overall health badge
  console.log(`\n  Overall Health: ${colorize(hColor + BOLD, `● ${analysis.overallHealth}`)}`);
  console.log(`  ${DIM}${analysis.healthReason}${RESET}`);

  // Summary paragraph
  console.log(`\n${BOLD}Summary${RESET}`);
  console.log(`  ${analysis.summary}`);

  // Stats
  console.log(`\n${BOLD}Stats${RESET}`);
  console.log(`  Total issues : ${analysis.stats.total}`);
  if (analysis.stats.byStatus) {
    Object.entries(analysis.stats.byStatus).forEach(([status, count]) => {
      console.log(`  ${status.padEnd(20)} ${count}`);
    });
  }
  if (analysis.stats.unassigned > 0) {
    console.log(`  ${colorize('\x1b[33m', `⚠  ${analysis.stats.unassigned} unassigned issue(s)`)}`);
  }

  // Blockers
  if (analysis.blockers?.length > 0) {
    console.log(`\n${BOLD}🚧 Blockers${RESET}`);
    analysis.blockers.forEach((b) => {
      console.log(`  ${colorize('\x1b[31m', b.issueKey)} — ${b.title}`);
      console.log(`    ${DIM}Action: ${b.suggestedAction}${RESET}`);
    });
  }

  // Risks
  if (analysis.risks?.length > 0) {
    console.log(`\n${BOLD}⚠  Risks${RESET}`);
    analysis.risks.forEach((r) => {
      const rColor = RISK_COLORS[r.level] || '';
      console.log(`  ${colorize(rColor, `[${r.level}]`)} ${r.issueKey} — ${r.title}`);
      console.log(`    ${DIM}${r.reason}${RESET}`);
    });
  }

  // Workload warnings
  if (analysis.workloadWarnings?.length > 0) {
    console.log(`\n${BOLD}👥 Workload${RESET}`);
    analysis.workloadWarnings.forEach((w) => console.log(`  • ${w}`));
  }

  // Recommendations
  if (analysis.recommendations?.length > 0) {
    console.log(`\n${BOLD}💡 Recommendations${RESET}`);
    analysis.recommendations.forEach((r) => console.log(`  • ${r}`));
  }

  console.log('\n' + '═'.repeat(60) + '\n');
}

module.exports = { printConsoleReport };
