//! PDF 查看器的桌面外壳：窗口、文件读写、系统对话框、单实例转发、转成 PDF（convert.rs）。界面和 PDF 处理都在 src/（pdf.js + pdf-lib）。
use std::path::{Path, PathBuf};
use std::sync::Mutex;

mod convert;

use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

/// 启动参数里带的文件（资源管理器「打开方式」、拖到程序图标上），等页面准备好了来取
struct InitialFiles(Mutex<Vec<String>>);

/// 从命令行参数里挑出存在的文件；相对路径按 cwd 解析
fn file_args<I: IntoIterator<Item = String>>(args: I, cwd: Option<&Path>) -> Vec<String> {
    args.into_iter()
        .skip(1)
        .filter(|a| !a.starts_with('-'))
        .filter_map(|a| {
            let p = PathBuf::from(&a);
            let p = if p.is_absolute() {
                p
            } else {
                match cwd {
                    Some(c) => c.join(&p),
                    None => std::env::current_dir().ok()?.join(&p),
                }
            };
            p.is_file().then(|| p.to_string_lossy().into_owned())
        })
        .collect()
}

fn percent_decode(s: &str) -> Result<String, String> {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            let v = std::str::from_utf8(&b[i + 1..i + 3])
                .ok()
                .and_then(|h| u8::from_str_radix(h, 16).ok())
                .ok_or("路径编码不对")?;
            out.push(v);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(out).map_err(|_| "路径编码不对".into())
}

/// 先写到同目录的临时文件再改名：写到一半出错时不会把原文件弄坏
fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".part");
    let tmp = PathBuf::from(tmp);
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, path).inspect_err(|_| {
        let _ = std::fs::remove_file(&tmp);
    })
}

#[tauri::command]
fn take_initial_files(state: State<'_, InitialFiles>) -> Vec<String> {
    std::mem::take(&mut *state.0.lock().unwrap())
}

#[tauri::command]
async fn read_file(path: String) -> Result<Response, String> {
    tauri::async_runtime::spawn_blocking(move || std::fs::read(&path))
        .await
        .map_err(|e| e.to_string())?
        .map(Response::new)
        .map_err(|e| format!("读不了这个文件：{e}"))
}

/// 请求体是文件内容（二进制），路径放在 x-path 头里（百分号编码，支持中文路径）
#[tauri::command]
async fn write_file(request: Request<'_>) -> Result<(), String> {
    let path = request
        .headers()
        .get("x-path")
        .and_then(|v| v.to_str().ok())
        .ok_or("缺少保存路径")?;
    let path = percent_decode(path)?;
    let bytes = match request.body() {
        InvokeBody::Raw(b) => b.clone(),
        _ => return Err("数据格式不对".into()),
    };
    tauri::async_runtime::spawn_blocking(move || write_atomic(Path::new(&path), &bytes))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("保存失败：{e}"))
}

/// 自动化测试（PDFVIEWER_TEST_OFFSCREEN）时用单独的 WebView2 数据目录，不把测试文件写进用户的「最近打开」；平时返回 None
pub(crate) fn test_data_dir() -> Option<PathBuf> {
    std::env::var_os("PDFVIEWER_TEST_OFFSCREEN")?;
    Some(
        std::env::var_os("PDFVIEWER_TEST_DATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| std::env::temp_dir().join("pdf-viewer-test")),
    )
}

#[derive(serde::Deserialize)]
struct FileFilter {
    name: String,
    extensions: Vec<String>,
}

/// 打开文件的对话框；filters 由前端给（PDF、能转成 PDF 的各类文件……），第一个是默认的
#[tauri::command]
async fn pick_files(window: WebviewWindow, multiple: bool, title: Option<String>, filters: Vec<FileFilter>) -> Vec<String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut d = window.dialog().file().set_parent(&window);
        for f in &filters {
            let ext: Vec<&str> = f.extensions.iter().map(String::as_str).collect();
            d = d.add_filter(&f.name, &ext);
        }
        if let Some(t) = title {
            d = d.set_title(t);
        }
        let picked = if multiple {
            d.blocking_pick_files().unwrap_or_default()
        } else {
            d.blocking_pick_file().into_iter().collect()
        };
        picked
            .into_iter()
            .filter_map(|p| p.into_path().ok())
            .map(|p| p.to_string_lossy().into_owned())
            .collect()
    })
    .await
    .unwrap_or_default()
}

