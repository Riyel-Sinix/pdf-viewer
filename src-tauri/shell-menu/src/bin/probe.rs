//! 端到端测试（tools/shell-menu-e2e.mjs）用的假程序：装成 pdf-viewer.exe，被右键组件启动时把收到的参数、
//! 自己是不是带着包身份追加写进旁边的 probe.json（一行一次）。
//! 再像真程序那样往 %LOCALAPPDATA%、临时文件夹（转换时交给 Word/Excel 的中间文件在这）和 HKCU 各写一样东西（测试专用的名字），
//! 测试从外面看它们是不是落在平常的地方，没被重定向进包自己的文件夹（不然从右键菜单打开和平时打开的程序看到的设置、数据就不是同一份）
#![windows_subsystem = "windows"]
use std::io::Write;
use std::path::PathBuf;
use windows::core::{w, PCWSTR};
use windows::Win32::Storage::Packaging::Appx::GetCurrentPackageFullName;
use windows::Win32::System::Registry::{RegCloseKey, RegCreateKeyExW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, KEY_WRITE, REG_OPTION_NON_VOLATILE, REG_SZ};

const APPMODEL_ERROR_NO_PACKAGE: u32 = 15700;

fn quote(s: &str) -> String {
    format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""))
}

/// 写一个标记文件；返回 {"path":…,"err":…}（err 为 null 表示写成了）
fn mark(file: Option<PathBuf>) -> String {
    let Some(file) = file else { return "null".into() };
    let r = file.parent().map_or(Ok(()), std::fs::create_dir_all).and_then(|_| std::fs::write(&file, "probe"));
    let err = r.err().map_or_else(|| "null".to_string(), |e| quote(&e.to_string()));
    format!("{{\"path\":{},\"err\":{err}}}", quote(&file.to_string_lossy()))
}

fn mark_registry() -> u32 {
    unsafe {
        let mut h = HKEY::default();
        let e = RegCreateKeyExW(HKEY_CURRENT_USER, w!("Software\\PDFViewerTest\\ShellE2E"), None, PCWSTR::null(), REG_OPTION_NON_VOLATILE, KEY_WRITE, None, &mut h, None);
        if e.is_err() {
            return e.0;
        }
        let wide: Vec<u16> = "probe".encode_utf16().chain(Some(0)).collect();
        let e = RegSetValueExW(h, w!("Marker"), None, REG_SZ, Some(std::slice::from_raw_parts(wide.as_ptr().cast::<u8>(), wide.len() * 2)));
        let _ = RegCloseKey(h);
        e.0
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut len = 0u32;
    let packaged = unsafe { GetCurrentPackageFullName(&mut len, None) }.0 != APPMODEL_ERROR_NO_PACKAGE;
    let local = mark(std::env::var_os("LOCALAPPDATA").map(|d| PathBuf::from(d).join("com.siiocc.pdfviewer.e2etest").join("marker.txt")));
    let temp = mark(Some(std::env::temp_dir().join("com.siiocc.pdfviewer.e2etest-marker.txt")));
    let reg = mark_registry();
    let line = format!(
        "{{\"args\":[{}],\"packaged\":{packaged},\"local\":{local},\"temp\":{temp},\"reg\":{reg}}}",
        args.iter().map(|a| quote(a)).collect::<Vec<_>>().join(",")
    );
    if let Ok(exe) = std::env::current_exe() {
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(exe.with_file_name("probe.json")) {
            let _ = writeln!(f, "{line}");
        }
    }
}
