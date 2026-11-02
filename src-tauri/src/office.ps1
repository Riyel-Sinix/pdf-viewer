# 把一份 Office 文档转成 PDF：依次试 Microsoft Office、WPS、LibreOffice，用第一个能转的。
# 由 src-tauri/src/convert.rs 调用：输入、输出路径放在环境变量里（不拼进命令行，路径里有什么字符都不怕）。
# 程序在后台隐藏运行；文档只读打开，不跑宏，不记进「最近使用」。
# 往标准输出写：PID:<这次新开的进程>（超时时调用方据此结束它们）、OK:<用的软件>、ERR:<原因>
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$src = $env:PDFV_IN
$dst = $env:PDFV_OUT
$kind = $env:PDFV_KIND
$missing = [Type]::Missing
# 文档有打开密码时，传一个错的密码让 Office 直接报错——不然它会弹出输密码的框，在后台谁也看不见，只能一直等。
# 「修改密码」不用传：只读打开本来就不问它（传了的话，没设修改密码的文档 Word 会报「命令失败」，Excel 会打不开）
$noPass = 'pdfv-no-password'

function Say([string]$s) { [Console]::Out.WriteLine($s); [Console]::Out.Flush() }
function Why($e) { $x = $e.Exception; while ($x.InnerException) { $x = $x.InnerException }; ($x.Message -replace '\s+', ' ').Trim() }
# WPS 的方法参数比 Office 少：只有「参数个数 / 类型不对」时才换短的写法重试（密码不对之类的错误照常报出来）
function BadArgs($e) {
  $x = $e.Exception; while ($x.InnerException) { $x = $x.InnerException }
  $x.HResult -in @(-2147352562, -2147352561, -2147352571)     # DISP_E_BADPARAMCOUNT / PARAMNOTOPTIONAL / TYPEMISMATCH
}

# 启动（或连上）一个 Office 程序；把这次新开的进程号报给调用方
function Open-Suite([string]$progId, [string]$procName) {
  $before = @(Get-Process -Name $procName -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
  try { $app = New-Object -ComObject $progId } catch { return $null }
  $new = @(Get-Process -Name $procName -ErrorAction SilentlyContinue | Where-Object { $before -notcontains $_.Id } | ForEach-Object { $_.Id })
  foreach ($id in $new) { Say "PID:$id" }
  # Fresh：是这次开的（转完可以退出）；连上的是用户自己开着的程序时，不动它的窗口，也不退出它
  [pscustomobject]@{ App = $app; Fresh = ($new.Count -gt 0 -or $before.Count -eq 0) }
}

function Convert-Word($app, [bool]$fresh) {
  if ($fresh) { try { $app.Visible = $false } catch {} }
  $alerts = $app.DisplayAlerts; $sec = $app.AutomationSecurity
  try {
    $app.DisplayAlerts = 0                                  # wdAlertsNone
    try { $app.AutomationSecurity = 3 } catch {}            # msoAutomationSecurityForceDisable：不跑宏
    try {
      # Open(FileName, ConfirmConversions, ReadOnly, AddToRecentFiles, PasswordDocument)
      $doc = $app.Documents.Open($src, $false, $true, $false, $noPass)
    } catch { if (BadArgs $_) { $doc = $app.Documents.Open($src, $false, $true) } else { throw } }
    try {
      # ExportAsFixedFormat(OutputFileName, ExportFormat=PDF, OpenAfterExport, OptimizeFor=打印, Range=全文, From, To,
      #   Item=正文, IncludeDocProps, KeepIRM, CreateBookmarks=按标题生成书签, DocStructureTags, BitmapMissingFonts, UseISO19005_1)
      try { $doc.ExportAsFixedFormat($dst, 17, $false, 0, 0, 1, 1, 0, $true, $true, 1, $true, $true, $false) }
      catch { if (BadArgs $_) { $doc.ExportAsFixedFormat($dst, 17) } else { throw } }
    } finally { $doc.Close(0) }                             # wdDoNotSaveChanges
  } finally {
    try { $app.DisplayAlerts = $alerts } catch {}
    try { $app.AutomationSecurity = $sec } catch {}
  }
}

function Convert-Excel($app, [bool]$fresh) {
  if ($fresh) { try { $app.Visible = $false } catch {}; try { $app.ScreenUpdating = $false } catch {} }
  $alerts = $app.DisplayAlerts; $sec = $app.AutomationSecurity; $links = $app.AskToUpdateLinks
  try {
    $app.DisplayAlerts = $false
    try { $app.AskToUpdateLinks = $false } catch {}
    try { $app.AutomationSecurity = 3 } catch {}
    try {
      # Open(Filename, UpdateLinks=不更新, ReadOnly, Format, Password, WriteResPassword, IgnoreReadOnlyRecommended, Origin, Delimiter, Editable, Notify, Converter, AddToMru)
      $wb = $app.Workbooks.Open($src, 0, $true, $missing, $noPass, $missing, $true, $missing, $missing, $false, $false, $missing, $false)
    } catch { if (BadArgs $_) { $wb = $app.Workbooks.Open($src, 0, $true) } else { throw } }
    try {
      # ExportAsFixedFormat(Type=PDF, Filename, Quality=标准, IncludeDocProperties, IgnorePrintAreas=否)：所有工作表，按各自的打印设置
      try { $wb.ExportAsFixedFormat(0, $dst, 0, $true, $false) }
      catch { if (BadArgs $_) { $wb.ExportAsFixedFormat(0, $dst) } else { throw } }
    } finally { $wb.Close($false) }
  } finally {
    try { $app.DisplayAlerts = $alerts } catch {}
    try { $app.AskToUpdateLinks = $links } catch {}
    try { $app.AutomationSecurity = $sec } catch {}
  }
}

function Convert-PowerPoint($app, [bool]$fresh) {
  $alerts = $app.DisplayAlerts; $sec = $app.AutomationSecurity
  try {
    $app.DisplayAlerts = 1                                  # ppAlertsNone
    try { $app.AutomationSecurity = 3 } catch {}
    $p = $app.Presentations.Open($src, -1, 0, 0)            # ReadOnly, Untitled=否, WithWindow=否（不开窗口）
    try { $p.SaveAs($dst, 32) } finally { $p.Close() }      # ppSaveAsPDF
  } finally {
    try { $app.DisplayAlerts = $alerts } catch {}
    try { $app.AutomationSecurity = $sec } catch {}
  }
}

$suites = @{
  word       = @(@('Word.Application', 'WINWORD', 'Microsoft Word'), @('KWPS.Application', 'wps', 'WPS 文字'))
  excel      = @(@('Excel.Application', 'EXCEL', 'Microsoft Excel'), @('KET.Application', 'et', 'WPS 表格'))
  powerpoint = @(@('PowerPoint.Application', 'POWERPNT', 'Microsoft PowerPoint'), @('KWPP.Application', 'wpp', 'WPS 演示'))
}[$kind]
if ($null -eq $suites) { Say "ERR:不认识的文档类型 $kind"; exit 1 }

$done = $false
$errors = New-Object System.Collections.Generic.List[string]
foreach ($s in $suites) {
  $h = Open-Suite $s[0] $s[1]
  if ($null -eq $h) { continue }
  try {
    switch ($kind) {
      'word'       { Convert-Word $h.App $h.Fresh }
      'excel'      { Convert-Excel $h.App $h.Fresh }
      'powerpoint' { Convert-PowerPoint $h.App $h.Fresh }
    }
    if (Test-Path -LiteralPath $dst) { Say "OK:$($s[2])"; $done = $true }
    else { $errors.Add("$($s[2]) 没有生成 PDF") }
  } catch {
    $errors.Add("$($s[2])：$(Why $_)")
  } finally {
    try {
      $left = switch ($kind) { 'word' { $h.App.Documents.Count } 'excel' { $h.App.Workbooks.Count } default { $h.App.Presentations.Count } }
      if ($h.Fresh -and $left -eq 0) { $h.App.Quit() }
    } catch {}
    try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($h.App) } catch {}
  }
  if ($done) { break }
}