#[tauri::command]
async fn save_pdf_dialog(window: WebviewWindow, file_name: String, directory: Option<String>) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut d = window
            .dialog()
            .file()
            .add_filter("PDF 文件", &["pdf"])
            .set_file_name(&file_name)
            .set_parent(&window);
        if let Some(dir) = directory.filter(|d| Path::new(d).is_dir()) {
            d = d.set_directory(dir);
        }
        let p = d.blocking_save_file()?.into_path().ok()?;
        let p = if p.extension().is_some_and(|e| e.eq_ignore_ascii_case("pdf")) {
            p
        } else {
            let mut s = p.into_os_string();
            s.push(".pdf");
            PathBuf::from(s)
        };
        Some(p.to_string_lossy().into_owned())
    })
    .await
    .ok()
    .flatten()
}

#[tauri::command]
fn open_external(app: AppHandle, url: String) -> Result<(), String> {
    let lower = url.to_ascii_lowercase();
    if !(lower.starts_with("http://") || lower.starts_with("https://") || lower.starts_with("mailto:")) {
        return Err("只能打开网址".into());
    }
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
fn reveal_in_folder(app: AppHandle, path: String) -> Result<(), String> {
    app.opener().reveal_item_in_dir(path).map_err(|e| e.to_string())
}

#[tauri::command]
fn paths_exist(paths: Vec<String>) -> Vec<bool> {
    paths.iter().map(|p| Path::new(p).is_file()).collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let initial = file_args(std::env::args(), None);
    tauri::Builder::default()
        // 已经开着时再打开 PDF：交给正在运行的窗口，开成新标签页
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            let files = file_args(argv, Some(Path::new(&cwd)));
            if let Some(w) = app.get_webview_window("main") {
                // 平时要把窗口提到前面；自动化测试时不要抢用户正在用的窗口的焦点
                if std::env::var_os("PDFVIEWER_TEST_OFFSCREEN").is_none() {
                    let _ = w.unminimize();
                    let _ = w.show();
                    let _ = w.set_focus();
                }
                if !files.is_empty() {
                    let _ = w.emit("open-files", files);
                }
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(InitialFiles(Mutex::new(initial)))
        .invoke_handler(tauri::generate_handler![
            take_initial_files,
            read_file,
            write_file,
            pick_files,
            save_pdf_dialog,
            open_external,
            reveal_in_folder,
            paths_exist,
            convert::convert_office,
            convert::print_pdf,
            convert::decode_image
        ])
        .setup(|app| {
            // 自动化测试用：窗口放到屏幕外，而且永远不会被激活（不抢用户正在用的窗口的焦点）
            let test_data = test_data_dir();
            let offscreen = test_data.is_some();
            let mut b = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("PDF 查看器")
                .inner_size(1280.0, 860.0)
                .min_inner_size(760.0, 520.0)
                .decorations(false)
                .shadow(true)
                .visible(false)
                // 只许停留在应用自己的页面里；PDF 里的外部链接由前端交给系统浏览器
                .on_navigation(|url| matches!(url.scheme(), "tauri" | "asset") || url.host_str() == Some("tauri.localhost"));
            b = match test_data {
                Some(data) => b.focused(false).focusable(false).data_directory(data),
                None => b.center(),
            };
            let win = b.build()?;
            if offscreen {
                // 注意：建窗时给的位置如果不在任何显示器上，tao 会悄悄改用系统默认位置（屏幕左上角），
                // 所以先隐藏着建好，再挪到屏幕外，最后不激活地显示
                win.set_position(tauri::PhysicalPosition::new(-7000, 40))?;
                win.show()?;
            }
            // 页面画好后会自己显示窗口；万一没有，2.5 秒后兜底
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(2500));
                if !win.is_visible().unwrap_or(true) {
                    let _ = win.show();
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("启动 PDF 查看器失败");
}
