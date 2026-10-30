# 第三方组件与许可证

本项目自己的代码以 [MIT 许可证](LICENSE) 发布。下面这些第三方组件随源码或随桌面版一起分发，
各自沿用原来的许可证，MIT 许可证不适用于它们。许可证原文在 [`licenses/`](licenses/) 和各组件自带的目录里。
发布页的 `licenses.zip` 是同一套文件，跟可执行文件放在一起分发。

## 网页部分（`src/`，也编进桌面版 exe）

| 组件 | 版本 / 来源 | 许可证 |
| --- | --- | --- |
| pdf.js（`src/vendor/pdfjs/`：解析、渲染、批注编辑器、合并） | [pdfjs-dist 6.4.299](https://github.com/mozilla/pdf.js) | [Apache-2.0](src/vendor/pdfjs/LICENSE) |
| └ CMap 资源（`cmaps/`） | Adobe | [BSD-3-Clause](src/vendor/pdfjs/cmaps/LICENSE) |
| └ ICC 色彩配置（`iccs/`） | — | [CC0-1.0](src/vendor/pdfjs/iccs/LICENSE) |
| └ 标准字体（`standard_fonts/`：Foxit、Liberation） | PDFium / Liberation Fonts | [Foxit](src/vendor/pdfjs/standard_fonts/LICENSE_FOXIT)、[Liberation](src/vendor/pdfjs/standard_fonts/LICENSE_LIBERATION) |
| └ JBIG2、OpenJPEG、qcms 解码器（`wasm/`） | PDFium、OpenJPEG、qcms | [JBIG2](src/vendor/pdfjs/wasm/LICENSE_JBIG2) + [pdf.js 封装](src/vendor/pdfjs/wasm/LICENSE_PDFJS_JBIG2)、[OpenJPEG](src/vendor/pdfjs/wasm/LICENSE_OPENJPEG) + [pdf.js 封装](src/vendor/pdfjs/wasm/LICENSE_PDFJS_OPENJPEG)、[qcms](src/vendor/pdfjs/wasm/LICENSE_QCMS) + [pdf.js 封装](src/vendor/pdfjs/wasm/LICENSE_PDFJS_QCMS) |
| └ QuickJS（`wasm/quickjs-eval.*`） | [QuickJS](https://bellard.org/quickjs/)，经 [pdf.js](https://github.com/mozilla/pdf.js/tree/master/external/quickjs) 编译 | [MIT](licenses/QuickJS-LICENSE.txt) + [pdf.js 封装（MIT）](licenses/pdfjs-quickjs-LICENSE.txt) |
| pdf.js 编辑器的简体中文界面文字（`src/vendor/pdfjs/locale/`、`tools/l10n/`） | [pdf.js 的 Fluent 译文](https://github.com/mozilla/pdf.js/tree/master/l10n/zh-CN) | [MPL-2.0](licenses/MPL-2.0.txt)（文件头有说明） |
| pdf-lib（`src/vendor/pdf-lib/`：旋转、空白页、书签、文档信息） | [1.17.1](https://github.com/Hopding/pdf-lib) | [MIT](src/vendor/pdf-lib/LICENSE.md) |
| └ 打包在 pdf-lib 里的依赖 | @pdf-lib/standard-fonts 1.0.0、@pdf-lib/upng 1.0.1、pako 1.0.11、tslib 1.14.1 | [MIT](licenses/pdf-lib-standard-fonts-LICENSE.md)、[MIT](licenses/pdf-lib-upng-LICENSE.txt)、[MIT 和 Zlib](licenses/pako-LICENSE.txt)、[0BSD](licenses/tslib-LICENSE.txt) |
| 霞鹜文楷 LXGW WenKai（`src/assets/fonts/wk-*.woff2`） | [v1.530](https://github.com/lxgw/LxgwWenKai)，按 GB2312 + 界面用字子集化 | [SIL OFL 1.1](licenses/OFL-LXGW-WenKai.txt) |
| IM FELL English（`src/assets/fonts/fell-*.woff2`） | [Igino Marini](https://iginomarini.com/fell/the-revival-fonts/)，子集化 | [SIL OFL 1.1](licenses/OFL-IM-Fell-English.txt) |
| 《天真与经验之歌》插图（`src/assets/plates/`） | William Blake，Copy Z（1826 年印本），美国国会图书馆 Rosenwald 藏品（[Rosenwald 1801A](https://hdl.loc.gov/loc.rbc/rosenwald.1801.1)） | 公有领域 |
| 首页的诗（`src/js/songs.js`） | William Blake，《天真与经验之歌》（1794） | 公有领域 |

两套字体都带保留字体名（「霞鹜」「LXGW」「IM FELL English」等）。这里的子集算修改过的版本，所以字体内部的名字改成了
「Songs Han」「Songs Fell」（见 `tools/fonts.py`），原来的版权声明和许可证信息都留在字体文件里。

## 桌面外壳（`src-tauri/`，编进 exe）

| 组件 | 版本 / 来源 | 许可证 |
| --- | --- | --- |
| Tauri 2 和其余 Rust 依赖，共 234 个 crate | 清单见 [licenses/rust-crates.md](licenses/rust-crates.md)（`node tools/third-party.mjs` 生成） | 各 crate 自己的许可证（大多是 MIT / Apache-2.0），原文见 [licenses/rust-crates-LICENSES.txt](licenses/rust-crates-LICENSES.txt) |
| webview2-com、webview2-com-sys、webview2-com-macros（包里没带许可证文件） | [0.39.1](https://github.com/wravery/webview2-rs) | [MIT](licenses/webview2-rs-LICENSE.txt) |
| alloc-stdlib（包里没带许可证文件） | [0.3.0](https://github.com/dropbox/rust-alloc-no-stdlib) | [BSD-3-Clause](licenses/alloc-stdlib-LICENSE.txt) |
| selectors（包里没带许可证文件） | [0.38.0](https://github.com/servo/stylo) | [MPL-2.0](licenses/MPL-2.0.txt) |
| WebView2 加载器（`WebView2LoaderStatic.lib`，由 webview2-com-sys 静态链接） | Microsoft.Web.WebView2 SDK | [Microsoft 的许可证](licenses/WebView2-SDK-LICENSE.txt)，[第三方声明](licenses/WebView2-SDK-NOTICE.txt) |

桌面版用的是系统自带的 Microsoft Edge WebView2 运行时，没有随程序分发；没有的话安装包会从微软下载。