# 没装 Office / WPS（或者都没转成）：试 LibreOffice。用单独的配置目录，不和用户正开着的 LibreOffice 抢
if (-not $done) {
  $so = $null
  foreach ($c in @("$env:ProgramFiles\LibreOffice\program\soffice.exe", "${env:ProgramFiles(x86)}\LibreOffice\program\soffice.exe")) {
    if ($c -and (Test-Path -LiteralPath $c)) { $so = $c; break }
  }
  if (-not $so) {
    try {
      $k = Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\LibreOffice\UNO\InstallPath' -ErrorAction Stop
      $c = Join-Path $k.'(default)' 'soffice.exe'
      if (Test-Path -LiteralPath $c) { $so = $c }
    } catch {}
  }
  if ($so) {
    try {
      $dir = Split-Path -Parent $dst
      $prof = 'file:///' + ((Join-Path $env:PDFV_TMP 'lo-profile') -replace '\\', '/')
      $p = Start-Process -FilePath $so -PassThru -WindowStyle Hidden -ArgumentList @(
        "-env:UserInstallation=$prof", '--headless', '--norestore', '--nolockcheck', '--convert-to', 'pdf', '--outdir', "`"$dir`"", "`"$src`"")
      Say "PID:$($p.Id)"
      $p.WaitForExit()
      $made = Join-Path $dir ([IO.Path]::GetFileNameWithoutExtension($src) + '.pdf')
      if (Test-Path -LiteralPath $made) { Move-Item -LiteralPath $made -Destination $dst -Force; Say 'OK:LibreOffice'; $done = $true }
      else { $errors.Add('LibreOffice 没有生成 PDF') }
    } catch { $errors.Add("LibreOffice：$(Why $_)") }
  }
}

if ($done) { exit 0 }
if ($errors.Count -gt 0) { Say "ERR:$($errors[0])" } else { Say 'ERR:NOAPP' }
exit 1
