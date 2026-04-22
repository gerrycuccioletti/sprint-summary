// src/qa-kickback-pipeline.js
const { fetchAllProjectsQAKickback } = require('./qa-kickback-jira');
const { printQAKickbackReport }      = require('./reporters/qa-kickback-console');
const { sendQAKickbackSlack }        = require('./reporters/qa-kickback-slack');
const { generateKickbackExcel }        = require('./reporters/kickback-excel');

async function runQAKickbackPipeline(fromDate, toDate, opts = {}) {
  const options = { console: true, slack: false, ...opts };
  const label   = '[QAKickback]';

  console.log(`\n${label} Fetching QA transition data...`);
  console.log(`${label} Period: ${fromDate} → ${toDate}`);

  const results = await fetchAllProjectsQAKickback(fromDate, toDate);

  if (options.console) printQAKickbackReport(results, fromDate, toDate);

  if (options.slack) {
    console.log(`${label} Sending Slack report...`);
    await sendQAKickbackSlack(results, fromDate, toDate);
    console.log(`${label} Slack sent.`);
  }

  // Excel output
  try {
    const xlsxPath = generateKickbackExcel(results, fromDate, toDate, 'QA', './output');
    console.log(`${label} Excel saved: ${xlsxPath}`);
  } catch (err) {
    console.warn(`${label} Excel generation failed: ${err.message}`);
  }

  return results;
}

module.exports = { runQAKickbackPipeline };
