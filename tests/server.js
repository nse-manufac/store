// เสิร์ฟไฟล์ในโฟลเดอร์ repo ให้ Playwright ทดสอบ
// เขียนเองเพราะไม่อยากเพิ่ม dependency แค่เพื่อเสิร์ฟไฟล์นิ่ง ๆ
// (แอปจริงยังเป็นไฟล์เดียวไม่มี build เหมือนเดิม — ตัวนี้ใช้ตอนเทสเท่านั้น)
const http = require('http');
const fs   = require('fs');
const path = require('path');

const port = Number(process.argv[2] || 8123);
const root = path.resolve(__dirname, '..');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md':   'text/markdown; charset=utf-8',
  '.gs':   'text/plain; charset=utf-8'
};

http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = path.join(root, pathname);

  // กัน path traversal ออกนอกโฟลเดอร์ repo
  if (!file.startsWith(root)) { res.writeHead(403); res.end('forbidden'); return; }

  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(buf);
  });
}).listen(port, '127.0.0.1', () => console.log(`serving ${root} on http://127.0.0.1:${port}`));
