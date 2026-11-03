//! 资源管理器右键菜单里的「转成 PDF」：只对当前用户，不用管理员权限。
//! 注册在 HKCU\Software\Classes\SystemFileAssociations\.<扩展名>\shell\PDFViewer.ConvertToPdf——不管这类文件平时用什么程序打开都会出现；
//! Windows 11 上在「显示更多选项」里（新菜单只收打包过的应用）。
//! 点了运行 `pdf-viewer.exe --convert "文件"`。多选时资源管理器每个文件启动一次（MultiSelectModel = Player：最多 100 个，默认的 Document 超过 15 个菜单就不出现），
//! 单实例插件把它们都转给开着的窗口，前端攒一下一起转，存到源文件旁边（main.js 的 queueDirect）。
//! 安装版装好时注册、卸载时删掉（windows/hooks.nsh 调 --register-shell-menu / --unregister-shell-menu）；免安装版在 ⋯ 菜单里开关。
//! 用户在菜单里关掉过的话，在程序数据文件夹里留个记号，重新安装、升级时就不再自动加回来。
use std::path::{Path, PathBuf};

const VERB: &str = "PDFViewer.ConvertToPdf";
/// 和 tauri.conf.json 的 identifier 一致：程序数据文件夹 %LOCALAPPDATA%\<identifier>（卸载时勾「删除应用程序数据」会一起删掉）
const IDENTIFIER: &str = "com.siiocc.pdfviewer";

/// 出现「转成 PDF」的文件类型：常见的图片、Office 文档、Markdown、CSV、网页和纯文本（都在 convert.js 的 EXTS 里）。
/// 代码文件虽然也能转，但不加——不然右键菜单到处都是
pub const EXTS: &[&str] = &[
    "jpg", "jpeg", "jpe", "jfif", "png", "gif", "webp", "bmp", "avif", "svg", "tif", "tiff", "heic", "heif", "jxr",
    "doc", "docx", "docm", "rtf", "odt", "wps",
    "xls", "xlsx", "xlsm", "xlsb", "ods", "et",
    "ppt", "pptx", "pptm", "pps", "ppsx", "odp", "dps",
    "md", "markdown", "csv", "tsv", "html", "htm", "mht", "mhtml", "txt",
];

#[derive(serde::Serialize)]
pub struct Status {
    /// 右键菜单里有没有「转成 PDF」
    installed: bool,
    /// 是不是指向正在运行的这个程序（免安装版挪了位置、或者另一份程序注册的，就不是）
    current: bool,
    exts: &'static [&'static str],
}

/// 放 Classes 的位置：平时是 HKCU\Software\Classes；自动化测试时写到单独的地方，不碰真正的右键菜单
fn classes() -> &'static str {
    if crate::test_data_dir().is_some() {
        r"Software\PDFViewerTest\Classes"
    } else {
        r"Software\Classes"
    }
}

fn verb_key(ext: &str) -> String {
    format!(r"{}\SystemFileAssociations\.{ext}\shell\{VERB}", classes())
}

fn command_for(exe: &Path) -> String {
    format!("\"{}\" --convert \"%1\"", exe.display())
}

/// 「用户关掉过」的记号文件
fn opt_out_marker() -> Option<PathBuf> {
    let dir = match crate::test_data_dir() {
        Some(d) => d,
        None => PathBuf::from(std::env::var_os("LOCALAPPDATA")?).join(IDENTIFIER),
    };
    Some(dir.join("shell-menu-off"))
}

pub fn status(exe: &Path) -> Status {
    let cmd = reg::get_string(&format!(r"{}\command", verb_key("docx")), "");
    Status { installed: cmd.is_some(), current: cmd.as_deref() == Some(command_for(exe).as_str()), exts: EXTS }
}

pub fn register(exe: &Path) -> Result<(), String> {
    let (cmd, icon) = (command_for(exe), format!("\"{}\",0", exe.display()));
    for ext in EXTS {
        let key = verb_key(ext);
        reg::set_strings(&key, &[("MUIVerb", "转成 PDF"), ("Icon", &icon), ("MultiSelectModel", "Player")])?;
        reg::set_strings(&format!(r"{key}\command"), &[("", &cmd)])?;
    }
    Ok(())
}

pub fn unregister() -> Result<(), String> {
    let mut first = Ok(());
    for ext in EXTS {
        if let Err(e) = reg::delete_tree(&verb_key(ext)) {
            first = first.and(Err(e));
        }
    }
    if crate::test_data_dir().is_some() {
        let _ = reg::delete_tree(r"Software\PDFViewerTest");
    }
    first
}

