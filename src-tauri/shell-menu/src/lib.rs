//! PDF 查看器在 Windows 11 右键菜单第一层的「转成 PDF」。
//! Windows 11 的新右键菜单只收带包身份的 IExplorerCommand：这个 DLL 实现它，由稀疏包（package/AppxManifest.xml）登记给资源管理器，
//! 在 COM 代理进程（dllhost）里运行。点了以后启动安装文件夹里的 pdf-viewer.exe --convert 文件……（DLL 在它下面的 shell-menu 里），
//! 后面的事（单实例、转换、存到源文件旁边）都归程序管。
//! 文件类型和旧式右键菜单同一份（src/shell_exts.rs）；用户在程序 ⋯ 菜单里关掉时（%LOCALAPPDATA%\com.siiocc.pdfviewer\shell-menu-off），这里就不显示。
#![allow(non_snake_case)]

use std::ffi::{c_void, OsString};
use std::os::windows::ffi::{OsStrExt, OsStringExt};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicIsize, AtomicUsize, Ordering};

use windows::core::{implement, w, Interface, Ref, Result, BOOL, GUID, HRESULT, PCWSTR, PWSTR};
use windows::Win32::Foundation::{CLASS_E_CLASSNOTAVAILABLE, CLASS_E_NOAGGREGATION, E_FAIL, E_NOTIMPL, E_POINTER, HMODULE, S_FALSE, S_OK};
use windows::Win32::System::Com::{CoTaskMemFree, IBindCtx, IClassFactory, IClassFactory_Impl};
use windows::Win32::System::LibraryLoader::GetModuleFileNameW;
use windows::Win32::System::SystemServices::DLL_PROCESS_ATTACH;
use windows::Win32::UI::Shell::{IEnumExplorerCommand, IExplorerCommand, IExplorerCommand_Impl, IShellItemArray, SHStrDupW, ECF_DEFAULT, ECS_ENABLED, ECS_HIDDEN, SIGDN_FILESYSPATH};

include!("../../src/shell_exts.rs");

/// 这个命令的 COM 类（和 package/AppxManifest.xml 里的一致）
pub const CLSID_CONVERT: GUID = GUID::from_u128(0xd8c38e96_983e_449d_8781_ca21213f766a);
/// 端到端测试的包（tools/shell-menu-e2e.mjs）登记的是这个：和正式的分开，测试登记、去掉登记碰不到用户装好的菜单。
/// 两个都要和 package/identity.json 一致（打包脚本会查）
pub const CLSID_CONVERT_TEST: GUID = GUID::from_u128(0xb05b0d91_d689_4a62_b369_31ffe4907d93);
/// 和程序的 identifier 一致：程序数据文件夹，用户关掉右键菜单时在里面留的记号
const IDENTIFIER: &str = "com.siiocc.pdfviewer";
/// 一条命令行最多 32767 个字符，文件多的时候分几次启动（程序是单实例，后面几次会转给第一个）
const MAX_CMDLINE: usize = 30000;

static MODULE: AtomicIsize = AtomicIsize::new(0);
static LIVE: AtomicUsize = AtomicUsize::new(0);

#[no_mangle]
extern "system" fn DllMain(module: HMODULE, reason: u32, _: *mut c_void) -> BOOL {
    if reason == DLL_PROCESS_ATTACH {
        MODULE.store(module.0 as isize, Ordering::Relaxed);
    }
    true.into()
}

/// 这个 DLL 所在的文件夹
fn module_dir() -> Option<PathBuf> {
    let m = HMODULE(MODULE.load(Ordering::Relaxed) as *mut c_void);
    let mut buf = vec![0u16; 512];
    loop {
        let n = unsafe { GetModuleFileNameW(Some(m), &mut buf) } as usize;
        if n == 0 {
            return None;
        }
        if n < buf.len() {
            return Some(PathBuf::from(OsString::from_wide(&buf[..n])).parent()?.to_path_buf());
        }
        buf.resize(buf.len() * 2, 0);
    }
}

/// 程序本体：DLL 在安装文件夹的 shell-menu 里，程序在上一层
pub fn app_exe() -> Option<PathBuf> {
    Some(module_dir()?.parent()?.join("pdf-viewer.exe"))
}

fn opted_out() -> bool {
    std::env::var_os("LOCALAPPDATA").is_some_and(|d| Path::new(&d).join(IDENTIFIER).join("shell-menu-off").is_file())
}

pub fn convertible(p: &Path) -> bool {
    p.extension().and_then(|e| e.to_str()).is_some_and(|e| EXTS.iter().any(|x| x.eq_ignore_ascii_case(e)))
}

