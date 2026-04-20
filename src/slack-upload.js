// src/slack-upload.js
// Uploads PNG buffers to Slack via bot token and files.upload API

const axios    = require('axios');

async function uploadChartToSlack(pngBuffer, filename, title, channelId, token) {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  // Step 1: get upload URL
  const urlRes = await axios.post('https://slack.com/api/files.getUploadURLExternal',
    new URLSearchParams({ filename, length: pngBuffer.length }),
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!urlRes.data.ok) {
    throw new Error(`files.getUploadURLExternal failed: ${urlRes.data.error}`);
  }
  const { upload_url, file_id } = urlRes.data;

  // Step 2: upload the binary to the provided URL
  await axios.post(upload_url, pngBuffer, {
    headers: { 'Content-Type': 'application/octet-stream' },
    maxBodyLength: Infinity,
  });

  // Step 3: complete the upload and share to channel
  const completeRes = await axios.post('https://slack.com/api/files.completeUploadExternal', {
    files:      [{ id: file_id, title }],
    channel_id: channelId,
  }, { headers });

  if (!completeRes.data.ok) {
    throw new Error(`files.completeUploadExternal failed: ${completeRes.data.error}`);
  }
  return completeRes.data.files?.[0];
}

async function uploadAnalyticsCharts(analysis, boardId) {
  const token     = process.env.SLACK_BOT_TOKEN;
  const channelId = process.env[`SLACK_CHANNEL_BOARD_${boardId}`]
                 || process.env.SLACK_CHANNEL_ID;

  if (!token)     { console.warn('   [Charts] SLACK_BOT_TOKEN not set — skipping chart upload'); return; }
  if (!channelId) { console.warn('   [Charts] SLACK_CHANNEL_ID not set — skipping chart upload'); return; }

  const { renderVelocityChart, renderCompletionGauges, renderPlatformChart } = require('./sprint-analytics-charts');
  const vs  = analysis.velocityStats;
  const pv  = analysis.platformVelocity || [];
  const name = analysis.displayName || `Board ${boardId}`;
  const sprint = analysis.sprintReport.sprintName;

  const uploads = [];

  try {
    console.log(`   [Charts] Rendering velocity chart...`);
    const velBuf = await renderVelocityChart(vs?.sprints?.slice(-6) || []);
    uploads.push(uploadChartToSlack(velBuf, 'velocity.png', `${name} · ${sprint} — Velocity`, channelId, token));
  } catch (err) { console.warn(`   [Charts] Velocity render failed: ${err.message}`); }

  try {
    console.log(`   [Charts] Rendering completion gauges...`);
    const compBuf = await renderCompletionGauges(analysis.completion, name, sprint);
    uploads.push(uploadChartToSlack(compBuf, 'completion.png', `${name} · ${sprint} — Completion`, channelId, token));
  } catch (err) { console.warn(`   [Charts] Completion render failed: ${err.message}`); }

  if (pv.length) {
    try {
      console.log(`   [Charts] Rendering platform velocity chart...`);
      const platBuf = await renderPlatformChart(pv);
      if (platBuf) uploads.push(uploadChartToSlack(platBuf, 'platform.png', `${name} · ${sprint} — Platform velocity`, channelId, token));
    } catch (err) { console.warn(`   [Charts] Platform render failed: ${err.message}`); }
  }

  const results = await Promise.allSettled(uploads);
  const succeeded = results.filter(r => r.status === 'fulfilled').length;
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      console.warn(`   [Charts] Upload ${i + 1} failed: ${r.reason?.message || r.reason}`);
    }
  });
  console.log(`   [Charts] Uploaded ${succeeded}/${results.length} charts to Slack`);
}

module.exports = { uploadAnalyticsCharts };
