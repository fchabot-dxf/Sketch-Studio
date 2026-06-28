#!/usr/bin/env node
const http = require('http');
const fs = require('fs');
const path = require('path');

const port = process.env.PORT || 8000;
const root = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();

function mimeType(file){
  const ext = path.extname(file).toLowerCase();
  return ({
    '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.gif':'image/gif', '.ico':'image/x-icon'
  }[ext] || 'application/octet-stream');
}

const server = http.createServer((req, res) => {
  try{
    // Local-dev parity with the Cloudflare _redirects rule: root → the SketchStudio shell.
    if (((req.url || '/').split('?')[0]) === '/') {
      res.statusCode = 302;
      res.setHeader('Location', '/apps/sketchstudio/');
      res.end();
      return;
    }
    const safePath = path.normalize(decodeURIComponent(req.url.split('?')[0] || '/'));
    let filePath = path.join(root, safePath);

    // If path is a directory, serve index.html
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }

    if (!fs.existsSync(filePath)) {
      res.statusCode = 404;
      res.setHeader('Content-Type','text/plain');
      res.end('404 Not Found');
      console.warn('[server] 404', filePath);
      return;
    }

    const stream = fs.createReadStream(filePath);
    res.statusCode = 200;
    res.setHeader('Content-Type', mimeType(filePath));
    stream.pipe(res);
    console.log('[server] Served:', req.url, '->', filePath);
  }catch(err){
    console.error('[server] error serving', err);
    res.statusCode = 500;
    res.setHeader('Content-Type','text/plain');
    res.end('500 Internal Server Error');
  }
});

server.listen(port, () => console.log(`[server] serving ${root} on http://localhost:${port}/`));

// Graceful shutdown
process.on('SIGINT', () => { console.log('[server] stopping'); server.close(() => process.exit(0)); });
