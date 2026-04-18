// src/index.js
// Sprint Summary — one-off CLI runner (supports multi-board)
require('dotenv').config();

const { runMultiBoard, getBoardIdsFromEnv } = require('./pipeline');

const boardIds = getBoardIdsFromEnv();

const opts = {
  console: true,
  slack:   process.argv.includes('--slack') || process.env.SEND_SLACK === 'true',
  html:    process.argv.includes('--html')  || process.env.SAVE_HTML_REPORT === 'true',
  store:   true,
};

console.log(`\n🚀 Running sprint summary for ${boardIds.length} board(s): ${boardIds.join(', ')}`);
console.log(`   Slack: ${opts.slack ? '✅' : '—'}  HTML: ${opts.html ? '✅' : '—'}\n`);

runMultiBoard(boardIds, opts)
  .then((results) => {
    const failed = results.filter(r => r.error);
    if (failed.length) {
      console.error(`\n⚠️  ${failed.length} board(s) failed:`);
      failed.forEach(r => console.error(`   Board ${r.boardId}: ${r.error}`));
      process.exit(1);
    }
    console.log('\n✅ All boards complete.\n');
  })
  .catch((err) => {
    console.error('\n❌ Fatal error:', err.message);
    if (err.response) {
      console.error('   API response:', err.response.status, JSON.stringify(err.response.data));
    }
    process.exit(1);
  });
