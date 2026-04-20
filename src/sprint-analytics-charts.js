// src/sprint-analytics-charts.js
// Renders sprint analytics charts to PNG buffers using @napi-rs/canvas

const { createCanvas } = require('@napi-rs/canvas');

const W = 800;
const FONT = 'sans-serif';
const COLORS = {
  committed:  '#93c5fd',
  completed:  '#10b981',
  grid:       '#e2e8f0',
  text:       '#64748b',
  textDark:   '#0f172a',
  bg:         '#ffffff',
  gauge:      '#10b981',
  gaugeRem:   '#f1f5f9',
  platforms:  ['#85B7EB','#AFA9EC','#5DCAA5','#FAC775','#F09595','#9FE1CB'],
};

function ctx2d(w, h) {
  const canvas = createCanvas(w, h);
  const ctx    = canvas.getContext('2d');
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, w, h);
  return { canvas, ctx };
}

// ── Velocity chart ────────────────────────────────────────────────────────
async function renderVelocityChart(velSprints = []) {
  const H = 360;
  const { canvas, ctx } = ctx2d(W, H);
  const padL = 55, padR = 20, padT = 30, padB = 60;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  const n = velSprints.length;
  if (!n) return canvas.toBuffer('image/png');

  const maxVal = Math.max(...velSprints.flatMap(s => [s.committed, s.completed]), 1);
  const yScale = v => padT + chartH - Math.round((v / maxVal) * chartH);

  // Grid lines
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  [0, 0.25, 0.5, 0.75, 1].forEach(f => {
    const y = padT + Math.round(f * chartH);
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
    const label = Math.round(maxVal * (1 - f));
    ctx.fillStyle = COLORS.text;
    ctx.font = `12px ${FONT}`;
    ctx.textAlign = 'right';
    ctx.fillText(label, padL - 6, y + 4);
  });

  // Bars
  const groupW = chartW / n;
  const barW   = Math.min(28, groupW * 0.35);
  const gap    = 4;

  velSprints.forEach((s, i) => {
    const cx  = padL + groupW * i + groupW / 2;
    const x1  = cx - barW - gap / 2;
    const x2  = cx + gap / 2;
    const y1  = yScale(s.committed);
    const y2  = yScale(s.completed);
    const h1  = H - padB - y1;
    const h2  = H - padB - y2;
    const pct = s.committed > 0 ? Math.round((s.completed / s.committed) * 100) : 0;

    ctx.fillStyle = COLORS.committed;
    ctx.beginPath(); ctx.roundRect(x1, y1, barW, h1, [3, 3, 0, 0]); ctx.fill();

    ctx.fillStyle = COLORS.completed;
    ctx.beginPath(); ctx.roundRect(x2, y2, barW, h2, [3, 3, 0, 0]); ctx.fill();

    // Sprint label
    ctx.fillStyle = COLORS.text;
    ctx.font = `11px ${FONT}`;
    ctx.textAlign = 'center';
    const label = s.sprintName.length > 10 ? s.sprintName.slice(-8) : s.sprintName;
    ctx.fillText(label, cx, H - padB + 16);

    // % label above completed bar
    ctx.fillStyle = COLORS.textDark;
    ctx.font = `bold 11px ${FONT}`;
    ctx.fillText(pct + '%', x2 + barW / 2, y2 - 5);
  });

  // Legend
  const legY = 12;
  ctx.fillStyle = COLORS.committed;
  ctx.fillRect(padL, legY, 12, 12);
  ctx.fillStyle = COLORS.text;
  ctx.font = `12px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.fillText('Committed', padL + 16, legY + 10);
  ctx.fillStyle = COLORS.completed;
  ctx.fillRect(padL + 100, legY, 12, 12);
  ctx.fillStyle = COLORS.text;
  ctx.fillText('Completed', padL + 116, legY + 10);

  // Baseline
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(padL, H - padB); ctx.lineTo(W - padR, H - padB); ctx.stroke();

  return canvas.toBuffer('image/png');
}

// ── Completion gauges ─────────────────────────────────────────────────────
async function renderCompletionGauges(comp, teamName, sprintName) {
  const H = 260;
  const { canvas, ctx } = ctx2d(W, H);

  // Title
  ctx.fillStyle = COLORS.textDark;
  ctx.font = `bold 15px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText(teamName || '', W / 2, 24);
  ctx.fillStyle = COLORS.text;
  ctx.font = `12px ${FONT}`;
  ctx.fillText(sprintName || '', W / 2, 42);

  function drawGauge(cx, cy, r, pct, label, sublabel) {
    const start  = Math.PI * 0.75;
    const end    = Math.PI * 2.25;
    const filled = start + (end - start) * (Math.min(pct, 100) / 100);

    ctx.beginPath(); ctx.arc(cx, cy, r, start, end);
    ctx.strokeStyle = COLORS.gaugeRem; ctx.lineWidth = 18; ctx.lineCap = 'round'; ctx.stroke();

    if (pct > 0) {
      ctx.beginPath(); ctx.arc(cx, cy, r, start, filled);
      ctx.strokeStyle = pct >= 80 ? '#10b981' : pct >= 60 ? '#f59e0b' : '#ef4444';
      ctx.lineWidth = 18; ctx.lineCap = 'round'; ctx.stroke();
    }

    ctx.fillStyle = COLORS.textDark;
    ctx.font = `bold 28px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(Math.round(pct) + '%', cx, cy + 8);
    ctx.fillStyle = COLORS.text;
    ctx.font = `12px ${FONT}`;
    ctx.fillText(label, cx, cy + 26);
    ctx.fillText(sublabel, cx, cy + r + 32);
  }

  drawGauge(200, 145, 75, comp.pct,    'Issues', `${comp.completed} / ${comp.total}`);
  drawGauge(600, 145, 75, comp.ptsPct, 'Points', `${comp.completedPts} / ${comp.totalPts} pts`);

  return canvas.toBuffer('image/png');
}

// ── Platform velocity chart ───────────────────────────────────────────────
async function renderPlatformChart(platformVelocity = []) {
  if (!platformVelocity.length) return null;
  const H = 300;
  const { canvas, ctx } = ctx2d(W, H);
  const padL = 55, padR = 20, padT = 55, padB = 50;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  const n      = platformVelocity.length;
  const maxVal = Math.max(...platformVelocity.map(p => p.avg), 1);
  const barW   = Math.min(80, (chartW / n) * 0.6);
  const groupW = chartW / n;

  // Title
  ctx.fillStyle = COLORS.textDark;
  ctx.font = `bold 15px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText('Average velocity by platform', W / 2, 26);
  ctx.fillStyle = COLORS.text;
  ctx.font = `12px ${FONT}`;
  ctx.fillText(`last ${platformVelocity[0]?.sprintCount || ''} sprints`, W / 2, 44);

  // Grid
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  [0, 0.25, 0.5, 0.75, 1].forEach(f => {
    const y = padT + Math.round(f * chartH);
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
    const label = Math.round(maxVal * (1 - f));
    ctx.fillStyle = COLORS.text;
    ctx.font = `12px ${FONT}`;
    ctx.textAlign = 'right';
    ctx.fillText(label + 'pts', padL - 6, y + 4);
  });

  // Bars
  platformVelocity.forEach((p, i) => {
    const cx   = padL + groupW * i + groupW / 2;
    const barH = Math.round((p.avg / maxVal) * chartH);
    const x    = cx - barW / 2;
    const y    = padT + chartH - barH;

    ctx.fillStyle = COLORS.platforms[i % COLORS.platforms.length];
    ctx.beginPath(); ctx.roundRect(x, y, barW, barH, [4, 4, 0, 0]); ctx.fill();

    ctx.fillStyle = COLORS.textDark;
    ctx.font = `bold 13px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(p.avg + 'pts', cx, y - 6);

    ctx.fillStyle = COLORS.text;
    ctx.font = `12px ${FONT}`;
    ctx.fillText(p.platform, cx, H - padB + 18);
  });

  // Baseline
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(padL, H - padB); ctx.lineTo(W - padR, H - padB); ctx.stroke();

  return canvas.toBuffer('image/png');
}

module.exports = { renderVelocityChart, renderCompletionGauges, renderPlatformChart };