/// ⋯ 菜单里的开关：同时记下用户的选择（关掉过的，重新安装时不再加回来）
pub fn set(exe: &Path, on: bool) -> Result<Status, String> {
    if on {
        register(exe)?;
        if let Some(m) = opt_out_marker() {
            let _ = std::fs::remove_file(m);
        }
    } else {
        unregister()?;
        if let Some(m) = opt_out_marker() {
            let _ = m.parent().map(std::fs::create_dir_all);
            let _ = std::fs::write(m, "用户在 ⋯ 菜单里关掉了右键菜单「转成 PDF」；有这个文件时，重新安装不再自动加回来\n");
        }
    }
    Ok(status(exe))
}

/// 安装程序调用：`--register-shell-menu`（用户关掉过就不加）、`--unregister-shell-menu`（只删指向这个程序的，别的副本注册的不动）。返回进程退出码
pub fn from_installer(register_it: bool) -> i32 {
    let Ok(exe) = std::env::current_exe() else { return 1 };
    let r = if register_it {
        if opt_out_marker().is_some_and(|m| m.is_file()) {
            Ok(())
        } else {
            register(&exe)
        }
    } else if status(&exe).current {
        unregister()
    } else {
        Ok(())
    };
    i32::from(r.is_err())
}

#[cfg(windows)]
mod reg {
    use windows::core::{HSTRING, PCWSTR};
    use windows::Win32::Foundation::{ERROR_FILE_NOT_FOUND, ERROR_SUCCESS, WIN32_ERROR};
    use windows::Win32::System::Registry::{
        RegCloseKey, RegCreateKeyExW, RegDeleteTreeW, RegGetValueW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, KEY_WRITE,
        REG_OPTION_NON_VOLATILE, REG_SZ, RRF_RT_REG_SZ,
    };

    fn check(e: WIN32_ERROR, what: &str) -> Result<(), String> {
        if e == ERROR_SUCCESS {
            Ok(())
        } else {
            Err(format!("{what}：{}", windows::core::Error::from_hresult(e.to_hresult()).message().trim()))
        }
    }

    /// 建好（或打开）HKCU 下的键，写进几个字符串值；值名为空是默认值
    pub fn set_strings(key: &str, values: &[(&str, &str)]) -> Result<(), String> {
        unsafe {
            let mut h = HKEY::default();
            check(
                RegCreateKeyExW(HKEY_CURRENT_USER, &HSTRING::from(key), None, PCWSTR::null(), REG_OPTION_NON_VOLATILE, KEY_WRITE, None, &mut h, None),
                "写不了注册表",
            )?;
            let mut r = Ok(());
            for (name, value) in values {
                let wide: Vec<u16> = value.encode_utf16().chain(Some(0)).collect();
                let bytes = std::slice::from_raw_parts(wide.as_ptr().cast::<u8>(), wide.len() * 2);
                r = check(RegSetValueExW(h, &HSTRING::from(*name), None, REG_SZ, Some(bytes)), "写不了注册表");
                if r.is_err() {
                    break;
                }
            }
            let _ = RegCloseKey(h);
            r
        }
    }

    pub fn delete_tree(key: &str) -> Result<(), String> {
        let e = unsafe { RegDeleteTreeW(HKEY_CURRENT_USER, &HSTRING::from(key)) };
        if e == ERROR_FILE_NOT_FOUND {
            Ok(())
        } else {
            check(e, "删不了注册表项")
        }
    }

    pub fn get_string(key: &str, name: &str) -> Option<String> {
        let (k, n) = (HSTRING::from(key), HSTRING::from(name));
        let mut len = 0u32;
        unsafe {
            if RegGetValueW(HKEY_CURRENT_USER, &k, &n, RRF_RT_REG_SZ, None, None, Some(&mut len)) != ERROR_SUCCESS {
                return None;
            }
            let mut buf = vec![0u16; (len as usize).div_ceil(2)];
            if RegGetValueW(HKEY_CURRENT_USER, &k, &n, RRF_RT_REG_SZ, None, Some(buf.as_mut_ptr().cast()), Some(&mut len)) != ERROR_SUCCESS {
                return None;
            }
            let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
            Some(String::from_utf16_lossy(&buf[..end]))
        }
    }
}

#[cfg(not(windows))]
mod reg {
    pub fn set_strings(_: &str, _: &[(&str, &str)]) -> Result<(), String> {
        Err("只有 Windows 版有右键菜单".into())
    }
    pub fn delete_tree(_: &str) -> Result<(), String> {
        Ok(())
    }
    pub fn get_string(_: &str, _: &str) -> Option<String> {
        None
    }
}
