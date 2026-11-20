; 安装包的钩子（tauri.conf.json → bundle.windows.nsis.installerHooks）：资源管理器右键菜单里的「转成 PDF」，细节见 src/shell_menu.rs。
; Windows 11 上第一次装时问一次管理员（UAC），把右键组件包的签名证书装进本机「受信任的人」（顺便去掉 1.3.1–1.4.0 留下的没签名的包），
; 再把安装文件夹 shell-menu\ 里签过名的包登记给当前用户（不用管理员），「转成 PDF」就在右键菜单第一层；
; 拒绝了、静默安装、或者不是 Windows 11，就只加旧式的（Windows 11 上在「显示更多选项」里）。用户在程序里关掉过就都不加。

; 资源管理器的 COM 代理（dllhost）可能还占着右键组件的 DLL：占着的删不掉也覆盖不了，但能改名。
; 改名挪开，让新的装得进去；挪开的等代理退出后，下次安装、卸载时再删
!macro PDFVIEWER_FREE_SHELL_DLL
  Push $0
  Delete "$INSTDIR\shell-menu\*.old"
  ${If} ${FileExists} "$INSTDIR\shell-menu\pdf_viewer_shell.dll"
    Delete "$INSTDIR\shell-menu\pdf_viewer_shell.dll"
    ${If} ${FileExists} "$INSTDIR\shell-menu\pdf_viewer_shell.dll"
      System::Call 'kernel32::GetTickCount() i .r0'
      Rename "$INSTDIR\shell-menu\pdf_viewer_shell.dll" "$INSTDIR\shell-menu\pdf_viewer_shell.$0.old"
    ${EndIf}
  ${EndIf}
  Pop $0
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro PDFVIEWER_FREE_SHELL_DLL
!macroend

!macro NSIS_HOOK_POSTINSTALL
  Push $0
  ; 证书已经受信任、也没有没签名的旧包时不问（升级一般就是这样）
  ${IfNot} ${Silent}
    ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --shell-setup-needs-admin' $0
    ${If} $0 = 0
      ClearErrors
      ExecShellWait "runas" "$INSTDIR\${MAINBINARYNAME}.exe" "--shell-setup-admin" SW_HIDE
    ${EndIf}
  ${EndIf}
  ; 证书受信任时给当前用户登记签过名的包（已经登记好的不动）
  ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --add-shell-package'
  ; 第一层能用就去掉旧式的（两种都在时「显示更多选项」里会出现两个），不能用就加旧式的
  ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --register-shell-menu'
  Pop $0
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  Push $0
  ; 先让用户关掉开着的程序（Tauri 自己也会查，但在这个钩子之后）：去掉包时，从新菜单打开的程序带着包的身份，可能会被直接关掉
  !insertmacro CheckIfAppIsRunning "$INSTDIR\${MAINBINARYNAME}.exe" "${PRODUCTNAME}"
  ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --unregister-shell-menu'
  ; 升级时新的安装包在安装文件夹里原地运行旧的卸载程序（$EXEDIR 就是安装文件夹）：留着包的登记，装新版就不用再确认管理员。
  ; 真卸载时卸载程序先把自己复制到临时文件夹再运行，这时才去掉（去掉后 COM 代理也退出了，DLL 删得掉）；
  ; 证书还在本机「受信任的人」里（或者还有没签名的旧包）的话，再问一次管理员把它删掉
  ${If} $EXEDIR != $INSTDIR
    ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --remove-shell-package'
    ${IfNot} ${Silent}
      ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --shell-cleanup-needs-admin' $0
      ${If} $0 = 0
        ClearErrors
        ExecShellWait "runas" "$INSTDIR\${MAINBINARYNAME}.exe" "--shell-cleanup-admin" SW_HIDE
      ${EndIf}
    ${EndIf}
  ${EndIf}
  !insertmacro PDFVIEWER_FREE_SHELL_DLL
  Pop $0
!macroend
