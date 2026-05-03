#!/usr/bin/env node
const http = require('http');
const fs = require('fs');
const path = require('path');

const cur = process.argv[2] || path.resolve(__dirname, '..', 'output', 'sketch-studio-standalone.html');
const bak = process.argv[3] || path.resolve(__dirname, '..', '..', 'Sketch-Studio back up', 'output', 'sketch-studio-unified-v1.0-good styling.html');

if (!fs.existsSync(cur)) { console.error('Current file not found:', cur); process.exit(1); }
if (!fs.existsSync(bak)) { console.error('Backup file not found:', bak); process.exit(1); }

const files = { '/current.html': { path: cur }, '/backup.html': { path: bak } };

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (files[url]) {
    const p = files[url].path;
    fs.createReadStream(p).pipe(res);
    return;
  }
  res.statusCode = 404; res.end('Not Found');
});

server.listen(0, async () => {
  const port = server.address().port;
  console.log('Server running on port', port);

  let puppeteer;
  try {
    puppeteer = require('puppeteer');
  } catch (e) {
    console.error('puppeteer is not installed. Run: npm i puppeteer');
    process.exit(2);
  }

  const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('console', msg => console.log('[browser]', msg.type(), msg.text()));

  async function capture(route, outPrefix) {
    const url = `http://127.0.0.1:${port}${route}`;
    console.log('Loading', url);
    const messages = [];
    page.on('console', m => messages.push(m.text()));
    await page.goto(url, { waitUntil: 'networkidle0' });
    const diag = await page.evaluate(() => {
      const el = document.getElementById('tool-select');
      const bg = el ? getComputedStyle(el).backgroundColor : null;
      const color = el ? getComputedStyle(el).color : null;
      const sheets = Array.from(document.styleSheets).map(s => ({ href: s.href || 'inline', rules: (() => { try { return s.cssRules ? s.cssRules.length : 'cross-origin'; } catch(e){ return 'cross-origin'; } })() }));
      return { bg, color, sheets: sheets.slice(0,40) };
    });

    const el = await page.$('#toolsRibbon');
    if (el) {
      await el.screenshot({ path: `${outPrefix}-toolbar.png` });
      console.log('Wrote', `${outPrefix}-toolbar.png`);
    } else {
      console.warn('toolsRibbon not found');
    }

    return { diag, messages };
  }

  try {
    const curRes = await capture('/current.html', 'current');
    const bakRes = await capture('/backup.html', 'backup');

    console.log('\n=== CURRENT DIAG ===');
    console.log(JSON.stringify(curRes.diag, null, 2));
    console.log('messages:', curRes.messages.join('\n'));

    console.log('\n=== BACKUP DIAG ===');
    console.log(JSON.stringify(bakRes.diag, null, 2));
    console.log('messages:', bakRes.messages.join('\n'));

    await browser.close();
    server.close();
    process.exit(0);
  } catch (e) {
    console.error('Test failed:', e);
    try{ await browser.close(); }catch(_){}
    server.close();
    process.exit(1);
  }
});