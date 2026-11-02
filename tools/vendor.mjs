// 把 node_modules 里用到的 pdf.js / pdf-lib / marked 文件拷进 src/vendor（应用直接从这里加载，不需要打包器）
import fs from 'node:fs';
import path from 'node:path';

const root = path.dirname(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')));
const nm = p => path.join(root, 'node_modules', p);
const out = p => path.join(root, 'src', 'vendor', p);

function copy(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true });
}

fs.rmSync(out(''), { recursive: true, force: true });
const pj = 'pdfjs-dist/';
copy(nm(pj + 'build/pdf.min.mjs'), out('pdfjs/pdf.min.mjs'));
copy(nm(pj + 'build/pdf.worker.min.mjs'), out('pdfjs/pdf.worker.min.mjs'));
copy(nm(pj + 'web/pdf_viewer.mjs'), out('pdfjs/pdf_viewer.mjs'));
copy(nm(pj + 'web/pdf_viewer.css'), out('pdfjs/pdf_viewer.css'));
copy(nm(pj + 'web/images'), out('pdfjs/images'));
for (const d of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) copy(nm(pj + d), out('pdfjs/' + d));
copy(nm(pj + 'LICENSE'), out('pdfjs/LICENSE'));
// 转成 PDF 时把 Markdown 排成网页
copy(nm('marked/lib/marked.esm.js'), out('marked/marked.esm.js'));
copy(nm('marked/LICENSE'), out('marked/LICENSE'));
// 末尾的 sourceMappingURL 指向没拷过来的 .map，去掉免得控制台报 404
for (const f of ['pdfjs/pdf_viewer.mjs', 'marked/marked.esm.js']) {
  const p = out(f);
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/\n\/\/# sourceMappingURL=.*\s*$/, '\n'));
}
// pdf.js 界面文字的简体中文（批注编辑器的按钮、提示等）。来自 pdf.js 仓库 l10n/zh-CN/viewer.ftl（Mozilla 社区翻译，MPL 2.0），
// pdfjs-dist 不带语言包，所以存在 tools/l10n 里；GenericL10n 通过 <link type="application/l10n"> 指向的 locale.json 找到它
copy(path.join(root, 'tools', 'l10n', 'zh-CN', 'viewer.ftl'), out('pdfjs/locale/zh-CN/viewer.ftl'));
fs.writeFileSync(out('pdfjs/locale/locale.json'), JSON.stringify({ 'zh-cn': 'zh-CN/viewer.ftl' }) + '\n');
copy(nm('pdf-lib/dist/pdf-lib.esm.min.js'), out('pdf-lib/pdf-lib.esm.min.js'));
copy(nm('pdf-lib/LICENSE.md'), out('pdf-lib/LICENSE.md'));

const v = n => JSON.parse(fs.readFileSync(nm(n + '/package.json'), 'utf8')).version;
fs.writeFileSync(out('VERSIONS.txt'), `pdfjs-dist ${v('pdfjs-dist')}\npdf-lib ${v('pdf-lib')}\nmarked ${v('marked')}\n`);
console.log('vendor ok:', `pdfjs-dist ${v('pdfjs-dist')}, pdf-lib ${v('pdf-lib')}, marked ${v('marked')}`);
