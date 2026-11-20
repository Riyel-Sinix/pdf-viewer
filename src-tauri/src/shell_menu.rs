//! 资源管理器右键菜单里的「转成 PDF」，只对当前用户。有两种：
//! - 旧式：注册在 HKCU\Software\Classes\SystemFileAssociations\.<扩展名>\shell\PDFViewer.ConvertToPdf——不管这类文件平时用什么程序打开都会出现，
//!   不用管理员；Windows 11 上在「显示更多选项」里。点了运行 `pdf-viewer.exe --convert "文件"`。多选时资源管理器每个文件启动一次
//!   （MultiSelectModel = Player：最多 100 个，默认的 Document 超过 15 个菜单就不出现），单实例插件把它们都转给开着的窗口，
//!   前端攒一下一起转，存到源文件旁边（main.js 的 queueDirect）。
//! - Windows 11 右键菜单第一层：安装文件夹 shell-menu\ 里的 DLL（src-tauri/shell-menu，一次把选中的文件都交给程序）经稀疏包登记
//!   （身份在 shell-menu/package/identity.json）。包用自签名证书签过名（没签名的 Windows 不让它启动）：证书要装进本机「受信任的人」，
//!   这一步要管理员，安装包装好时问一次（windows/hooks.nsh 用 UAC 运行 --shell-setup-admin，顺便去掉 1.3.1–1.4.0 留下的没签名的包）；
//!   之后包按用户登记（--add-shell-package），不用管理员。用户拒绝、或者不是 Windows 11，就用旧式的。
//!   两种都在时「显示更多选项」里会出现两个，所以第一层能用时就去掉旧式的；登记上了却创建不了命令时，当作没有。
//!   这时开关只是一个记号文件（DLL 看到就不显示）：从新菜单启动的程序带着包的身份，写的注册表会被重定向（写文件不会，清单里关了），所以不靠写注册表。
//!
//! 安装版装好时加上、卸载时去掉（hooks.nsh 调下面 from_installer 等几个开关）；免安装版在 ⋯ 菜单里开关（只有旧式的）。
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
    /// 在 Windows 11 右键菜单第一层（包登记好了、指向这个程序、能创建命令）；否则是旧式的（Windows 11 上在「显示更多选项」里）
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

/// 稀疏包的身份（shell-menu/package/identity.json，打包脚本也读它）；自动化测试时用测试包的名字、发布者和 CLSID
struct Identity {
    name: String,
    publisher: String,
    version: String,
    clsid: String,
    /// 1.3.1–1.4.0 没签名的包的发布者（同一个名字），安装时去掉
    legacy_publisher: String,
    /// 安装文件夹 shell-menu\ 里的证书公钥文件名
    certificate: String,
}

fn identity() -> &'static Identity {
    static ID: OnceLock<Identity> = OnceLock::new();
    ID.get_or_init(|| {
        let v: serde_json::Value = serde_json::from_str(include_str!("../shell-menu/package/identity.json")).unwrap_or_default();
        let test = crate::test_data_dir().is_some();
        let s = |k: &str| v[k].as_str().unwrap_or_default().to_string();
        Identity {
            name: s(if test { "test_name" } else { "name" }),
            publisher: s(if test { "test_publisher" } else { "publisher" }),
            version: s("version"),
            clsid: s(if test { "test_clsid" } else { "clsid" }),
            legacy_publisher: s("legacy_publisher"),
            certificate: s("certificate"),
        }
    })
}

/// 安装文件夹里的右键组件（安装版才有）
struct Component {
    msix: PathBuf,
    /// 证书公钥（DER）
    cert: Vec<u8>,
}

