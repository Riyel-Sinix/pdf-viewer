// 合并后的整理（在后台线程里跑 pdf-lib）：每个源文件一个书签（原有书签收到它下面）、按要求旋转页面、写文档信息
import { PDFDocument, PDFName, PDFDict, PDFRef, PDFNumber, PDFHexString, degrees } from '../vendor/pdf-lib/pdf-lib.esm.min.js';

const N = n => PDFName.of(n);

function regroupOutline(doc, pages, groups, topPages) {
  const ctx = doc.context, cat = doc.catalog;
  // 现有的顶层书签（pdf.js 合并时按文件顺序保留了各自的书签）
  const tops = [];
  const oldRoot = cat.lookupMaybe(N('Outlines'), PDFDict);
  if (oldRoot) {
    const seen = new Set();
    let r = oldRoot.get(N('First'));
    while (r instanceof PDFRef && !seen.has(r.toString()) && tops.length < 100000) {
      seen.add(r.toString());
      tops.push(r);
      r = ctx.lookupMaybe(r, PDFDict)?.get(N('Next'));
    }
  }
  // 按目标页落在哪个文件的页码区间里，把它们分到对应文件下面；解析不了目标的，跟着前一个走
  const kids = groups.map(() => []);
  const usable = Array.isArray(topPages) && topPages.length === tops.length;
  let last = 0;
  tops.forEach((ref, i) => {
    const p = usable ? topPages[i] : null;
    let g = p == null ? -1 : groups.findIndex(x => p >= x.start && p < x.start + x.count);
    if (g < 0) g = last;
    kids[g].push(ref);
    last = g;
  });
  const rootRef = ctx.nextRef(), fileRefs = groups.map(() => ctx.nextRef());
  groups.forEach((g, i) => {
    const ks = kids[i];
    let visible = 0;
    ks.forEach((ref, j) => {
      const d = ctx.lookup(ref, PDFDict);
      d.set(N('Parent'), fileRefs[i]);
      if (j > 0) d.set(N('Prev'), ks[j - 1]); else d.delete(N('Prev'));
      if (j < ks.length - 1) d.set(N('Next'), ks[j + 1]); else d.delete(N('Next'));
      const c = d.lookupMaybe(N('Count'), PDFNumber)?.asNumber() || 0;
      visible += 1 + (c > 0 ? c : 0);
    });
    const dict = ctx.obj({ Title: PDFHexString.fromText(g.title), Parent: rootRef, Dest: [pages[g.start].ref, 'Fit'] });
    if (i > 0) dict.set(N('Prev'), fileRefs[i - 1]);
    if (i < groups.length - 1) dict.set(N('Next'), fileRefs[i + 1]);
    if (ks.length) {
      dict.set(N('First'), ks[0]);
      dict.set(N('Last'), ks[ks.length - 1]);
      dict.set(N('Count'), PDFNumber.of(-visible));    // 负数 = 默认收起
    }
    ctx.assign(fileRefs[i], dict);
  });
  ctx.assign(rootRef, ctx.obj({ Type: 'Outlines', First: fileRefs[0], Last: fileRefs[fileRefs.length - 1], Count: groups.length }));
  cat.set(N('Outlines'), rootRef);
  cat.set(N('PageMode'), N('UseOutlines'));
}

self.onmessage = async ({ data }) => {
  try {
    const { bytes, groups, topPages, bookmarks, title, total, dropLast } = data;
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    // dropLast：只有一份加密文件时为了解密临时加在最后的那一页，最后再删（pdf-lib 1.17 删页后不刷新页面缓存，getPages() 还会带着它）
    const pages = doc.getPages(), extra = dropLast ? 1 : 0;
    if (pages.length !== total + extra) throw new Error(`页数对不上（应为 ${total}，实际 ${pages.length - extra}）`);
    for (const g of groups) {
      if (!g.rotate) continue;
      for (let i = g.start; i < g.start + g.count; i++) {
        const p = pages[i];
        p.setRotation(degrees(((p.getRotation().angle + g.rotate) % 360 + 360) % 360));
      }
    }
    if (bookmarks && groups.length) regroupOutline(doc, pages, groups, topPages);
    if (dropLast) { const last = pages[pages.length - 1]; doc.removePage(pages.length - 1); doc.context.delete(last.ref); }
    const now = new Date();
    if (title) doc.setTitle(title);
    doc.setCreator('PDF 查看器');
    doc.setProducer('PDF 查看器（pdf.js + pdf-lib）');
    doc.setCreationDate(now);
    doc.setModificationDate(now);
    const out = await doc.save({ useObjectStreams: true, addDefaultPage: false, updateFieldAppearances: false });
    self.postMessage({ ok: true, bytes: out }, [out.buffer]);
  } catch (e) {
    self.postMessage({ ok: false, error: String(e?.message || e) });
  }
};
