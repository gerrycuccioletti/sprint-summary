// src/reporters/sprint-analytics-console.js
const HEALTH_COLOR = { Green: '\x1b[32m', Yellow: '\x1b[33m', Red: '\x1b[31m' };
const TREND_COLOR  = { improving: '\x1b[32m', stable: '\x1b[33m', declining: '\x1b[31m' };
const RESET = '\x1b[0m', BOLD = '\x1b[1m', DIM = '\x1b[97m'; // DIM replaced by bright white
const ACCENT = '\x1b[36m'; // cyan — team accent color
const c = (col, txt) => `${col}${txt}${RESET}`;

function bar(pct, width = 20) {
  const filled = Math.round(pct / (100 / width));
  const color  = pct >= 80 ? '\x1b[32m' : pct >= 60 ? '\x1b[33m' : '\x1b[31m';
  return `${color}${'█'.repeat(filled)}${'░'.repeat(width - filled)}${RESET} ${pct}%`;
}

function velocityBar(val, max, width = 15) {
  const filled = max > 0 ? Math.round((val / max) * width) : 0;
  return '█'.repeat(Math.min(filled, width)) + '░'.repeat(Math.max(0, width - filled));
}

function printSprintAnalyticsReport(analysis, boardId) {
  const hCol  = HEALTH_COLOR[analysis.sprintHealth] || '';
  const sprint = analysis.sprintReport;
  const comp   = analysis.completion;

  console.log('\n' + '═'.repeat(70));
  console.log(`${BOLD}  SPRINT ANALYTICS — ${analysis.displayName || `Board ${boardId}`}${RESET}`);
  console.log(`  ${DIM}${sprint.sprintName}  ·  ${sprint.startDate} → ${sprint.endDate}${RESET}`);
  if (sprint.sprintGoal) console.log(`  ${DIM}Goal: ${sprint.sprintGoal}${RESET}`);
  console.log('═'.repeat(70));

  // Health
  console.log(`\n  Health : ${c(hCol + BOLD, '● ' + analysis.sprintHealth)}`);
  console.log(`  ${DIM}${analysis.healthReason}${RESET}`);

  // Velocity
  if (analysis.velocityStats?.sprints?.length) {
    console.log(`\n${BOLD}Velocity (story points)${RESET}`);
    const sprints = analysis.velocityStats.sprints.slice(-6);
    const pv      = analysis.platformVelocity || [];

    sprints.forEach(s => {
      const pct    = s.committed > 0 ? Math.round((s.completed / s.committed) * 100) : 0;
      const filled = Math.min(15, s.committed > 0 ? Math.round((pct / 100) * 15) : 0);
      let completedBar;
      if (pct >= 100) {
        completedBar = '\x1b[92m' + '█'.repeat(15) + RESET;           // light green full bar
      } else {
        completedBar = '\x1b[32m' + '█'.repeat(filled)                // dark green completed
                     + '\x1b[33m' + '█'.repeat(15 - filled) + RESET;  // yellow remaining
      }
      console.log(`  ${ACCENT}${s.sprintName.substring(0, 20).padEnd(20)}${RESET}  ${completedBar}  ${s.completed}/${s.committed}pts  ${pct}%`);
      // Per-platform breakdown
      const sprintId      = String(s.sprintId);
      const platformLines = pv
        .filter(p => p.bySprint[sprintId] != null)
        .map(p => `${p.platform}: ${p.bySprint[sprintId]}pts`);
      if (platformLines.length) {
        console.log(`  ${''.padEnd(20)}  ${DIM}${platformLines.join('  ')}${RESET}`);
      }
    });
    const trend = analysis.velocityStats.trend;
    console.log(`\n  Avg: ${analysis.velocityStats.avg} pts  ·  Trend: ${c(TREND_COLOR[trend] || '', trend)}  ·  Predicted: ${analysis.predictedVelocity} pts`);
    console.log(`  ${DIM}${analysis.velocityAssessment}${RESET}`);
  }

  // Average velocity by platform
  if (analysis.platformVelocity?.length) {
    const maxAvg = Math.max(...analysis.platformVelocity.map(p => p.avg), 1);
    console.log(`\n${BOLD}Average velocity by platform (last ${analysis.platformVelocity[0]?.sprintCount || 'N'} sprints)${RESET}`);
    analysis.platformVelocity.forEach(p => {
      const filled = Math.round((p.avg / maxAvg) * 15);
      const bar_   = c('\x1b[36m', '█'.repeat(filled)) + '\x1b[97m' + '░'.repeat(15 - filled) + RESET;
      console.log(`  ${ACCENT}${p.platform.padEnd(20)}${RESET} ${bar_} ${String(p.avg).padStart(4)}pts avg`);
    });
  }

  // Sprint Data
  // For closed sprints: initial = completed + notCompleted + removed + completedOutside - added
  // For active sprints: completedOutside is not meaningful — omit it
  const isClosed = sprint.state === 'closed';

  const addedIssues   = sprint.addedDuringSprintCount || 0;
  const addedPoints   = sprint.addedDuringSprintPoints || 0;
  const removedIssues = sprint.removedIssues?.length || 0;
  const removedPoints = sprint.removedPoints || 0;

  const initialIssues = (sprint.completedIssues.length
    + (sprint.incompletedIssues?.length || 0)
    + removedIssues
    + (isClosed ? (sprint.completedOutsideIssues?.length || 0) : 0))
    - addedIssues;

  const initialPoints = (sprint.completedPoints || 0)
    + (sprint.incompletedPoints || 0)
    + removedPoints
    + (isClosed ? (sprint.completedOutsidePoints || 0) : 0)
    - addedPoints;

  // Remaining = current scope still in sprint (completed + not completed)
  const remainingIssues = sprint.completedIssues.length + (sprint.incompletedIssues?.length || 0);
  const remainingPoints = (sprint.completedPoints || 0) + (sprint.incompletedPoints || 0);

  console.log(`\n${BOLD}Sprint data${RESET}`);
  console.log(`  📌 Initial commitment   ${initialIssues} issues · ${initialPoints}pts`);
  console.log(`  ➕ Added during sprint  ${addedIssues} issues · ${addedPoints}pts`);
  console.log(`  🗑️  Removed from sprint  ${removedIssues} issues · ${removedPoints}pts`);
  console.log(`  📊 Remaining in sprint  ${remainingIssues} issues · ${remainingPoints}pts`);

  // Issue categories
  console.log(`\n${BOLD}Issue categories${RESET}`);
  console.log(`  ${c('\x1b[32m', '✅ Completed in sprint  ')} ${sprint.completedIssues.length} issues · ${sprint.completedPoints}pts`);
  console.log(`  ${c('\x1b[33m', '⚠️  Not completed       ')} ${sprint.incompletedIssues?.length || 0} issues · ${sprint.incompletedPoints || 0}pts`);
  console.log(`  ${c('\x1b[36m', '🔄 Completed outside   ')} ${sprint.completedOutsideIssues?.length || 0} issues · ${sprint.completedOutsidePoints || 0}pts`);

  // Completion
  console.log(`\n${BOLD}Completion${RESET}`);
  console.log(`  Issues : ${bar(comp.pct)}   (${comp.completed}/${comp.total})`);
  console.log(`  Points : ${bar(comp.ptsPct)}   (${comp.completedPts}/${comp.totalPts})`);
  if (comp.completedOutside > 0) console.log(`  ${DIM}(includes ${comp.completedOutside} issue(s) completed outside sprint)${RESET}`);

  // Time elapsed
  if (sprint.startDate && sprint.endDate) {
    const start   = new Date(sprint.startDate).getTime();
    const end     = new Date(sprint.endDate).getTime();
    const now     = Date.now();
    const elapsed = Math.min(100, Math.max(0, Math.round(((now - start) / (end - start)) * 100)));
    const daysTotal   = Math.round((end - start) / 86400000);
    const daysElapsed = Math.min(daysTotal, Math.max(0, Math.round((now - start) / 86400000)));
    const timeColor   = elapsed > comp.pct + 15 ? '\x1b[31m' : elapsed > comp.pct + 5 ? '\x1b[33m' : '\x1b[32m';
    console.log(`  Time   : ${bar(elapsed)}   (${daysElapsed}/${daysTotal} days) ${c(timeColor, elapsed > comp.pct ? '⚠️ ahead of work' : '✅ pacing well')}`);

  }

  // Analysis — closed sprints only
  if (sprint.state === 'closed' && analysis.analysis) {
    const a = analysis.analysis;
    console.log(`\n${BOLD}Analysis${RESET}`);
    if (a.scopeChanges)    console.log(`  Scope     : ${DIM}${a.scopeChanges}${RESET}`);
    if (a.velocityInsight) console.log(`  Velocity  : ${DIM}${a.velocityInsight}${RESET}`);
    if (a.carryoverImpact) console.log(`  Carryover : ${DIM}${a.carryoverImpact}${RESET}`);
    if (a.whatWentWell?.length) {
      console.log(`\n  ${BOLD}What went well${RESET}`);
      a.whatWentWell.forEach(w => console.log(`  ${c('\x1b[32m', '+')} ${w}`));
    }
    if (a.whatDidntGoWell?.length) {
      console.log(`\n  ${BOLD}What didn't go well${RESET}`);
      a.whatDidntGoWell.forEach(w => console.log(`  ${c('\x1b[31m', '−')} ${w}`));
    }
    if (a.retrospectiveActions?.length) {
      console.log(`\n  ${BOLD}Retrospective actions${RESET}`);
      a.retrospectiveActions.forEach(r => console.log(`  • ${r}`));
    }
  }

  // Risks — active sprints only
  if (sprint.state !== 'closed' && analysis.risks?.length) {
    console.log(`\n${BOLD}Risks${RESET}`);
    const rCol = { High: '\x1b[31m', Medium: '\x1b[33m', Low: '\x1b[36m' };
    analysis.risks.forEach(r => console.log(`  ${c(rCol[r.level] || '', `[${r.level}]`)} ${r.description}`));
  }

  // Recommendations — active sprints only
  if (sprint.state !== 'closed' && analysis.recommendations?.length) {
    console.log(`\n${BOLD}Recommendations${RESET}`);
    analysis.recommendations.forEach(r => console.log(`  • ${r}`));
  }

  console.log('\n' + '═'.repeat(70) + '\n');
}

module.exports = { printSprintAnalyticsReport };
