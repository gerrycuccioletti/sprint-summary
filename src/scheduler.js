// src/scheduler.js
require('dotenv').config();
const cron = require('node-cron');

const { runMultiBoard, getBoardIdsFromEnv }                  = require('./pipeline');
const { runMultiVersionPipeline, getReleaseConfigFromEnv }   = require('./release-pipeline');
const { runAllReleaseSets, getReleaseSetConfigs }            = require('./release-set-pipeline');

const CRON_SCHEDULE         = process.env.CRON_SCHEDULE         || '0 9 * * 1';
const RELEASE_CRON_SCHEDULE = process.env.RELEASE_CRON_SCHEDULE || CRON_SCHEDULE;
const SET_CRON_SCHEDULE     = process.env.SET_CRON_SCHEDULE     || RELEASE_CRON_SCHEDULE;
const boardIds              = getBoardIdsFromEnv();

const sharedOpts = {
  console: true,
  slack:   process.env.SEND_SLACK       !== 'false',
  html:    process.env.SAVE_HTML_REPORT === 'true',
  store:   true,
};

async function runSprintJob() {
  console.log(`\n[${new Date().toLocaleString()}] Sprint job — boards: ${boardIds.join(', ')}`);
  const results = await runMultiBoard(boardIds, sharedOpts);
  const failed  = results.filter(r => r.error);
  console.log(failed.length ? `${failed.length} board(s) failed.` : 'Sprint job complete.\n');
}

async function runReleaseJob() {
  let configs;
  try { configs = getReleaseConfigFromEnv(); } catch { return; }
  console.log(`\n[${new Date().toLocaleString()}] Release job starting...`);
  for (const { projectKey, versions } of configs) {
    await runMultiVersionPipeline(projectKey, versions, sharedOpts);
  }
  console.log('Release job complete.\n');
}

async function runReleaseSetJob() {
  let configs;
  try { configs = getReleaseSetConfigs(); } catch { return; }
  console.log(`\n[${new Date().toLocaleString()}] Release set job — sets: ${configs.map(c=>c.setName).join(', ')}`);
  await runAllReleaseSets(sharedOpts);
  console.log('Release set job complete.\n');
}

if (!cron.validate(CRON_SCHEDULE)) {
  console.error(`Invalid CRON_SCHEDULE: "${CRON_SCHEDULE}"`); process.exit(1);
}

console.log('Scheduler started');
console.log(`   Sprint schedule      : ${CRON_SCHEDULE}`);
console.log(`   Release schedule     : ${RELEASE_CRON_SCHEDULE}`);
console.log(`   Release set schedule : ${SET_CRON_SCHEDULE}`);
console.log(`   Boards  : ${boardIds.join(', ')}`);
console.log(`   Slack   : ${sharedOpts.slack ? 'on' : 'off'}\n`);

if (process.env.RUN_NOW === 'true') {
  runSprintJob(); runReleaseJob(); runReleaseSetJob();
}

cron.schedule(CRON_SCHEDULE,         runSprintJob,     { timezone: process.env.TZ || 'America/New_York' });
cron.schedule(RELEASE_CRON_SCHEDULE, runReleaseJob,    { timezone: process.env.TZ || 'America/New_York' });
cron.schedule(SET_CRON_SCHEDULE,     runReleaseSetJob, { timezone: process.env.TZ || 'America/New_York' });
