// 整理页面的收尾（后台线程里跑 pdf-lib）：去掉为解密临时加的那一页、去掉副本页带进来的重复书签、插入空白页、旋转页面、把文档信息改回原来的
// 输入的页面已经由 pdf.js 的 extractPages 排好序；空白页的 index 是它在最终文档里的位置，copySlots 是插空白页之前的位置
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFRef, PDFNumber, PDFString, PDFHexString, degrees } from '../vendor/pdf-lib/pdf-lib.esm.min.js';

const N = n => PDFName.of(n);
const isStr = v => v instanceof PDFString || v instanceof PDFHexString;

// 命名目标：老式的 /Dests 字典（键是名字），或者 /Names 下的 /Dests 名字树（键是字符串）
function namedDest(doc, key) {
  if (key instanceof PDFName) {
    const dests = doc.catalog.lookup(N('Dests'));
    return dests instanceof PDFDict ? dests.lookup(key) : undefined;
  }
  const names = doc.catalog.lookup(N('Names')), tree = names instanceof PDFDict ? names.lookup(N('Dests')) : undefined;
  const want = key.decodeText(), seen = new Set();
  const walk = node => {
    if (!(node instanceof PDFDict) || seen.has(node)) return undefined;
    seen.add(node);
    const arr = node.lookup(N('Names'));
    if (arr instanceof PDFArray) for (let i = 0; i + 1 < arr.size(); i += 2) { const k = arr.lookup(i); if (isStr(k) && k.decodeText() === want) return arr.lookup(i + 1); }
    const kids = node.lookup(N('Kids'));
    if (kids instanceof PDFArray) for (let i = 0; i < kids.size(); i++) { const r = walk(kids.lookup(i)); if (r !== undefined) return r; }
    return undefined;
  };
  return walk(tree);
}
// 书签跳到哪一页（页面对象的 ref）；不是跳页的书签返回 null
function bookmarkTarget(doc, item) {
  let d = item.lookup(N('Dest'));
  if (d === undefined) {
    const a = item.lookup(N('A'));
    if (a instanceof PDFDict && String(a.lookup(N('S'))) === '/GoTo') d = a.lookup(N('D'));
  }
  if (d instanceof PDFName || isStr(d)) d = namedDest(doc, d);
  if (d instanceof PDFDict) d = d.lookup(N('D'));
  const p = d instanceof PDFArray && d.size() ? d.get(0) : null;
  return p instanceof PDFRef ? p : null;
}
// 同一页复制了几份时，pdf.js 把副本当成另一份文档拼进来，会把整套书签再带一遍：跳到副本页的书签、网址之类的书签，
// 还有目标页不在那一组里、只因为还有子项才留下的空父项。副本不带书签——
// 1. 去掉跳到副本页的书签；2. 去掉因此变空、本身又没有去向的父项；
// 3. 去掉被前面同名兄弟「包含」的书签（自己没有去向或去向相同，子项也都能在那个兄弟下面找到）。最后把链表和展开计数改好
function dropCopyBookmarks(doc, copySlots) {
  const ctx = doc.context, root = doc.catalog.lookup(N('Outlines'));
  if (!(root instanceof PDFDict) || !copySlots.length) return;
  const pages = doc.getPages(), copies = new Set(copySlots.map(i => pages[i]?.ref?.toString()).filter(Boolean));
  const seen = new Set();
  const titleOf = it => { const t = it.lookup(N('Title')); return isStr(t) ? t.decodeText() : ''; };
  // 书签的去向：跳页 → 页面 ref；别的动作（网址等）→ 动作字典的内容；都没有 → ''
  const goOf = (it, t) => {
    if (t) return 'p:' + t.toString();
    const a = it.lookup(N('A')), d = it.lookup(N('Dest'));
    return a ? 'a:' + String(a) : d ? 'd:' + String(d) : '';
  };
  const subsumed = (p, q) => p.title === q.title && (!p.go || p.go === q.go) && p.kids.every(k => q.kids.some(j => subsumed(k, j)));
  const shown = list => list.reduce((s, k) => s + 1 + (k.open ? k.visible : 0), 0);
  // 处理一层，返回留下来的书签
  const level = (parentRef, parent) => {
    const kept = [];
    let r = parent.get(N('First'));
    while (r instanceof PDFRef && !seen.has(r.toString())) {
      seen.add(r.toString());
      const it = ctx.lookup(r);
      if (!(it instanceof PDFDict)) break;
      const next = it.get(N('Next'));
      const t = bookmarkTarget(doc, it);
      if (!(t && copies.has(t.toString()))) {
        const kids = level(r, it), c = it.lookup(N('Count'));
        const node = { r, it, kids, title: titleOf(it), go: goOf(it, t), open: c instanceof PDFNumber && c.asNumber() > 0, visible: shown(kids) };
        if ((kids.length || node.go) && !kept.some(q => subsumed(node, q))) kept.push(node);
      }
      r = next;
    }
    kept.forEach((k, j) => {
      if (parentRef) k.it.set(N('Parent'), parentRef);
      if (j > 0) k.it.set(N('Prev'), kept[j - 1].r); else k.it.delete(N('Prev'));
      if (j < kept.length - 1) k.it.set(N('Next'), kept[j + 1].r); else k.it.delete(N('Next'));
      if (k.kids.length) { k.it.set(N('First'), k.kids[0].r); k.it.set(N('Last'), k.kids[k.kids.length - 1].r); k.it.set(N('Count'), PDFNumber.of(k.open ? k.visible : -k.visible)); }
      else ['First', 'Last', 'Count'].forEach(x => k.it.delete(N(x)));
    });
    return kept;
  };
  const rootRef = doc.catalog.get(N('Outlines'));
  const tops = level(rootRef instanceof PDFRef ? rootRef : null, root);
  if (!tops.length) { doc.catalog.delete(N('Outlines')); return; }
  root.set(N('First'), tops[0].r);
  root.set(N('Last'), tops[tops.length - 1].r);
  root.set(N('Count'), PDFNumber.of(shown(tops)));
}