/// 选中的各项在文件系统里的路径；有一项不是文件系统里的东西（库、手机里的照片之类）就是 None
fn paths(items: Option<&IShellItemArray>) -> Option<Vec<PathBuf>> {
    let items = items?;
    let n = unsafe { items.GetCount() }.ok()?;
    let mut out = Vec::with_capacity(n as usize);
    for i in 0..n {
        let item = unsafe { items.GetItemAt(i) }.ok()?;
        let p = unsafe { item.GetDisplayName(SIGDN_FILESYSPATH) }.ok()?;
        let s = OsString::from_wide(unsafe { p.as_wide() });
        unsafe { CoTaskMemFree(Some(p.0 as *const c_void)) };
        out.push(PathBuf::from(s));
    }
    Some(out)
}

/// 选中的全是能转的文件才显示
pub fn should_show(paths: Option<&[PathBuf]>) -> bool {
    !opted_out() && paths.is_some_and(|ps| !ps.is_empty() && ps.iter().all(|p| convertible(p)))
}

/// 启动程序的命令行（每段都加引号——Windows 路径里不会有引号），超长时分成几条
pub fn command_lines(exe: &Path, files: &[PathBuf]) -> Vec<OsString> {
    let head = {
        let mut s = OsString::from("\"");
        s.push(exe.as_os_str());
        s.push("\" --convert");
        s
    };
    let mut out = Vec::new();
    let mut cur = head.clone();
    let mut count = 0;
    for f in files {
        let len = f.as_os_str().encode_wide().count() + 3;
        if count > 0 && cur.encode_wide().count() + len > MAX_CMDLINE {
            out.push(std::mem::replace(&mut cur, head.clone()));
            count = 0;
        }
        cur.push(" \"");
        cur.push(f.as_os_str());
        cur.push("\"");
        count += 1;
    }
    if count > 0 {
        out.push(cur);
    }
    out
}

#[cfg(test)]
thread_local!(pub static LAUNCHED: std::cell::RefCell<Vec<OsString>> = const { std::cell::RefCell::new(Vec::new()) });

/// 启动一次程序，并把「把窗口提到前面」的权利交给它（资源管理器给了 dllhost）。
/// 程序会带着这个包的身份（Windows 11 第一层右键菜单启动的程序都这样），但包是 win32App 运行方式，不进容器：
/// 读写的还是平常的 AppData 和注册表（tools/shell-menu-e2e.mjs 会查）
fn launch(exe: &Path, cmdline: &OsString) -> Result<()> {
    #[cfg(test)]
    {
        let _ = exe;
        LAUNCHED.with(|l| l.borrow_mut().push(cmdline.clone()));
        Ok(())
    }
    #[cfg(not(test))]
    {
        use windows::Win32::Foundation::CloseHandle;
        use windows::Win32::System::Threading::{CreateProcessW, PROCESS_CREATION_FLAGS, PROCESS_INFORMATION, STARTUPINFOW};
        use windows::Win32::UI::WindowsAndMessaging::AllowSetForegroundWindow;
        let app: Vec<u16> = exe.as_os_str().encode_wide().chain(Some(0)).collect();
        let dir: Vec<u16> = exe.parent().map(|d| d.as_os_str().encode_wide().chain(Some(0)).collect()).unwrap_or_else(|| vec![0]);
        let mut cmd: Vec<u16> = cmdline.encode_wide().chain(Some(0)).collect();
        let mut pi = PROCESS_INFORMATION::default();
        unsafe {
            let si = STARTUPINFOW { cb: std::mem::size_of::<STARTUPINFOW>() as u32, ..Default::default() };
            CreateProcessW(PCWSTR(app.as_ptr()), Some(PWSTR(cmd.as_mut_ptr())), None, None, false, PROCESS_CREATION_FLAGS(0), None, PCWSTR(dir.as_ptr()), &si, &mut pi)?;
            let _ = AllowSetForegroundWindow(pi.dwProcessId);
            let _ = CloseHandle(pi.hThread);
            let _ = CloseHandle(pi.hProcess);
        }
        Ok(())
    }
}

#[implement(IExplorerCommand)]
pub struct ConvertCommand;

impl ConvertCommand {
    pub fn new() -> Self {
        LIVE.fetch_add(1, Ordering::SeqCst);
        ConvertCommand
    }
}
impl Default for ConvertCommand {
    fn default() -> Self {
        Self::new()
    }
}
impl Drop for ConvertCommand {
    fn drop(&mut self) {
        LIVE.fetch_sub(1, Ordering::SeqCst);
    }
}

