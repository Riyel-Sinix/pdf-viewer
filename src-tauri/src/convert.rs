//! 转成 PDF 里要靠本机的部分（界面、图片拼页都在 src/js/convert.js）：
//! - Office 文档：交给本机装的 Microsoft Office / WPS / LibreOffice（PowerShell 驱动 COM，后台隐藏运行，见 office.ps1）；
//! - 文本、Markdown、网页：在一个看不见、不跑脚本的 WebView2 窗口里打开，用 DevTools 协议的 Page.printToPDF 打印成 PDF；
//! - TIFF（多页扫描件）、HEIC 这类网页解不了的图片：用 Windows 自带的 WIC 解码，每一帧重新编码成 PNG / JPEG 交给前端。
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tauri::ipc::Response;
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Url, WebviewUrl, WebviewWindowBuilder};

static SEQ: AtomicU32 = AtomicU32::new(0);
const NO_WINDOW: u32 = 0x0800_0000; // CREATE_NO_WINDOW：不闪出控制台窗口

/// 每次转换一个临时目录，用完删掉（WebView2 可能还占着文件一小会儿：删不掉就过两秒再删一次）
struct TempDir(PathBuf);
impl TempDir {
    fn new(tag: &str) -> Result<Self, String> {
        let n = SEQ.fetch_add(1, Ordering::Relaxed);
        let p = std::env::temp_dir().join(format!("pdf-viewer-{tag}-{}-{n}", std::process::id()));
        std::fs::create_dir_all(&p).map_err(|e| format!("建不了临时文件夹：{e}"))?;
        Ok(Self(p))
    }
}
impl Drop for TempDir {
    fn drop(&mut self) {
        if std::fs::remove_dir_all(&self.0).is_err() {
            let p = self.0.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(2));
                let _ = std::fs::remove_dir_all(p);
            });
        }
    }
}

fn hidden(cmd: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(NO_WINDOW);
    }
    cmd
}

/* ---------- Office 文档 ---------- */

const OFFICE_PS1: &str = include_str!("office.ps1");
const OFFICE_TIMEOUT: Duration = Duration::from_secs(240);

/// 加了打开密码的 Office 2007+ 文档不是 zip，而是一个 OLE 复合文件；这种 Office 会弹框要密码，后台没法输，干脆先拦下来
fn ooxml_encrypted(path: &Path) -> bool {
    const OOXML: &[&str] = &["docx", "docm", "dotx", "dotm", "xlsx", "xlsm", "xltx", "xltm", "xlsb", "pptx", "pptm", "ppsx", "ppsm", "potx", "potm"];
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    if !OOXML.contains(&ext.as_str()) {
        return false;
    }
    let mut head = [0u8; 8];
    std::fs::File::open(path).and_then(|mut f| f.read_exact(&mut head)).is_ok() && head == [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]
}

fn kill_tree(pid: u32) {
    let _ = hidden(Command::new("taskkill").args(["/PID", &pid.to_string(), "/T", "/F"]))
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

fn office_blocking(path: &str, kind: &str) -> Result<Vec<u8>, String> {
    let src = Path::new(path);
    if !src.is_file() {
        return Err("找不到这个文件".into());
    }
    if ooxml_encrypted(src) {
        return Err("PASSWORD".into());
    }
    let tmp = TempDir::new("office")?;
    let script = tmp.0.join("convert.ps1");
    // Windows PowerShell 5.1 按系统代码页读不带 BOM 的脚本：写成带 BOM 的 UTF-8
    let mut body = vec![0xEF, 0xBB, 0xBF];
    body.extend_from_slice(OFFICE_PS1.as_bytes());
    std::fs::write(&script, body).map_err(|e| format!("写不了临时文件：{e}"))?;
    let out = tmp.0.join("out.pdf");
    let mut child = hidden(
        Command::new("powershell.exe")
            .args(["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"])
            .arg(&script)
            .env("PDFV_IN", src)
            .env("PDFV_OUT", &out)
            .env("PDFV_KIND", kind)
            .env("PDFV_TMP", &tmp.0)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped()),
    )
    .spawn()
    .map_err(|e| format!("启动不了 PowerShell：{e}"))?;

    // 一边跑一边收输出：超时的时候要知道这次新开了哪些 Office 进程
    let lines = Arc::new(Mutex::new(Vec::<String>::new()));
    let stdout = child.stdout.take().ok_or("拿不到输出")?;
    let sink = lines.clone();
    let reader = std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            sink.lock().unwrap().push(line);
        }
    });
    let mut stderr = child.stderr.take().ok_or("拿不到输出")?;
    let err_reader = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = stderr.read_to_string(&mut s);
        s
    });

    let deadline = Instant::now() + OFFICE_TIMEOUT;
    let finished = loop {
        match child.try_wait() {
            Ok(Some(_)) => break true,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(100)),
            _ => break false,
        }
    };
    if !finished {
        // COM 启动的 Office 不是 PowerShell 的子进程，要按记下的进程号单独结束；用户自己开着的程序不在名单里
        let pids: Vec<u32> = lines.lock().unwrap().iter().filter_map(|l| l.strip_prefix("PID:")?.trim().parse().ok()).collect();
        for pid in pids {
            kill_tree(pid);
        }
        let _ = child.kill();
        let _ = child.wait();
        return Err("TIMEOUT".into());
    }
    let _ = reader.join();
    let err = err_reader.join().unwrap_or_default();
    let lines = lines.lock().unwrap().clone();
    if let Some(m) = lines.iter().find_map(|l| l.strip_prefix("ERR:")) {
        return Err(m.trim().to_string());
    }
    if !lines.iter().any(|l| l.starts_with("OK:")) {
        let err = err.trim();
        return Err(if err.is_empty() { "转换没有完成".into() } else { format!("转换没有完成：{}", err.lines().next().unwrap_or(err)) });
    }
    std::fs::read(&out).map_err(|e| format!("没找到生成的 PDF：{e}"))
}