self.onmessage = async ({ data }) => {
  try {
    const { bytes, create, dropLast, copySlots = [], blanks = [], rotations = [], info = null, total } = data;
    const doc = create ? await PDFDocument.create({ updateMetadata: false }) : await PDFDocument.load(bytes, { updateMetadata: false });
    // dropLast：为了解密临时加在最后的那一页，等别的都弄完再删（pdf-lib 1.17 删页后不刷新页面缓存，getPages() 还会带着它）
    try { dropCopyBookmarks(doc, copySlots); } catch (e) { console.warn('整理书签失败', e); }       // 书签整理不了不影响页面
    for (const b of [...blanks].sort((x, y) => x.index - y.index)) doc.insertPage(b.index, [b.w, b.h]);
    const pages = doc.getPages(), extra = dropLast ? 1 : 0;
    if (total != null && pages.length !== total + extra) throw new Error(`页数对不上（应为 ${total}，实际 ${pages.length - extra}）`);
    for (const r of rotations) {
      const p = pages[r.index];
      if (p) p.setRotation(degrees(((p.getRotation().angle + r.rot) % 360 + 360) % 360));
    }
    if (dropLast) { const last = pages[pages.length - 1]; doc.removePage(pages.length - 1); doc.context.delete(last.ref); }
    // pdf.js 生成的新文件会把「创建程序」写成 PDF.js、「生成器」写成 Firefox，几份文件拼在一起时还会丢掉标题作者，这里按原文档补回去
    if (info) {
      if (info.Title) doc.setTitle(info.Title);
      if (info.Author) doc.setAuthor(info.Author);
      if (info.Subject) doc.setSubject(info.Subject);
      if (info.Keywords) doc.getInfoDict().set(PDFName.of('Keywords'), PDFHexString.fromText(info.Keywords));
      doc.setCreator(info.Creator || 'PDF 查看器');
      if (info.created) doc.setCreationDate(new Date(info.created));
    }
    doc.setProducer('PDF 查看器（pdf.js + pdf-lib）');
    doc.setModificationDate(new Date());
    const out = await doc.save({ useObjectStreams: true, addDefaultPage: false, updateFieldAppearances: false });
    self.postMessage({ ok: true, bytes: out }, [out.buffer]);
  } catch (e) {
    self.postMessage({ ok: false, error: String(e?.message || e) });
  }
};