impl IExplorerCommand_Impl for ConvertCommand_Impl {
    fn GetTitle(&self, _: Ref<IShellItemArray>) -> Result<PWSTR> {
        unsafe { SHStrDupW(w!("转成 PDF")) }
    }
    fn GetIcon(&self, _: Ref<IShellItemArray>) -> Result<PWSTR> {
        let exe = app_exe().ok_or(E_FAIL)?;
        let s: Vec<u16> = exe.as_os_str().encode_wide().chain(",0".encode_utf16()).chain(Some(0)).collect();
        unsafe { SHStrDupW(PCWSTR(s.as_ptr())) }
    }
    fn GetToolTip(&self, _: Ref<IShellItemArray>) -> Result<PWSTR> {
        Err(E_NOTIMPL.into())
    }
    fn GetCanonicalName(&self) -> Result<GUID> {
        Ok(CLSID_CONVERT)
    }
    fn GetState(&self, items: Ref<IShellItemArray>, _: BOOL) -> Result<u32> {
        let show = should_show(paths(items.as_ref()).as_deref());
        Ok(if show { ECS_ENABLED.0 } else { ECS_HIDDEN.0 } as u32)
    }
    fn Invoke(&self, items: Ref<IShellItemArray>, _: Ref<IBindCtx>) -> Result<()> {
        let files: Vec<PathBuf> = paths(items.as_ref()).unwrap_or_default().into_iter().filter(|p| convertible(p)).collect();
        if files.is_empty() {
            return Ok(());
        }
        let exe = app_exe().ok_or(E_FAIL)?;
        for cmd in command_lines(&exe, &files) {
            launch(&exe, &cmd)?;
        }
        Ok(())
    }
    fn GetFlags(&self) -> Result<u32> {
        Ok(ECF_DEFAULT.0 as u32)
    }
    fn EnumSubCommands(&self) -> Result<IEnumExplorerCommand> {
        Err(E_NOTIMPL.into())
    }
}

#[implement(IClassFactory)]
struct Factory;

impl IClassFactory_Impl for Factory_Impl {
    fn CreateInstance(&self, outer: Ref<windows::core::IUnknown>, riid: *const GUID, ppv: *mut *mut c_void) -> Result<()> {
        if ppv.is_null() {
            return Err(E_POINTER.into());
        }
        unsafe { *ppv = std::ptr::null_mut() };
        if !outer.is_null() {
            return Err(CLASS_E_NOAGGREGATION.into());
        }
        let cmd: IExplorerCommand = ConvertCommand::new().into();
        unsafe { cmd.query(riid, ppv) }.ok()
    }
    fn LockServer(&self, lock: BOOL) -> Result<()> {
        if lock.as_bool() {
            LIVE.fetch_add(1, Ordering::SeqCst);
        } else {
            LIVE.fetch_sub(1, Ordering::SeqCst);
        }
        Ok(())
    }
}

/// # Safety
/// COM 按约定调用：指针都有效
#[no_mangle]
pub unsafe extern "system" fn DllGetClassObject(clsid: *const GUID, riid: *const GUID, ppv: *mut *mut c_void) -> HRESULT {
    if ppv.is_null() {
        return E_POINTER;
    }
    *ppv = std::ptr::null_mut();
    if clsid.is_null() || (*clsid != CLSID_CONVERT && *clsid != CLSID_CONVERT_TEST) {
        return CLASS_E_CLASSNOTAVAILABLE;
    }
    let f: IClassFactory = Factory.into();
    f.query(riid, ppv)
}

