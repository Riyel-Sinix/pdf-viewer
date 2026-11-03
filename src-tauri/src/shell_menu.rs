//! 资源管理器右键菜单里的「转成 PDF」，只对当前用户。有两种：
//! - 旧式：注册在 HKCU\Software\Classes\SystemFileAssociations\.<扩展名>\shell\PDFViewer.ConvertToPdf——不管这类文件平时用什么程序打开都会出现，
//!   不用管理员；Windows 11 上在「显示更多选项」里。点了运行 `pdf-viewer.exe --convert "文件"`。多选时资源管理器每个文件启动一次
//!   （MultiSelectModel = Player：最多 100 个，默认的 Document 超过 15 个菜单就不出现），单实例插件把它们都转给开着的窗口，
//!   前端攒一下一起转，存到源文件旁边（main.js 的 queueDirect）。
//! - Windows 11 右键菜单第一层：安装文件夹 shell-menu\ 里的 DLL（src-tauri/shell-menu，一次把选中的文件都交给程序）经稀疏包登记
//!   （身份在 shell-menu/package/identity.json）。包没签名，登记要管理员：安装包装好时问一次（windows/hooks.nsh 用 UAC 运行 --add-shell-package）；
//!   用户拒绝、或者不是 Windows 11，就用旧式的。两种都在时「显示更多选项」里会出现两个，所以包登记好了就去掉旧式的。
//!   这时开关只是一个记号文件（DLL 看到就不显示）：从新菜单启动的程序带着包的身份，写的注册表会被重定向（写文件不会，清单里关了），所以不靠写注册表。
//!
//! 安装版装好时加上、卸载时去掉（hooks.nsh 调 --register-shell-menu、--unregister-shell-menu、--remove-shell-package）；免安装版在 ⋯ 菜单里开关（只有旧式的）。
//! 用户在菜单里关掉过的话，在程序数据文件夹里留个记号，重新安装、升级时就不再自动加回来。
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

const VERB: &str = "PDFViewer.ConvertToPdf";
/// 和 tauri.conf.json 的 identifier 一致：程序数据文件夹 %LOCALAPPDATA%\<identifier>（卸载时勾「删除应用程序数据」会一起删掉）
const IDENTIFIER: &str = "com.siiocc.pdfviewer";
/// Windows 11 能用第一层菜单（IExplorerCommand + 稀疏包）的最低版本号
const WINDOWS_11: u32 = 22000;

include!("shell_exts.rs");

#[derive(serde::Serialize)]
pub struct Status {
    /// 右键菜单里有没有「转成 PDF」
    installed: bool,
    /// 是不是指向正在运行的这个程序（免安装版挪了位置、或者另一份程序注册的，就不是）
    current: bool,
    /// 在 Windows 11 右键菜单第一层（包登记好了、指向这个程序）；否则是旧式的（Windows 11 上在「显示更多选项」里）
    modern: bool,
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

/// 「用户关掉过」的记号文件（Windows 11 第一层菜单的 DLL 也看它）
fn opt_out_marker() -> Option<PathBuf> {
    let dir = match crate::test_data_dir() {
        Some(d) => d,
        None => PathBuf::from(std::env::var_os("LOCALAPPDATA")?).join(IDENTIFIER),
    };
    Some(dir.join("shell-menu-off"))
}

fn opted_out() -> bool {
    opt_out_marker().is_some_and(|m| m.is_file())
}

fn set_opted_out(off: bool) -> Result<(), String> {
    let m = opt_out_marker().ok_or("找不到程序数据文件夹")?;
    let r = if off {
        m.parent().map_or(Ok(()), std::fs::create_dir_all).and_then(|_| std::fs::write(&m, "用户在 ⋯ 菜单里关掉了右键菜单「转成 PDF」；有这个文件时不显示，重新安装也不再自动加回来\n"))
    } else {
        match std::fs::remove_file(&m) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            r => r,
        }
    };
    r.map_err(|e| format!("记不下这个设置：{e}"))
}

/// 稀疏包的身份（shell-menu/package/identity.json，打包脚本也读它）；自动化测试时用测试包的名字和发布者
struct Identity {
    name: String,
    publisher: String,
    version: String,
}

fn identity() -> &'static Identity {
    static ID: OnceLock<Identity> = OnceLock::new();
    ID.get_or_init(|| {
        let v: serde_json::Value = serde_json::from_str(include_str!("../shell-menu/package/identity.json")).unwrap_or_default();
        let test = crate::test_data_dir().is_some();
        let s = |k: &str| v[k].as_str().unwrap_or_default().to_string();
        Identity { name: s(if test { "test_name" } else { "name" }), publisher: s(if test { "test_publisher" } else { "publisher" }), version: s("version") }
    })
}