/// kind：word / excel / powerpoint（前端按扩展名分好）
#[tauri::command]
pub async fn convert_office(path: String, kind: String) -> Result<Response, String> {
    if !matches!(kind.as_str(), "word" | "excel" | "powerpoint") {
        return Err("不认识的文档类型".into());
    }
    tauri::async_runtime::spawn_blocking(move || office_blocking(&path, &kind))
        .await
        .map_err(|e| e.to_string())?
        .map(Response::new)
}

/* ---------- 打印成 PDF（文本、Markdown、网页） ---------- */

#[derive(serde::Deserialize)]
pub struct PrintJob {
    /// 前端拼好的整页 HTML（文本、Markdown、表格）
    html: Option<String>,
    /// 或者直接打开的网页文件（.html / .mht）
    path: Option<String>,
    /// Page.printToPDF 的参数（JSON）
    params: String,
}

#[tauri::command]
pub async fn print_pdf(app: AppHandle, job: PrintJob) -> Result<Response, String> {
    let params: serde_json::Value = serde_json::from_str(&job.params).map_err(|e| format!("打印参数不对：{e}"))?;
    let tmp = TempDir::new("print")?;
    let file = match (job.html, job.path) {
        (Some(html), _) => {
            let f = tmp.0.join("page.html");
            std::fs::write(&f, html).map_err(|e| format!("写不了临时文件：{e}"))?;
            f
        }
        (None, Some(p)) if Path::new(&p).is_file() => {
            let p = PathBuf::from(p);
            mht_crlf(&p, &tmp.0).unwrap_or(p)
        }
        (None, Some(_)) => return Err("找不到这个文件".into()),
        (None, None) => return Err("没有要打印的内容".into()),
    };
    let url = Url::from_file_path(&file).map_err(|_| "文件路径不对".to_string())?;

    let label = format!("print{}", SEQ.fetch_add(1, Ordering::Relaxed));
    let (loaded_tx, mut loaded_rx) = tauri::async_runtime::channel::<()>(8);
    // 看不见、不进任务栏、不抢焦点；页面里的脚本一律不跑（要转的网页可能是从网上下载的），也不许跳到别的网址
    let mut b = WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(url))
        .title("PDF 查看器 · 打印")
        .inner_size(820.0, 1100.0)
        .visible(false)
        .focused(false)
        .skip_taskbar(true)
        .disable_javascript()
        .on_navigation(|u| matches!(u.scheme(), "file" | "about"))
        .on_page_load(move |_w, p| {
            if p.event() == PageLoadEvent::Finished {
                let _ = loaded_tx.try_send(());
            }
        });
    if let Some(data) = crate::test_data_dir() {
        b = b.focusable(false).data_directory(data);
    }
    let win = b.build().map_err(|e| format!("打印窗口没建起来：{e}"))?;
    // 等页面（连同图片）载完；有网络图片卡住的话最多等 20 秒，到时候有什么印什么
    let _ = tokio::time::timeout(Duration::from_secs(20), loaded_rx.recv()).await;
    let result = print_window(&win, params.to_string()).await;
    let _ = win.destroy();
    result.map(Response::new)
}