#[no_mangle]
pub extern "system" fn DllCanUnloadNow() -> HRESULT {
    if LIVE.load(Ordering::SeqCst) == 0 {
        S_OK
    } else {
        S_FALSE
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED};
    use windows::Win32::UI::Shell::{ILCreateFromPathW, ILFree, SHCreateShellItemArrayFromIDLists};

    fn items(paths: &[&Path]) -> IShellItemArray {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
            let pidls: Vec<_> = paths
                .iter()
                .map(|p| {
                    let w: Vec<u16> = p.as_os_str().encode_wide().chain(Some(0)).collect();
                    let pidl = ILCreateFromPathW(PCWSTR(w.as_ptr()));
                    assert!(!pidl.is_null(), "建不了 {p:?} 的 PIDL");
                    pidl as *const _
                })
                .collect();
            let arr = SHCreateShellItemArrayFromIDLists(&pidls).unwrap();
            for p in pidls {
                ILFree(Some(p));
            }
            arr
        }
    }

    fn command() -> IExplorerCommand {
        let mut p: *mut c_void = std::ptr::null_mut();
        unsafe {
            DllGetClassObject(&CLSID_CONVERT, &IClassFactory::IID, &mut p).ok().unwrap();
            let f = IClassFactory::from_raw(p);
            f.CreateInstance::<Option<&windows::core::IUnknown>, IExplorerCommand>(None).unwrap()
        }
    }

    // 每个测试一个文件夹：测试是并行跑的
    fn dir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("pdf-viewer-shell-test-{}-{tag}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        for n in ["照片.jpg", "报告.DOCX", "说明.md", "原来.pdf", "无扩展名"] {
            std::fs::write(d.join(n), b"x").unwrap();
        }
        d
    }

    #[test]
    fn class_factory_and_title() {
        let mut p: *mut c_void = std::ptr::null_mut();
        let bad = GUID::from_u128(1);
        assert_eq!(unsafe { DllGetClassObject(&bad, &IClassFactory::IID, &mut p) }, CLASS_E_CLASSNOTAVAILABLE);
        let c = command();
        let t = unsafe { c.GetTitle(None).unwrap() };
        assert_eq!(unsafe { t.to_string().unwrap() }, "转成 PDF");
        unsafe { CoTaskMemFree(Some(t.0 as *const c_void)) };
        assert_eq!(unsafe { c.GetCanonicalName().unwrap() }, CLSID_CONVERT);
        assert!(unsafe { c.EnumSubCommands() }.is_err());
    }

    #[test]
    fn state_depends_on_selection() {
        let d = dir("state");
        let c = command();
        let st = |ps: &[&Path]| unsafe { c.GetState(&items(ps), false).unwrap() };
        let (jpg, docx, md, pdf, none) = (d.join("照片.jpg"), d.join("报告.DOCX"), d.join("说明.md"), d.join("原来.pdf"), d.join("无扩展名"));
        assert_eq!(st(&[&jpg]), ECS_ENABLED.0 as u32);
        assert_eq!(st(&[&jpg, &docx, &md]), ECS_ENABLED.0 as u32, "多选、扩展名大写也认");
        assert_eq!(st(&[&pdf]), ECS_HIDDEN.0 as u32);
        assert_eq!(st(&[&jpg, &pdf]), ECS_HIDDEN.0 as u32, "混着不能转的就不显示");
        assert_eq!(st(&[&none]), ECS_HIDDEN.0 as u32);
        assert_eq!(unsafe { c.GetState(None, false).unwrap() }, ECS_HIDDEN.0 as u32);
        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn invoke_launches_app_once_with_all_files() {
        let d = dir("invoke");
        let c = command();
        let (jpg, md) = (d.join("照片.jpg"), d.join("说明.md"));
        LAUNCHED.with(|l| l.borrow_mut().clear());
        unsafe { c.Invoke(&items(&[&jpg, &md]), None).unwrap() };
        let got = LAUNCHED.with(|l| l.borrow().clone());
        let exe = app_exe().unwrap();
        assert_eq!(got.len(), 1);
        // 资源管理器给的是磁盘上的大小写（D:\Temp），比较时不分大小写
        let s = got[0].to_string_lossy().to_lowercase();
        assert_eq!(s, format!("\"{}\" --convert \"{}\" \"{}\"", exe.display(), jpg.display(), md.display()).to_lowercase());
        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn long_selections_are_split() {
        let exe = Path::new(r"C:\程序\pdf-viewer.exe");
        let files: Vec<PathBuf> = (0..1000).map(|i| PathBuf::from(format!(r"D:\很长的文件夹名字\第 {i:04} 张扫描件，内容是天真与经验之歌的插图.jpg"))).collect();
        let lines = command_lines(exe, &files);
        assert!(lines.len() > 1);
        assert!(lines.iter().all(|l| l.encode_wide().count() <= MAX_CMDLINE && l.to_string_lossy().starts_with("\"C:\\程序\\pdf-viewer.exe\" --convert \"")));
        let total: usize = lines.iter().map(|l| l.to_string_lossy().matches(".jpg\"").count()).sum();
        assert_eq!(total, 1000);
        assert!(command_lines(exe, &[]).is_empty());
    }

    #[test]
    fn unload_only_when_nothing_alive() {
        let c = command();
        assert_eq!(DllCanUnloadNow(), S_FALSE);
        drop(c);
    }
}
