// release-set-run.js
require('dotenv').config();

const fs   = require('fs');
const path = require('path');
const { getReleaseSetConfigs, runReleaseSetPipeline } = require('./src/release-set-pipeline');

const opts = {
  console: true,
  slack:   process.argv.includes('--slack') || process.env.SEND_SLACK === 'true',
  html:    process.argv.includes('--html')  || process.env.SAVE_HTML_REPORT === 'true',
  store:   true,
};

// Resolve pattern: env var first, then ./patterns/{setName}.txt file
function resolvePattern(setName) {
  const fromEnv = (process.env[`RELEASE_SET_${setName}_PATTERN`] || '').trim();
  if (fromEnv) {
    console.log(`   [${setName}] Pattern source: env var`);
    return fromEnv;
  }
  const filePath = path.resolve(__dirname, 'patterns', `${setName}.txt`);
  console.log(`   [${setName}] Looking for pattern file: ${filePath}`);
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, 'utf8').trim();
    if (content) {
      console.log(`   [${setName}] Pattern loaded from file.`);
      return content;
    }
    console.log(`   [${setName}] Pattern file is empty.`);
  } else {
    console.log(`   [${setName}] Pattern file not found.`);
  }
  return null;
}

let configs;
try { configs = getReleaseSetConfigs(); } catch (err) {
  console.error('\n❌', err.message); process.exit(1);
}

// Attach resolved pattern only if no explicit version list is defined
configs = configs.map(c => ({
  ...c,
  pattern: c.versionNames.length > 0
    ? null                          // list mode — ignore any pattern
    : (c.pattern || resolvePattern(c.setName)), // pattern mode — check env then file
}));

console.log('\n🚀 Release Set Health Check');
configs.forEach(c => {
  if (c.pattern) {
    console.log(`   ${c.setName}: [pattern] ${c.pattern.substring(0, 60)}${c.pattern.length > 60 ? '...' : ''}`);
  } else {
    console.log(`   ${c.setName}: ${c.versionNames.join(', ')}`);
  }
});
console.log(`   Slack: ${opts.slack ? '✅' : '—'}  HTML: ${opts.html ? '✅' : '—'}\n`);

async function run() {
  for (const { setName, versionNames, pattern, jqlClause } of configs) {
    if (!jqlClause && !pattern && !versionNames.length) {
      console.error(`❌ [${setName}] No versions, JQL clause, or pattern defined.`);
      process.exit(1);
    }
    await runReleaseSetPipeline(setName, versionNames, opts, pattern, jqlClause);
  }
}

run().catch(err => { console.error('\n❌ Error:', err.message); process.exit(1); });
