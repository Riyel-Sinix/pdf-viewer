// 生成 Rust 依赖的许可证清单：node tools/third-party.mjs
// 从桌面外壳的 crate 出发，只沿普通依赖（不含 dev / build 依赖）走，也就是会编进 exe 的那些；
// 写出 licenses/rust-crates.md（清单）和 licenses/rust-crates-LICENSES.txt（各 crate 包里的许可证原文，内容相同的合并）
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = path.dirname(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')));
const meta = JSON.parse(execFileSync('cargo', ['metadata', '--format-version', '1', '--filter-platform', 'x86_64-pc-windows-msvc'], {
  cwd: path.join(root, 'src-tauri'), maxBuffer: 256 * 1024 * 1024, encoding: 'utf8',
}));
const pkgs = new Map(meta.packages.map(p => [p.id, p]));
const nodes = new Map(meta.resolve.nodes.map(n => [n.id, n]));
const rootId = meta.resolve.root;

// 普通依赖可达的包
const seen = new Set([rootId]), queue = [rootId];
while (queue.length) {
  const n = nodes.get(queue.shift());
  for (const d of n?.deps || []) {
    if (!d.dep_kinds.some(k => k.kind === null) || seen.has(d.pkg)) continue;
    seen.add(d.pkg);
    queue.push(d.pkg);
  }
}
seen.delete(rootId);
const crates = [...seen].map(id => pkgs.get(id)).sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));

const LIC = /^(licen[cs]e|copying|copyright|notice|unlicense)/i;
const texts = new Map();      // hash → { text, files: [] }
const rows = [];
for (const c of crates) {
  const dir = path.dirname(c.manifest_path);
  const files = fs.readdirSync(dir).filter(f => LIC.test(f) && fs.statSync(path.join(dir, f)).isFile()).sort();
  if (c.license_file && !files.includes(path.basename(c.license_file))) files.push(path.basename(c.license_file));
  for (const f of files) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8').replace(/\r\n/g, '\n').trim();
    const h = crypto.createHash('sha256').update(text).digest('hex');
    if (!texts.has(h)) texts.set(h, { text, files: [] });
    texts.get(h).files.push(`${c.name} ${c.version}（${f}）`);
  }
  const repo = c.repository || c.homepage || `https://crates.io/crates/${c.name}`;
  rows.push(`| ${c.name} | ${c.version} | ${(c.license || (c.license_file ? '见许可证文件' : '未声明')).replace(/\|/g, '\\|')} | ${repo} | ${files.length ? files.join('、') : '包里没有许可证文件'} |`);
}

const out = path.join(root, 'licenses');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'rust-crates.md'), `# 编进桌面版 exe 的 Rust 依赖

由 \`node tools/third-party.mjs\` 从 \`cargo metadata\` 生成（目标 x86_64-pc-windows-msvc，只算普通依赖），共 ${crates.length} 个。
各 crate 包里带的许可证原文在 [rust-crates-LICENSES.txt](rust-crates-LICENSES.txt)。

| crate | 版本 | 许可证 | 来源 | 包里的许可证文件 |
| --- | --- | --- | --- | --- |
${rows.join('\n')}
`);
const blocks = [...texts.values()].sort((a, b) => a.files[0].localeCompare(b.files[0]))
  .map(t => `${'='.repeat(78)}\n用于：${t.files.join('；')}\n${'-'.repeat(78)}\n\n${t.text}\n`);
fs.writeFileSync(path.join(out, 'rust-crates-LICENSES.txt'), `编进桌面版 exe 的 Rust 依赖的许可证原文（内容相同的只收一份，「用于」列出用到它的 crate 和文件名）。\n由 node tools/third-party.mjs 生成。\n\n${blocks.join('\n')}`);
const missing = rows.filter(r => r.endsWith('包里没有许可证文件 |')).length;
console.log(`${crates.length} 个 crate，${texts.size} 份不同的许可证原文；没带许可证文件的 ${missing} 个`);
