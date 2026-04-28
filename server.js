const http = require('http');
const { execFile } = require('child_process');

const PORT = process.env.PORT || 8080;

http.createServer((req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(405); res.end(); return;
  }

  const token = req.headers['x-api-token'];
  if (token !== process.env.API_TOKEN) {
    res.writeHead(401); res.end('Unauthorized'); return;
  }

  execFile('node', ['scraper.js'], {
    env: { ...process.env },
    timeout: 120000
  }, (err, stdout, stderr) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (err) {
      res.end(JSON.stringify({ success: false, error: err.message, stderr }));
    } else {
      res.end(stdout);
    }
  });

}).listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});