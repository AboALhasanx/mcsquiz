// A tiny health endpoint: is the shell alive, and which build is it?
// Used by the uptime check and by the "sync now" button to prove the network
// path works.
const fs = require('fs');
const path = require('path');

module.exports = async function handler(req, res) {
  let version = '?';
  try {
    version = fs.readFileSync(path.join(process.cwd(), 'VERSION'), 'utf-8').trim();
  } catch (e) { /* the file is optional */ }
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');
  res.status(200).json({
    ok: true,
    version: version,
    time: new Date().toISOString(),
    build: 'mcq-portal',
  });
};
