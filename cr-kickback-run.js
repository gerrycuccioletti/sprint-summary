// cr-kickback-run.js
// Usage:
//   node cr-kickback-run.js --from 2026-01-01 --to 2026-01-31
//   node cr-kickback-run.js --from 2026-01-01 --to 2026-01-31 --slack
require('dotenv').config();

const { runCRKickbackPipeline } = require('./src/cr-kickback-pipeline');

function parseArg(flag) {
  const args = process.argv.slice(2);
  const idx  = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
}

const fromDate = parseArg('--from');
const toDate   = parseArg('--to');

if (!fromDate || !toDate) {
  console.error('❌ Usage: node cr-kickback-run.js --from YYYY-MM-DD --to YYYY-MM-DD [--slack]');
  console.error('   Example: node cr-kickback-run.js --from 2026-01-01 --to 2026-01-31');
  process.exit(1);
}

// Validate date format
const dateRe = /^\d{4}-\d{2}-\d{2}$/;
if (!dateRe.test(fromDate) || !dateRe.test(toDate)) {
  console.error('❌ Dates must be in YYYY-MM-DD format');
  process.exit(1);
}

if (new Date(fromDate) > new Date(toDate)) {
  console.error('❌ --from date must be before --to date');
  process.exit(1);
}

const opts = {
  console: true,
  slack:   process.argv.includes('--slack') || process.env.SEND_SLACK === 'true',
};

const projects = (process.env.CR_KICKBACK_PROJECTS
               || process.env.JIRA_PROJECT_KEYS
               || process.env.JIRA_PROJECT_KEY
               || '').split(',').map(p => p.trim()).filter(Boolean);

console.log('\n📊 CR Kickback Ratio Report');
console.log(`   Period   : ${fromDate} → ${toDate}`);
console.log(`   Projects : ${projects.join(', ') || '(none defined — set CR_KICKBACK_PROJECTS in .env)'}`);
console.log(`   Slack    : ${opts.slack ? '✅' : '—'}\n`);

runCRKickbackPipeline(fromDate, toDate, opts)
  .then(() => {
    console.log('✅ CR Kickback report complete.\n');
  })
  .catch(err => {
    console.error('\n❌ Error:', err.message);
    process.exit(1);
  });
