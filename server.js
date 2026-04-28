const http = require('http');
const { execFile } = require('child_process');

http.createServer((req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(405); res.end(); return;
  }

  // Segurança: valida token
  const token = req.headers['x-api-token'];
  if (token !== process.env.API_TOKEN) {
    res.writeHead(401); res.end('Unauthorized'); return;
  }

  execFile('node', ['scraper.js'], {
    env: { ...process.env },
    timeout: 60000
  }, (err, stdout, stderr) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (err) {
      res.end(JSON.stringify({ success: false, error: err.message }));
    } else {
      res.end(stdout);
    }
  });
}).listen(3000);