/// 安装文件夹里的右键组件（安装版才有）：DLL 和要登记的包
fn component(exe: &Path) -> Option<(PathBuf, PathBuf)> {
    let dir = exe.parent()?.join("shell-menu");
    let (dll, msix) = (dir.join("pdf_viewer_shell.dll"), dir.join("PDFViewer.ShellMenu.msix"));
    (dll.is_file() && msix.is_file()).then_some((dll, msix))
}

fn same_dir(a: &Path, b: &Path) -> bool {
    let norm = |p: &Path| p.to_string_lossy().trim_end_matches(['\\', '/']).to_lowercase();
    norm(a) == norm(b)
}

/// 当前用户登记的包指向这个程序（外部位置就是程序所在的文件夹）时，返回它是不是这一版带的那个版本
fn package_here(exe: &Path) -> Option<bool> {
    let dir = exe.parent()?;
    let id = identity();
    let p = package::find(&id.name, &id.publisher)?;
    p.external.as_deref().is_some_and(|e| same_dir(e, dir)).then(|| p.version == id.version)
}

/// Windows 11 第一层菜单在用：包指向这个程序、DLL 在
fn modern(exe: &Path) -> bool {
    exe.parent().is_some_and(|d| d.join("shell-menu").join("pdf_viewer_shell.dll").is_file()) && package_here(exe).is_some()
}

/// 旧式的：(有没有, 是不是指向这个程序)
fn classic(exe: &Path) -> (bool, bool) {
    let cmd = reg::get_string(&format!(r"{}\command", verb_key("docx")), "");
    (cmd.is_some(), cmd.as_deref() == Some(command_for(exe).as_str()))
}

pub fn status(exe: &Path) -> Status {
    if modern(exe) {
        let on = !opted_out();
        return Status { installed: on, current: on, modern: true, exts: EXTS };
    }
    let (installed, current) = classic(exe);
    Status { installed, current, modern: false, exts: EXTS }
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
    if modern(exe) {
        // 第一层菜单在用：开关就是记号文件。顺手去掉旧式的（从新菜单启动的程序删注册表可能被重定向，不管结果）
        let _ = unregister();
        set_opted_out(!on)?;
    } else if on {
        register(exe)?;
        let _ = set_opted_out(false);
    } else {
        unregister()?;
        let _ = set_opted_out(true);
    }
    Ok(status(exe))
}

/// 安装程序调用：`--register-shell-menu`（第一层菜单登记好了就去掉旧式的，不然加旧式的；用户关掉过就不加）、
/// `--unregister-shell-menu`（只删指向这个程序的旧式菜单，别的副本注册的不动）。返回进程退出码
pub fn from_installer(register_it: bool) -> i32 {
    let Ok(exe) = std::env::current_exe() else { return 1 };
    let r = if register_it {
        if modern(&exe) {
            unregister()
        } else if opted_out() {
            Ok(())
        } else {
            register(&exe)
        }
    } else if classic(&exe).1 {
        unregister()
    } else {
        Ok(())
    };
    i32::from(r.is_err())
}

/// 安装程序问（`--shell-package-needed`）：要不要以管理员身份登记 Windows 11 第一层菜单的包。退出码 0 = 要（接着用 UAC 运行 --add-shell-package），1 = 不用：
/// 不是 Windows 11、安装文件夹里没有组件、已经登记好了（这一版的包、指向这个文件夹）、用户关掉过右键菜单，
/// 或者确认管理员后就不是这个用户了（标准用户在 UAC 里填别的管理员账号，包会登记给那个账号）
pub fn package_needed() -> i32 {
    let Ok(exe) = std::env::current_exe() else { return 1 };
    let needed = windows_build() >= WINDOWS_11 && component(&exe).is_some() && !opted_out() && package_here(&exe) != Some(true) && package::elevates_as_same_user();
    i32::from(!needed)
}

/// 安装程序用 UAC 以管理员身份运行（`--add-shell-package`）：登记安装文件夹里的包（先去掉旧的：版本、位置可能不同）。退出码 0 = 登记好了
pub fn add_package() -> i32 {
    let r = std::env::current_exe().map_err(|e| e.to_string()).and_then(|exe| {
        let dir = exe.parent().ok_or("找不到安装文件夹")?;
        let (_, msix) = component(&exe).ok_or("安装文件夹里没有右键组件")?;
        let id = identity();
        package::add(&id.name, &id.publisher, &msix, dir)
    });
    log("登记 Windows 11 右键菜单", &r);
    i32::from(r.is_err())
}

