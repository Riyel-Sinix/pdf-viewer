// 先执行 pdfjs.js（挂好 globalThis.pdfjsLib），再加载 pdf.js 的阅读器组件
import './pdfjs.js';
export * from '../vendor/pdfjs/pdf_viewer.mjs';
