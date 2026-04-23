// release-set-run.js
// Usage:
//   node release-set-run.js                              → all release sets
//   node release-set-run.js --set 2026_R4               → specific release set
//   node release-set-run.js --project GAPP              → filter by project
//   node release-set-run.js --project GAPP,MOBILE       → filter by multiple projects
//   node release-set-run.js --set 2026_R4 --project GAPP → combined
//   node release-set-run.js --slack                     → with Slack output
//   node release-set-run.js --html                      → with HTML output
//   node release-set-run.js --dry-run                   → skip Claude API call
require('dotenv').config();

const fs   = require('fs');
const path = require('path');
const { getReleaseSetConfigs, runReleaseSetPipeline } = require('./src/release-set-pipeline');

function parseArg(flag) {
  const args = process.argv.slice(2);
  const idx  = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith('--')
    ? args[idx + 1]
    : null;
}

const setFilter     = parseArg('--set');
const projectFilter = parseArg('--project');
const opts = {
  console: true,
  slack:   process.argv.includes('--slack')    || process.env.SEND_SLACK          === 'true',
  html:    process.argv.includes('--html')     || process.env.SAVE_HTML_REPORT    === 'true',
  store:   true,
  dryRun:  process.argv.includes('--dry-run')  || process.env.RELEASE_SET_DRY_RUN === 'true',
};

if (opts.dryRun) process.env.RELEASE_SET_DRY_RUN = 'true';

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

// Filter by --set if provided
if (setFilter) {
  configs = configs.filter(c => c.setName.toLowerCase() === setFilter.toLowerCase());
  if (!configs.length) {
    console.error(`\n❌ Release set "${setFilter}" not found. Available sets: ${getReleaseSetConfigs().map(c => c.setName).join(', ')}`);
    process.exit(1);
  }
}

// Attach resolved pattern
configs = configs.map(c => ({
  ...c,
  pattern: c.versionNames.length > 0
    ? null
    : (c.pattern || resolvePattern(c.setName)),
}));

console.log('\n🚀 Release Set Health Check');
if (setFilter)     console.log(`   Set     : ${setFilter}`);
if (projectFilter) console.log(`   Project : ${projectFilter}`);
configs.forEach(c => {
  if (c.pattern) {
    console.log(`   ${c.setName}: [pattern] ${c.pattern.substring(0, 60)}${c.pattern.length > 60 ? '...' : ''}`);
  } else {
    console.log(`   ${c.setName}: ${c.versionNames.join(', ')}`);
  }
});
console.log(`   Slack   : ${opts.slack   ? '✅' : '—'}  HTML: ${opts.html ? '✅' : '—'}  Dry-run: ${opts.dryRun ? '✅' : '—'}\n`);

async function run() {
  for (const { setName, versionNames, pattern, jqlClause } of configs) {
    if (!jqlClause && !pattern && !versionNames.length) {
      console.error(`❌ [${setName}] No versions, JQL clause, or pattern defined.`);
      process.exit(1);
    }

    // Inject project filter into JQL clause if provided
    let effectiveJql = jqlClause;
    if (projectFilter) {
      const projects = projectFilter.split(',').map(p => p.trim()).filter(Boolean);
      const projectClause = projects.length === 1
        ? `project = "${projects[0]}"`
        : `project in (${projects.map(p => `"${p}"`).join(', ')})`;
      effectiveJql = effectiveJql
        ? `(${effectiveJql}) AND ${projectClause}`
        : projectClause;
    }

    await runReleaseSetPipeline(setName, versionNames, opts, pattern, effectiveJql);
  }
}

run().catch(err => { console.error('\n❌ Error:', err.message); process.exit(1); });