fn component(exe: &Path) -> Option<Component> {
    let dir = exe.parent()?.join("shell-menu");
    let msix = dir.join("PDFViewer.ShellMenu.msix");
    if !dir.join("pdf_viewer_shell.dll").is_file() || !msix.is_file() {
        return None;
    }
    Some(Component { msix, cert: std::fs::read(dir.join(&identity().certificate)).ok()? })
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

/// Windows 11 第一层菜单在用：包指向这个程序、DLL 在，而且资源管理器真能创建出这个命令。
/// 登记上了也可能创建不了（1.3.1–1.4.0 没签名的包就这样：创建时「拒绝访问」，菜单里什么都不出现），
/// 这时当作没有，用旧式菜单，免得两种都没有
fn modern(exe: &Path) -> bool {
    exe.parent().is_some_and(|d| d.join("shell-menu").join("pdf_viewer_shell.dll").is_file()) && package_here(exe).is_some() && package::activates(&identity().clsid)
}

/// 当前用户还登记着 1.3.1–1.4.0 留下的没签名的包
fn legacy_present() -> bool {
    let id = identity();
    package::find(&id.name, &id.legacy_publisher).is_some()
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

/// 安装程序调用：`--register-shell-menu`（第一层菜单能用就去掉旧式的，不然加旧式的；用户关掉过就不加）、
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

/// 第一层菜单值得装：Windows 11、安装文件夹里有组件、用户没关掉过
fn wants_modern(exe: &Path) -> Option<Component> {
    (windows_build() >= WINDOWS_11 && !opted_out()).then(|| component(exe)).flatten()
}

/// 安装程序问（`--shell-setup-needs-admin`）：要不要用 UAC 运行 --shell-setup-admin。退出码 0 = 要：
/// 想用第一层菜单，而证书还没装进本机「受信任的人」，或者还留着没签名的旧包（它占着同一个包名）
pub fn setup_needs_admin() -> i32 {
    let Ok(exe) = std::env::current_exe() else { return 1 };
    let needed = wants_modern(&exe).is_some_and(|c| !cert::trusted(&c.cert) || legacy_present());
    i32::from(!needed)
}

/// 安装程序用 UAC 以管理员身份运行（`--shell-setup-admin`）：把证书装进本机「受信任的人」，去掉所有用户的没签名旧包。退出码 0 = 都好了
pub fn setup_admin() -> i32 {
    let r = std::env::current_exe().map_err(|e| e.to_string()).and_then(|exe| {
        let c = component(&exe).ok_or("安装文件夹里没有右键组件")?;
        cert::trust(&c.cert)?;
        let id = identity();
        package::remove_all_users(&id.name, &id.legacy_publisher)
    });
    log("信任右键组件的证书、去掉没签名的旧包", &r);
    i32::from(r.is_err())
}

/// 安装程序装好后运行（`--add-shell-package`，不用管理员）：把安装文件夹里签过名的包登记给当前用户（先去掉同名的旧版本）。
/// 不是 Windows 11、用户关掉过、证书不受信任（拒绝了管理员确认）、已经登记好且能用时什么都不做。退出码 0 = 好了或者不用做
pub fn add_package() -> i32 {
    let Ok(exe) = std::env::current_exe() else { return 1 };
    let Some(c) = wants_modern(&exe) else { return 0 };
    if !cert::trusted(&c.cert) || (package_here(&exe) == Some(true) && modern(&exe)) {
        return 0;
    }
    let id = identity();
    // 当前用户这边的没签名旧包也试着去掉（管理员那步已经去掉的话这里什么都没有）
    if let Some(old) = package::find(&id.name, &id.legacy_publisher) {
        let _ = package::remove(&old.full_name);
    }
    let r = exe.parent().ok_or_else(|| "找不到安装文件夹".to_string()).and_then(|dir| package::add(&id.name, &id.publisher, &c.msix, dir));
    log("登记 Windows 11 右键菜单", &r);
    i32::from(r.is_err())
}

/// 卸载前（`--remove-shell-package`，不用管理员）：去掉当前用户指向这个文件夹的包（别的副本登记的不动），
/// 资源管理器的 COM 代理也就退出了，DLL 能删；当前用户的没签名旧包也试着去掉。退出码 0 = 去掉了或者本来就没有
pub fn remove_package() -> i32 {
    let Ok(exe) = std::env::current_exe() else { return 1 };
    let id = identity();
    if let Some(old) = package::find(&id.name, &id.legacy_publisher) {
        let _ = package::remove(&old.full_name);
    }
    let Some(p) = package::find(&id.name, &id.publisher) else { return 0 };
    if p.external.as_deref().is_some_and(|e| exe.parent().is_none_or(|d| !same_dir(e, d))) {
        return 0;
    }
    let r = package::remove(&p.full_name);
    log("去掉 Windows 11 右键菜单", &r);
    i32::from(r.is_err())
}

/// 卸载程序问（`--shell-cleanup-needs-admin`）：要不要用 UAC 运行 --shell-cleanup-admin。退出码 0 = 要：证书还在本机「受信任的人」里，或者还留着没签名的旧包
pub fn cleanup_needs_admin() -> i32 {
    let Ok(exe) = std::env::current_exe() else { return 1 };
    let needed = component(&exe).is_some_and(|c| cert::trusted(&c.cert)) || legacy_present();
    i32::from(!needed)
}

/// 卸载程序用 UAC 以管理员身份运行（`--shell-cleanup-admin`）：去掉所有用户的没签名旧包，把证书从本机「受信任的人」里删掉
pub fn cleanup_admin() -> i32 {
    let id = identity();
    let mut r = package::remove_all_users(&id.name, &id.legacy_publisher);
    if let Some(c) = std::env::current_exe().ok().and_then(|exe| component(&exe)) {
        r = r.and(cert::untrust(&c.cert));
    }
    log("删掉右键组件的证书、去掉没签名的旧包", &r);
    i32::from(r.is_err())
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
    use windows::Management::Deployment::{AddPackageOptions, DeploymentResult, PackageManager, RemovalOptions};

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

    /// 给当前用户登记签过名的 msix，外部位置是安装文件夹（证书要已经受信任）
    pub fn add(name: &str, publisher: &str, msix: &Path, dir: &Path) -> Result<(), String> {
        if let Some(old) = find(name, publisher) {
            remove(&old.full_name)?;
        }
        let opts = AddPackageOptions::new().map_err(text)?;
        opts.SetExternalLocationUri(&file_uri(dir).map_err(text)?).map_err(text)?;
        finish(PackageManager::new().map_err(text)?.AddPackageByUriAsync(&file_uri(msix).map_err(text)?, &opts).map_err(text)?.join())
    }

    /// 资源管理器能不能创建出这个命令：像它那样经 COM 代理（dllhost）创建一次，马上放掉
    pub fn activates(clsid: &str) -> bool {
        use windows::core::{IUnknown, GUID};
        use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_LOCAL_SERVER, COINIT_MULTITHREADED};
        let Ok(id) = GUID::try_from(clsid) else { return false };
        unsafe {
            let inited = CoInitializeEx(None, COINIT_MULTITHREADED).is_ok();
            let ok = CoCreateInstance::<_, IUnknown>(&id, None, CLSCTX_LOCAL_SERVER).is_ok();
            if inited {
                CoUninitialize();
            }
            ok
        }
    }

    pub fn remove(full_name: &str) -> Result<(), String> {
        finish(PackageManager::new().map_err(text)?.RemovePackageAsync(&HSTRING::from(full_name)).map_err(text)?.join())
    }

    /// 去掉所有用户登记的这个名字和发布者的包（要管理员）
    pub fn remove_all_users(name: &str, publisher: &str) -> Result<(), String> {
        let pm = PackageManager::new().map_err(text)?;
        for p in pm.FindPackagesByNamePublisher(&HSTRING::from(name), &HSTRING::from(publisher)).map_err(text)? {
            let full = p.Id().and_then(|id| id.FullName()).map_err(text)?;
            finish(pm.RemovePackageWithOptionsAsync(&full, RemovalOptions::RemoveForAllUsers).map_err(text)?.join())?;
        }
        Ok(())
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
    pub fn remove_all_users(_: &str, _: &str) -> Result<(), String> {
        Ok(())
    }
    pub fn activates(_: &str) -> bool {
        false
    }
}

/// 右键组件包的签名证书在本机「受信任的人」里：有了它，签过名的包当前用户就能登记（不用管理员）。装、删要管理员
#[cfg(windows)]
mod cert {
    use windows::core::w;
    use windows::Win32::Security::Cryptography::{
        CertAddCertificateContextToStore, CertCloseStore, CertCreateCertificateContext, CertDeleteCertificateFromStore, CertFindCertificateInStore,
        CertFreeCertificateContext, CertOpenStore, CERT_CONTEXT, CERT_FIND_EXISTING, CERT_OPEN_STORE_FLAGS, CERT_QUERY_ENCODING_TYPE, CERT_STORE_ADD_REPLACE_EXISTING,
        CERT_STORE_OPEN_EXISTING_FLAG, CERT_STORE_PROV_SYSTEM_W, CERT_STORE_READONLY_FLAG, CERT_SYSTEM_STORE_LOCAL_MACHINE, HCERTSTORE, PKCS_7_ASN_ENCODING,
        X509_ASN_ENCODING,
    };

    const ENCODING: CERT_QUERY_ENCODING_TYPE = CERT_QUERY_ENCODING_TYPE(X509_ASN_ENCODING.0 | PKCS_7_ASN_ENCODING.0);

    /// 打开本机的「受信任的人」，用完关掉；f 拿到证书库和这张证书（der）
    fn with_store<T>(der: &[u8], write: bool, f: impl FnOnce(HCERTSTORE, *const CERT_CONTEXT) -> Result<T, String>) -> Result<T, String> {
        unsafe {
            let mut flags = CERT_SYSTEM_STORE_LOCAL_MACHINE | CERT_STORE_OPEN_EXISTING_FLAG.0;
            if !write {
                flags |= CERT_STORE_READONLY_FLAG.0;
            }
            let store = CertOpenStore(CERT_STORE_PROV_SYSTEM_W, CERT_QUERY_ENCODING_TYPE(0), None, CERT_OPEN_STORE_FLAGS(flags), Some(w!("TrustedPeople").as_ptr().cast()))
                .map_err(|e| format!("打不开本机的「受信任的人」证书库：{}", e.message().trim()))?;
            let cert = CertCreateCertificateContext(ENCODING, der);
            let r = if cert.is_null() { Err("证书文件读不出来".to_string()) } else { f(store, cert) };
            if !cert.is_null() {
                let _ = CertFreeCertificateContext(Some(cert));
            }
            let _ = CertCloseStore(Some(store), 0);
            r
        }
    }

    pub fn trusted(der: &[u8]) -> bool {
        with_store(der, false, |store, cert| unsafe {
            let found = CertFindCertificateInStore(store, ENCODING, 0, CERT_FIND_EXISTING, Some(cert.cast()), None);
            if !found.is_null() {
                let _ = CertFreeCertificateContext(Some(found));
            }
            Ok(!found.is_null())
        })
        .unwrap_or(false)
    }

    pub fn trust(der: &[u8]) -> Result<(), String> {
        with_store(der, true, |store, cert| unsafe {
            CertAddCertificateContextToStore(Some(store), cert, CERT_STORE_ADD_REPLACE_EXISTING, None).map_err(|e| format!("证书装不进本机的「受信任的人」：{}", e.message().trim()))
        })
    }

    pub fn untrust(der: &[u8]) -> Result<(), String> {
        with_store(der, true, |store, cert| unsafe {
            let found = CertFindCertificateInStore(store, ENCODING, 0, CERT_FIND_EXISTING, Some(cert.cast()), None);
            if found.is_null() {
                return Ok(());
            }
            // 成功与否都会释放 found
            CertDeleteCertificateFromStore(found).map_err(|e| format!("删不掉本机「受信任的人」里的证书：{}", e.message().trim()))
        })
    }
}

#[cfg(not(windows))]
mod cert {
    pub fn trusted(_: &[u8]) -> bool {
        false
    }
    pub fn trust(_: &[u8]) -> Result<(), String> {
        Err("只有 Windows 版有右键菜单".into())
    }
    pub fn untrust(_: &[u8]) -> Result<(), String> {
        Ok(())
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