/// 卸载前（`--remove-shell-package`）：去掉指向这个文件夹的包（别的副本登记的不动），资源管理器的 COM 代理也就退出了，DLL 能删。
/// 退出码 0 = 去掉了、或者本来就没有；2 = 没去掉（没签名的包可能要管理员才能去掉，卸载程序会用 UAC 再跑一次）
pub fn remove_package() -> i32 {
    let Ok(exe) = std::env::current_exe() else { return 2 };
    let id = identity();
    let Some(p) = package::find(&id.name, &id.publisher) else { return 0 };
    if p.external.as_deref().is_some_and(|e| exe.parent().is_none_or(|d| !same_dir(e, d))) {
        return 0;
    }
    let r = package::remove(&p.full_name);
    log("去掉 Windows 11 右键菜单", &r);
    if r.is_ok() {
        0
    } else {
        2
    }
}

/// 登记、去掉包的结果记一行到临时文件夹的 pdf-viewer-shell-menu.log（以管理员身份跑时没有别的地方能看到出了什么错；自动化测试时记在测试数据文件夹）
fn log(what: &str, r: &Result<(), String>) {
    use std::io::Write;
    let line = format!("{} {what}：{}\n", now(), r.as_ref().map_or_else(|e| e.as_str(), |_| "好了"));
    let dir = crate::test_data_dir().unwrap_or_else(std::env::temp_dir);
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(dir.join("pdf-viewer-shell-menu.log")) {
        let _ = f.write_all(line.as_bytes());
    }
}

#[cfg(windows)]
fn now() -> String {
    let t = unsafe { windows::Win32::System::SystemInformation::GetLocalTime() };
    format!("{}-{:02}-{:02} {:02}:{:02}:{:02}", t.wYear, t.wMonth, t.wDay, t.wHour, t.wMinute, t.wSecond)
}

#[cfg(not(windows))]
fn now() -> String {
    String::new()
}

fn windows_build() -> u32 {
    reg::get_machine_string(r"SOFTWARE\Microsoft\Windows NT\CurrentVersion", "CurrentBuildNumber").and_then(|s| s.trim().parse().ok()).unwrap_or(0)
}

#[cfg(windows)]
mod package {
    use std::path::{Path, PathBuf};
    use windows::core::{Error, HSTRING};
    use windows::Foundation::Uri;
    use windows::Management::Deployment::{AddPackageOptions, DeploymentResult, PackageManager};

    pub struct Registered {
        pub full_name: String,
        pub version: String,
        /// 稀疏包的外部位置 = 登记时给的安装文件夹
        pub external: Option<PathBuf>,
    }

    fn text(e: Error) -> String {
        format!("{:#010x} {}", e.code().0, e.message().trim())
    }

    /// 当前用户登记的、这个名字和发布者的包（一般最多一个）
    pub fn find(name: &str, publisher: &str) -> Option<Registered> {
        let found = PackageManager::new().ok()?.FindPackagesByUserSecurityIdNamePublisher(&HSTRING::new(), &HSTRING::from(name), &HSTRING::from(publisher)).ok()?;
        let first = found.First().ok()?;
        if !first.HasCurrent().ok()? {
            return None;
        }
        let p = first.Current().ok()?;
        let id = p.Id().ok()?;
        let v = id.Version().ok()?;
        Some(Registered {
            full_name: id.FullName().ok()?.to_string(),
            version: format!("{}.{}.{}.{}", v.Major, v.Minor, v.Build, v.Revision),
            external: p.EffectiveExternalPath().ok().map(|s| PathBuf::from(s.to_os_string())).filter(|p| !p.as_os_str().is_empty()),
        })
    }

    /// 登记 msix，外部位置是安装文件夹。没签名（发布者带微软规定的 OID），包里有可执行的东西，要管理员
    pub fn add(name: &str, publisher: &str, msix: &Path, dir: &Path) -> Result<(), String> {
        if let Some(old) = find(name, publisher) {
            remove(&old.full_name)?;
        }
        let opts = AddPackageOptions::new().map_err(text)?;
        opts.SetAllowUnsigned(true).map_err(text)?;
        opts.SetExternalLocationUri(&file_uri(dir).map_err(text)?).map_err(text)?;
        finish(PackageManager::new().map_err(text)?.AddPackageByUriAsync(&file_uri(msix).map_err(text)?, &opts).map_err(text)?.join())
    }

    pub fn remove(full_name: &str) -> Result<(), String> {
        finish(PackageManager::new().map_err(text)?.RemovePackageAsync(&HSTRING::from(full_name)).map_err(text)?.join())
    }

