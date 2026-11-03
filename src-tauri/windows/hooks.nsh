; 安装包的钩子（tauri.conf.json → bundle.windows.nsis.installerHooks）：资源管理器右键菜单里的「转成 PDF」。
; 装好后加上（用户在程序里关掉过就不加）、卸载前删掉；写哪些注册表项见 src/shell_menu.rs

!macro NSIS_HOOK_POSTINSTALL
  ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --register-shell-menu'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --unregister-shell-menu'
!macroend
