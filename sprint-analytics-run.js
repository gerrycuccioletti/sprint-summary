// sprint-analytics-run.js
// Usage:
//   node sprint-analytics-run.js                                      → all teams/boards, last closed sprint
//   node sprint-analytics-run.js --team Mobile                        → team by name, last closed sprint
//   node sprint-analytics-run.js --board 1852                         → board by ID, last closed sprint
//   node sprint-analytics-run.js --team Mobile --sprint active        → team, active sprint
//   node sprint-analytics-run.js --board 1852 --sprint 9846           → board, sprint by ID
//   node sprint-analytics-run.js --team Mobile --sprint "TNDR 26 S08" → team, sprint by name
//   node sprint-analytics-run.js --slack --html                       → with Slack + HTML output
require('dotenv').config();

const { runMultiBoardAnalytics, runSprintAnalyticsPipeline,
        getAnalyticsBoardIds, resolveTeam } = require('./src/sprint-analytics-pipeline');

function parseArg(flag) {
  const args = process.argv.slice(2);
  const idx  = args.findIndex(a => a === flag);
  if (idx === -1) return null;
  const val = args[idx + 1];
  if (!val || val.startsWith('--')) {
    console.error(`❌ ${flag} requires a value`);
    process.exit(1);
  }
  return val;
}

const teamArg        = parseArg('--team');
const boardArg       = parseArg('--board');
const sprintSelector = parseArg('--sprint');

const opts = {
  console: true,
  slack:   process.argv.includes('--slack') || process.env.SEND_SLACK === 'true',
  html:    process.argv.includes('--html')  || process.env.SAVE_HTML_REPORT === 'true',
  store:   true,
};

const selectorLabel = !sprintSelector             ? 'last closed sprint'
                    : sprintSelector === 'active'  ? 'active sprint'
                    : /^\d+$/.test(sprintSelector) ? `sprint ID ${sprintSelector}`
                    : `sprint name "${sprintSelector}"`;

console.log('\n🔬 Sprint Analytics');

async function run() {
  // Single team by name
  if (teamArg) {
    let resolved;
    try { resolved = resolveTeam(teamArg); }
    catch (err) { console.error(`❌ ${err.message}`); process.exit(1); }
    console.log(`   Team    : ${resolved.teamName || teamArg} (Board ${resolved.boardId})`);
    console.log(`   Sprint  : ${selectorLabel}`);
    console.log(`   Slack   : ${opts.slack ? '✅' : '—'}  HTML: ${opts.html ? '✅' : '—'}\n`);
    await runSprintAnalyticsPipeline(resolved.boardId, opts, sprintSelector, resolved.teamName || teamArg);

  // Single board by ID
  } else if (boardArg) {
    const boardIds = boardArg.split(',').map(b => b.trim()).filter(Boolean);
    console.log(`   Boards  : ${boardIds.join(', ')} (from --board)`);
    console.log(`   Sprint  : ${selectorLabel}`);
    console.log(`   Slack   : ${opts.slack ? '✅' : '—'}  HTML: ${opts.html ? '✅' : '—'}\n`);
    await runMultiBoardAnalytics(boardIds, opts, sprintSelector);

  // All teams/boards from .env
  } else {
    const boardIds = getAnalyticsBoardIds();
    console.log(`   Boards  : ${boardIds.join(', ')}`);
    console.log(`   Sprint  : ${selectorLabel}`);
    console.log(`   Slack   : ${opts.slack ? '✅' : '—'}  HTML: ${opts.html ? '✅' : '—'}\n`);
    await runMultiBoardAnalytics(boardIds, opts, sprintSelector);
  }

  console.log('\n✅ Sprint analytics complete.\n');
}

run().catch(err => {
  console.error('\n❌ Error:', err.message);
  process.exit(1);
});