/// MHT 网页存档的换行必须是 CRLF：Chromium 只认这个，只有 LF 的会印成一张白纸。浏览器存出来的都是 CRLF；
/// 碰上只有 LF 的（在别的系统上改过、经过 git 之类），在临时文件夹里做一份换成 CRLF 的副本来打印
fn mht_crlf(path: &Path, dir: &Path) -> Option<PathBuf> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    if ext != "mht" && ext != "mhtml" {
        return None;
    }
    let data = std::fs::read(path).ok()?;
    let head = &data[..data.len().min(8192)];
    if !head.contains(&b'\n') || head.windows(2).any(|w| w == b"\r\n") {
        return None;
    }
    let mut out = Vec::with_capacity(data.len() + data.len() / 32);
    for &b in &data {
        if b == b'\n' {
            out.push(b'\r');
        }
        out.push(b);
    }
    let f = dir.join("page.mht");
    std::fs::write(&f, out).ok()?;
    Some(f)
}

async fn print_window(win: &tauri::WebviewWindow, params: String) -> Result<Vec<u8>, String> {
    use base64::Engine as _;
    let json = devtools_call(win, "Page.printToPDF", params).await?;
    let v: serde_json::Value = serde_json::from_str(&json).map_err(|e| e.to_string())?;
    let data = v.get("data").and_then(|d| d.as_str()).ok_or("打印结果里没有 PDF")?;
    base64::engine::general_purpose::STANDARD.decode(data).map_err(|e| e.to_string())
}

#[cfg(windows)]
async fn devtools_call(win: &tauri::WebviewWindow, method: &'static str, params: String) -> Result<String, String> {
    use webview2_com::CallDevToolsProtocolMethodCompletedHandler;
    use windows::core::{HSTRING, PCWSTR};

    let (tx, mut rx) = tauri::async_runtime::channel::<Result<String, String>>(2);
    let fail = tx.clone();
    win.with_webview(move |wv| unsafe {
        let r = (|| -> windows::core::Result<()> {
            let core = wv.controller().CoreWebView2()?;
            let handler = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |hr, json| {
                let _ = tx.try_send(hr.map(|_| json).map_err(|e| e.message()));
                Ok(())
            }));
            let m = HSTRING::from(method);
            let p = HSTRING::from(params);
            core.CallDevToolsProtocolMethod(PCWSTR(m.as_ptr()), PCWSTR(p.as_ptr()), &handler)
        })();
        if let Err(e) = r {
            let _ = fail.try_send(Err(e.message()));
        }
    })
    .map_err(|e| e.to_string())?;
    match tokio::time::timeout(Duration::from_secs(180), rx.recv()).await {
        Ok(Some(r)) => r.map_err(|e| format!("打印失败：{e}")),
        Ok(None) => Err("打印没有结果".into()),
        Err(_) => Err("打印超时".into()),
    }
}

#[cfg(not(windows))]
async fn devtools_call(_: &tauri::WebviewWindow, _: &'static str, _: String) -> Result<String, String> {
    Err("只有 Windows 版能打印成 PDF".into())
}

/* ---------- WIC 解码图片（TIFF、HEIC、JPEG XR…） ---------- */

/// 返回：u32 帧数，然后每帧 u32 格式（0 = PNG，1 = JPEG）、u32 宽、u32 高、f64 横向 DPI、f64 纵向 DPI、u32 长度、编码后的数据（都是小端）
#[tauri::command]
pub async fn decode_image(path: String) -> Result<Response, String> {
    tauri::async_runtime::spawn_blocking(move || wic::decode(&path))
        .await
        .map_err(|e| e.to_string())?
        .map(Response::new)
}

