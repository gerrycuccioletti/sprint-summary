// src/reporters/kickback-excel.js
// Generates an Excel report for CR / QA / RFSO kickback ratio reports.
// Uses a child Python process to write the xlsx via openpyxl.

const { execSync }  = require('child_process');
const fs            = require('fs');
const path          = require('path');
const os            = require('os');

function generateKickbackExcel(results, fromDate, toDate, reportType, outputDir = './output') {
  const config = { reportType, fromDate, toDate, results, outputDir };

  const tmpJson = path.join(os.tmpdir(), `kickback-${reportType}-${Date.now()}.json`);
  fs.writeFileSync(tmpJson, JSON.stringify(config, null, 2), { encoding: 'utf8' });

  const script  = path.join(__dirname, 'kickback-excel.py');
  const python  = process.platform === 'win32' ? 'python' : 'python3';

  let result;
  try {
    result = execSync(`${python} "${script}" "${tmpJson}"`, {
      encoding: 'utf8',
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    });
  } catch (err) {
    const fallback = python === 'python' ? 'python3' : 'python';
    result = execSync(`${fallback} "${script}" "${tmpJson}"`, {
      encoding: 'utf8',
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    });
  } finally {
    try { fs.unlinkSync(tmpJson); } catch {}
  }

  const output = JSON.parse(result.trim());
  if (output.error) throw new Error(output.error);
  return output.filePath;
}

module.exports = { generateKickbackExcel };
