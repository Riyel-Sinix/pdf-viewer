// 预览用的静态服务器：node tools/serve.mjs [端口]，根目录是 src/
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(path.dirname(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))), 'src');
const port = Number(process.argv[2]) || 8780;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.wasm': 'application/wasm', '.bcmap': 'application/octet-stream', '.pfb': 'application/octet-stream',
  '.ttf': 'font/ttf', '.icc': 'application/vnd.iccprofile', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8',
};
http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  // 开发用：PUT /__out/名字 把浏览器里生成的文件（保存、合并的结果）存到 .cache/out，方便用别的工具检查
  if (req.method === 'PUT' && p.startsWith('/__out/')) {
    const dir = path.join(root, '..', '.cache', 'out'), name = path.basename(p);
    fs.mkdirSync(dir, { recursive: true });
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => { fs.writeFileSync(path.join(dir, name), Buffer.concat(chunks)); res.writeHead(204); res.end(); });
    return;
  }
  if (p.endsWith('/')) p += 'index.html';
  // 开发用：/__test/ 映射到 .cache/test（make-test-pdfs.py 生成的测试 PDF）；/__test/helpers.js 是 tools/preview-helpers.js（预览里测编辑用的小工具）
  const helpers = p === '/__test/helpers.js';
  const base = helpers ? path.join(root, '..', 'tools') : p.startsWith('/__test/') ? path.join(root, '..', '.cache', 'test') : root;
  const file = helpers ? path.join(base, 'preview-helpers.js') : path.join(base, path.normalize(p.startsWith('/__test/') ? p.slice(7) : p));
  if (!file.startsWith(base)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}).listen(port, '127.0.0.1', () => console.log(`serving ${root} on http://127.0.0.1:${port}/`));