    /// 部署做完（join）的结果。join 成功不代表部署成功，要看结果里的 ExtendedErrorCode / ErrorText
    fn finish(done: windows::core::Result<DeploymentResult>) -> Result<(), String> {
        let done = done.map_err(text)?;
        match done.ExtendedErrorCode() {
            Ok(code) if code.is_err() => Err(format!("{:#010x} {}", code.0, done.ErrorText().map(|t| t.to_string()).unwrap_or_default().trim())),
            _ => Ok(()),
        }
    }

    /// 直接用 Windows 路径（实测带空格、中文、# 和 % 的文件夹都认得）。自己拼 file:/// 网址、按 UTF-8 百分号编码的话，
    /// 部署引擎按本机代码页解码中文，找不到文件
    fn file_uri(p: &Path) -> windows::core::Result<Uri> {
        Uri::CreateUri(&HSTRING::from(p.as_os_str()))
    }

    /// 弹 UAC 以后还是这个用户吗：管理员账号（拆分的令牌，或者关了 UAC）是；标准用户要在 UAC 里填别的管理员账号，就不是
    pub fn elevates_as_same_user() -> bool {
        use windows::Win32::Foundation::{CloseHandle, HANDLE};
        use windows::Win32::Security::{
            CheckTokenMembership, CreateWellKnownSid, GetTokenInformation, TokenElevationType, TokenElevationTypeDefault, WinBuiltinAdministratorsSid, PSID,
            SECURITY_MAX_SID_SIZE, TOKEN_ELEVATION_TYPE, TOKEN_QUERY,
        };
        use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
        unsafe {
            let mut token = HANDLE::default();
            if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token).is_err() {
                return false;
            }
            let mut kind = TOKEN_ELEVATION_TYPE::default();
            let mut len = 0u32;
            let ok = GetTokenInformation(token, TokenElevationType, Some((&mut kind as *mut TOKEN_ELEVATION_TYPE).cast()), std::mem::size_of::<TOKEN_ELEVATION_TYPE>() as u32, &mut len).is_ok();
            let _ = CloseHandle(token);
            if !ok {
                return false;
            }
            if kind != TokenElevationTypeDefault {
                return true; // 拆分的令牌：管理员账号，确认后还是自己
            }
            // 没拆分：关了 UAC 的管理员（已经是管理员身份），或者标准用户
            let mut sid = [0u8; SECURITY_MAX_SID_SIZE as usize];
            let mut size = sid.len() as u32;
            let psid = PSID(sid.as_mut_ptr().cast());
            let mut member = windows::core::BOOL(0);
            CreateWellKnownSid(WinBuiltinAdministratorsSid, None, Some(psid), &mut size).is_ok() && CheckTokenMembership(None, psid, &mut member).is_ok() && member.as_bool()
        }
    }
}

#[cfg(not(windows))]
mod package {
    use std::path::{Path, PathBuf};
    pub struct Registered {
        pub full_name: String,
        pub version: String,
        pub external: Option<PathBuf>,
    }
    pub fn find(_: &str, _: &str) -> Option<Registered> {
        None
    }
    pub fn add(_: &str, _: &str, _: &Path, _: &Path) -> Result<(), String> {
        Err("只有 Windows 版有右键菜单".into())
    }
    pub fn remove(_: &str) -> Result<(), String> {
        Ok(())
    }
    pub fn elevates_as_same_user() -> bool {
        false
    }
}

#[cfg(windows)]
mod reg {
    use windows::core::{HSTRING, PCWSTR};
    use windows::Win32::Foundation::{ERROR_FILE_NOT_FOUND, ERROR_SUCCESS, WIN32_ERROR};
    use windows::Win32::System::Registry::{
        RegCloseKey, RegCreateKeyExW, RegDeleteTreeW, RegGetValueW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_WRITE,
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

    fn get(root: HKEY, key: &str, name: &str) -> Option<String> {
        let (k, n) = (HSTRING::from(key), HSTRING::from(name));
        let mut len = 0u32;
        unsafe {
            if RegGetValueW(root, &k, &n, RRF_RT_REG_SZ, None, None, Some(&mut len)) != ERROR_SUCCESS {
                return None;
            }
            let mut buf = vec![0u16; (len as usize).div_ceil(2)];
            if RegGetValueW(root, &k, &n, RRF_RT_REG_SZ, None, Some(buf.as_mut_ptr().cast()), Some(&mut len)) != ERROR_SUCCESS {
                return None;
            }
            let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
            Some(String::from_utf16_lossy(&buf[..end]))
        }
    }

    pub fn get_string(key: &str, name: &str) -> Option<String> {
        get(HKEY_CURRENT_USER, key, name)
    }

    pub fn get_machine_string(key: &str, name: &str) -> Option<String> {
        get(HKEY_LOCAL_MACHINE, key, name)
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
    pub fn get_machine_string(_: &str, _: &str) -> Option<String> {
        None
    }
}