#[cfg(windows)]
mod wic {
    use windows::core::{Error, HSTRING};
    use windows::Win32::Foundation::{E_FAIL, GENERIC_READ, HGLOBAL, WINCODEC_ERR_COMPONENTNOTFOUND};
    use windows::Win32::Graphics::Imaging::*;
    use windows::Win32::System::Com::StructuredStorage::CreateStreamOnHGlobal;
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED, STREAM_SEEK_END, STREAM_SEEK_SET};

    const MAX_FRAMES: u32 = 1000;

    pub fn decode(path: &str) -> Result<Vec<u8>, String> {
        unsafe {
            let init = CoInitializeEx(None, COINIT_MULTITHREADED);
            let r = frames(path);
            if init.is_ok() {
                CoUninitialize();
            }
            r.map_err(|e| explain(path, &e))
        }
    }

    // HEIC 要靠另装的解码器：Microsoft Store 里的「HEIF 图像扩展」，解里面的画面还要「HEVC 视频扩展」
    fn explain(path: &str, e: &Error) -> String {
        let ext = std::path::Path::new(path).extension().and_then(|x| x.to_str()).unwrap_or("").to_ascii_lowercase();
        let heif = matches!(ext.as_str(), "heic" | "heif" | "hif");
        match (heif, e.code() == WINCODEC_ERR_COMPONENTNOTFOUND) {
            (true, true) => "系统里没有解 HEIC 的组件：从 Microsoft Store 装「HEIF 图像扩展」和「HEVC 视频扩展」后再试".into(),
            (true, false) => format!("解不开这张 HEIC 图片：{}（系统的「照片」也打不开的话，需要从 Microsoft Store 装「HEVC 视频扩展」）", e.message().trim()),
            (false, true) => "系统里没有能解这种图片的组件".into(),
            _ => format!("解不开这张图片：{}", e.message().trim()),
        }
    }

    unsafe fn frames(path: &str) -> windows::core::Result<Vec<u8>> {
        let f: IWICImagingFactory = CoCreateInstance(&CLSID_WICImagingFactory, None, CLSCTX_INPROC_SERVER)?;
        let dec = f.CreateDecoderFromFilename(&HSTRING::from(path), None, GENERIC_READ, WICDecodeMetadataCacheOnDemand)?;
        let c = dec.GetContainerFormat()?;
        // 照片类的（有损）重新存成 JPEG，扫描件、截图之类的存成 PNG（无损）
        let lossy = c == GUID_ContainerFormatHeif || c == GUID_ContainerFormatJpeg || c == GUID_ContainerFormatWmp || c == GUID_ContainerFormatWebp;
        let n = dec.GetFrameCount()?.min(MAX_FRAMES);
        let mut out = n.to_le_bytes().to_vec();
        for i in 0..n {
            let frame = dec.GetFrame(i)?;
            let (mut w, mut h) = (0u32, 0u32);
            frame.GetSize(&mut w, &mut h)?;
            let (mut dx, mut dy) = (0f64, 0f64);
            let _ = frame.GetResolution(&mut dx, &mut dy);
            let data = encode(&f, &frame, w, h, dx, dy, lossy)?;
            out.extend_from_slice(&(lossy as u32).to_le_bytes());
            out.extend_from_slice(&w.to_le_bytes());
            out.extend_from_slice(&h.to_le_bytes());
            out.extend_from_slice(&dx.to_le_bytes());
            out.extend_from_slice(&dy.to_le_bytes());
            out.extend_from_slice(&(data.len() as u32).to_le_bytes());
            out.extend_from_slice(&data);
        }
        Ok(out)
    }

    unsafe fn encode(f: &IWICImagingFactory, src: &IWICBitmapFrameDecode, w: u32, h: u32, dx: f64, dy: f64, jpeg: bool) -> windows::core::Result<Vec<u8>> {
        let stream = CreateStreamOnHGlobal(HGLOBAL::default(), true)?;     // 内存里的流，释放时一起释放
        let fmt_guid = if jpeg { GUID_ContainerFormatJpeg } else { GUID_ContainerFormatPng };
        let enc = f.CreateEncoder(&fmt_guid, std::ptr::null())?;
        enc.Initialize(&stream, WICBitmapEncoderNoCache)?;
        let (mut fe, mut props) = (None, None);
        enc.CreateNewFrame(&mut fe, &mut props)?;
        let fe = fe.ok_or_else(|| Error::from(E_FAIL))?;
        fe.Initialize(props.as_ref())?;
        fe.SetSize(w, h)?;
        if dx > 0.0 && dy > 0.0 {
            let _ = fe.SetResolution(dx, dy);
        }
        // 编码器支持原来的像素格式就原样写（黑白、灰度的扫描件不会变大），不支持就转成它挑的格式
        let srcfmt = src.GetPixelFormat()?;
        let mut fmt = if jpeg { GUID_WICPixelFormat24bppBGR } else { srcfmt };
        fe.SetPixelFormat(&mut fmt)?;
        if fmt == srcfmt {
            fe.WriteSource(src, std::ptr::null())?;
        } else {
            let conv = f.CreateFormatConverter()?;
            conv.Initialize(src, &fmt, WICBitmapDitherTypeNone, None::<&IWICPalette>, 0.0, WICBitmapPaletteTypeMedianCut)?;
            fe.WriteSource(&conv, std::ptr::null())?;
        }
        fe.Commit()?;
        enc.Commit()?;
        let mut size = 0u64;
        stream.Seek(0, STREAM_SEEK_END, Some(&mut size))?;
        stream.Seek(0, STREAM_SEEK_SET, None)?;
        let mut buf = vec![0u8; size as usize];
        let mut read = 0u32;
        stream.Read(buf.as_mut_ptr().cast(), size as u32, Some(&mut read)).ok()?;
        buf.truncate(read as usize);
        Ok(buf)
    }
}

#[cfg(not(windows))]
mod wic {
    pub fn decode(_: &str) -> Result<Vec<u8>, String> {
        Err("只有 Windows 版能解这种图片".into())
    }
}
