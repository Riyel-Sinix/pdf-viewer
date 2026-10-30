// pdf.js 本体。pdf_viewer.mjs 求值时直接从 globalThis.pdfjsLib 取东西，所以这个模块要比它先执行（见 pdfviewer.js）
import * as pdfjsLib from '../vendor/pdfjs/pdf.min.mjs';

globalThis.pdfjsLib = pdfjsLib;
const BASE = new URL('../vendor/pdfjs/', import.meta.url).href;
pdfjsLib.GlobalWorkerOptions.workerSrc = BASE + 'pdf.worker.min.mjs';

// CMap 是中日韩字体必需的；standard_fonts 给没有嵌入字体的 PDF；wasm 解 JPEG 2000 / JBIG2；iccs 是色彩配置
export const DOC_OPTS = {
  cMapUrl: BASE + 'cmaps/',
  cMapPacked: true,
  standardFontDataUrl: BASE + 'standard_fonts/',
  wasmUrl: BASE + 'wasm/',
  iccUrl: BASE + 'iccs/',
  enableXfa: true,
};
export const IMAGES_URL = BASE + 'images/';

// 阅读用的文档共用一个 worker；合并时另开一个，免得合并大文件时阅读卡住
let viewWorker = null, mergeWorker = null;
export const getViewWorker = () => (viewWorker ||= new pdfjsLib.PDFWorker({ name: 'view' }));
export const getMergeWorker = () => (mergeWorker ||= new pdfjsLib.PDFWorker({ name: 'merge' }));

export { pdfjsLib };
