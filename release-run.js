// release-run.js
// One-off CLI runner for release health — works on Windows, Mac, Linux
// Usage:
//   node release-run.js                        (uses JIRA_RELEASE_VERSIONS from .env)
//   node release-run.js --slack                (+ Slack)
//   node release-run.js --html                 (+ HTML report)
//   node release-run.js --slack --html         (all outputs)
require('dotenv').config();

const { runMultiVersionPipeline, getReleaseConfigFromEnv } = require('./src/release-pipeline');

const configs = getReleaseConfigFromEnv();

const opts = {
  console: true,
  slack:   process.argv.includes('--slack') || process.env.SEND_SLACK === 'true',
  html:    process.argv.includes('--html')  || process.env.SAVE_HTML_REPORT === 'true',
  store:   true,
};

console.log('\n🚀 Release Health Check');
configs.forEach(c => {
  const v = c.versions.length ? c.versions.join(', ') : 'all unreleased';
  console.log(`   ${c.projectKey}: ${v}`);
});
console.log(`   Slack: ${opts.slack ? '✅' : '—'}  HTML: ${opts.html ? '✅' : '—'}\n`);

async function run() {
  for (const { projectKey, versions } of configs) {
    await runMultiVersionPipeline(projectKey, versions, opts);
  }
}

run().catch(err => {
  console.error('\n❌ Error:', err.message);
  process.exit(1);
});
