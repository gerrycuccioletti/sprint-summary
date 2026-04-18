// run-now.js
// Triggers the scheduler immediately — works on Windows, Mac, and Linux
// Usage: node run-now.js
process.env.RUN_NOW = 'true';
require('./src/scheduler');
