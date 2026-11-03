//! 端到端测试（tools/shell-menu-e2e.mjs）的客户端：像资源管理器那样，通过包里登记的 COM 代理（dllhost，CLSCTX_LOCAL_SERVER）
//! 创建「转成 PDF」命令（测试包登记的是测试专用的 CLSID），问标题、图标、几种选择下显不显示，再对能转的文件 Invoke。结果打印成一行 JSON。
//!   e2e.exe 能转的文件… -- 不能转的文件
use std::os::windows::ffi::OsStrExt;
use std::path::PathBuf;

use pdf_viewer_shell::CLSID_CONVERT_TEST;
use windows::core::{Result, PCWSTR};
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoTaskMemFree, IBindCtx, CLSCTX_LOCAL_SERVER, COINIT_APARTMENTTHREADED};
use windows::Win32::UI::Shell::{ILCreateFromPathW, ILFree, IExplorerCommand, IShellItemArray, SHCreateShellItemArrayFromIDLists};

fn items(paths: &[PathBuf]) -> Result<IShellItemArray> {
    unsafe {
        let pidls: Vec<_> = paths
            .iter()
            .map(|p| {
                let w: Vec<u16> = p.as_os_str().encode_wide().chain(Some(0)).collect();
                ILCreateFromPathW(PCWSTR(w.as_ptr())) as *const _
            })
            .collect();
        let arr = SHCreateShellItemArrayFromIDLists(&pidls);
        for p in pidls {
            ILFree(Some(p));
        }
        arr
    }
}

fn text(p: windows::core::PWSTR) -> String {
    let s = unsafe { p.to_string() }.unwrap_or_default();
    unsafe { CoTaskMemFree(Some(p.0 as *const _)) };
    s
}

fn quote(s: &str) -> String {
    format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""))
}

fn run() -> Result<String> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let split = args.iter().position(|a| a == "--").unwrap_or(args.len());
    let good: Vec<PathBuf> = args[..split].iter().map(PathBuf::from).collect();
    let bad: Vec<PathBuf> = args.get(split + 1..).unwrap_or_default().iter().map(PathBuf::from).collect();
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let cmd: IExplorerCommand = CoCreateInstance(&CLSID_CONVERT_TEST, None, CLSCTX_LOCAL_SERVER)?;
        let title = text(cmd.GetTitle(None::<&IShellItemArray>)?);
        let icon = text(cmd.GetIcon(None::<&IShellItemArray>)?);
        let state = |ps: &[PathBuf]| -> Result<u32> { cmd.GetState(&items(ps)?, false) };
        let ok = state(&good)?;
        let one_bad = state(&bad)?;
        let mut mixed: Vec<PathBuf> = good.iter().take(1).cloned().collect();
        mixed.extend(bad.iter().cloned());
        let mixed = state(&mixed)?;
        cmd.Invoke(&items(&good)?, None::<&IBindCtx>)?;
        Ok(format!("{{\"title\":{},\"icon\":{},\"state_ok\":{ok},\"state_bad\":{one_bad},\"state_mixed\":{mixed},\"invoked\":true}}", quote(&title), quote(&icon)))
    }
}

fn main() {
    match run() {
        Ok(s) => println!("{s}"),
        Err(e) => println!("{{\"error\":{}}}", quote(&format!("{:#010x} {}", e.code().0, e.message()))),
    }
}
