// 言 · 桥接 · 系统的选择框：选目录（工作目录、存储位置）、选文件（游目里网页要传的、要开的本机文件）
"use strict";
const { spawn } = require("node:child_process");
const { encodePowerShell } = require("./text.js");

// Windows：Windows PowerShell 5.1 的 FolderBrowserDialog 还是 XP 年代那棵树；改走 IFileOpenDialog，
// 就是资源管理器风格、带地址栏与搜索的现代对话框，选目录（FOS_PICKFOLDERS）、选文件同一个。编译失败（缺少编译器等）时退回 Forms 的旧对话框
const PICKER_CS = String.raw`using System;
using System.Runtime.InteropServices;
public static class YanPicker {
  [ComImport, Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")] class FileOpenDialogRCW {}
  // 要用 IFileOpenDialog 自己的号：借 IFileDialog 的号，排在它之后的 GetResults 落到函数表外
  [ComImport, Guid("d57c7288-d4ad-4768-be02-9d969532d960"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IFileOpenDialog {
    [PreserveSig] uint Show(IntPtr parent);
    void SetFileTypes(uint cFileTypes, IntPtr rgFilterSpec);
    void SetFileTypeIndex(uint iFileType);
    void GetFileTypeIndex(out uint piFileType);
    void Advise(IntPtr pfde, out uint pdwCookie);
    void Unadvise(uint dwCookie);
    void SetOptions(uint fos);
    void GetOptions(out uint pfos);
    void SetDefaultFolder(IShellItem psi);
    void SetFolder(IShellItem psi);
    void GetFolder(out IShellItem ppsi);
    void GetCurrentSelection(out IShellItem ppsi);
    void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string pszName);
    void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);
    void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string pszTitle);
    void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string pszText);
    void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string pszLabel);
    void GetResult(out IShellItem ppsi);
    void AddPlace(IShellItem psi, int alignment);
    void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string pszDefaultExtension);
    void Close(int hr);
    void SetClientGuid(ref Guid guid);
    void ClearClientData();
    void SetFilter(IntPtr pFilter);
    void GetResults(out IShellItemArray ppenum);
    void GetSelectedItems(out IntPtr ppsai);
  }
  [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IShellItem {
    void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
    void GetParent(out IShellItem ppsi);
    void GetDisplayName(uint sigdnName, [MarshalAs(UnmanagedType.LPWStr)] out string ppszName);
    void GetAttributes(uint sfgaoMask, out uint psfgaoAttribs);
    void Compare(IShellItem psi, uint hint, out int piOrder);
  }
  [ComImport, Guid("B63EA76D-1F85-456F-A19C-48159EFA858B"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IShellItemArray {
    void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppvOut);
    void GetPropertyStore(int flags, ref Guid riid, out IntPtr ppv);
    void GetPropertyDescriptionList(IntPtr keyType, ref Guid riid, out IntPtr ppv);
    void GetAttributes(int dwAttribFlags, uint sfgaoMask, out uint psfgaoAttribs);
    void GetCount(out uint pdwNumItems);
    void GetItemAt(uint dwIndex, out IShellItem ppsi);
    void EnumItems(out IntPtr ppenumShellItems);
  }
  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
  static extern void SHCreateItemFromParsingName([MarshalAs(UnmanagedType.LPWStr)] string pszPath, IntPtr pbc, ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out IShellItem ppv);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  // 选好的一行一条；取消给空串
  public static string Pick(string title, string okLabel, string initial, bool files, bool multiple) {
    var dialog = (IFileOpenDialog)new FileOpenDialogRCW();
    uint options; dialog.GetOptions(out options);
    // FOS_FORCEFILESYSTEM | FOS_NOCHANGEDIR；选文件 FOS_FILEMUSTEXIST、选目录 FOS_PICKFOLDERS；多选 FOS_ALLOWMULTISELECT
    dialog.SetOptions(options | 0x40 | 0x8 | (files ? 0x1000u : 0x20u) | (multiple ? 0x200u : 0u));
    dialog.SetTitle(title);
    if (!string.IsNullOrEmpty(okLabel)) dialog.SetOkButtonLabel(okLabel);
    if (!string.IsNullOrEmpty(initial)) {
      try { var iid = new Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"); IShellItem start; SHCreateItemFromParsingName(initial, IntPtr.Zero, ref iid, out start); dialog.SetFolder(start); } catch {}
    }
    uint hr = dialog.Show(GetForegroundWindow());
    if (hr == 0x800704C7) return ""; // 用户取消
    if (hr != 0) throw new Exception("IFileOpenDialog.Show 0x" + hr.ToString("X8"));
    IShellItemArray results; dialog.GetResults(out results);
    uint count; results.GetCount(out count);
    var paths = new string[count];
    for (uint i = 0; i < count; i++) {
      IShellItem item; results.GetItemAt(i, out item);
      item.GetDisplayName(0x80058000, out paths[i]); // SIGDN_FILESYSPATH
    }
    return string.Join("\n", paths);
  }
}`;
/** @param {{ title: string, ok: string, current: string, files: boolean, multiple: boolean }} o */
function pickerScript({ title, ok, current, files, multiple }) {
  const quote = (/** @type {string} */ text) => `'${text.replace(/'/g, "''")}'`;
  return `[Console]::OutputEncoding=[Text.Encoding]::UTF8
$initial = ${quote(current)}
$files = $${files}
$multiple = $${multiple}
$picked = $null
try {
  Add-Type -TypeDefinition @'
${PICKER_CS}
'@ -ErrorAction Stop
  $picked = [YanPicker]::Pick(${quote(title)}, ${quote(ok)}, $initial, $files, $multiple)
} catch {
  Add-Type -AssemblyName System.Windows.Forms
  $w = New-Object System.Windows.Forms.Form; $w.TopMost = $true
  if ($files) {
    $d = New-Object System.Windows.Forms.OpenFileDialog; $d.Title = ${quote(title)}; $d.Multiselect = $multiple
    if ($initial) { $d.InitialDirectory = $initial }
    if ($d.ShowDialog($w) -eq 'OK') { $picked = $d.FileNames -join [Environment]::NewLine }
  } else {
    $d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description = ${quote(title)}; $d.ShowNewFolderButton = $true
    if ($initial) { $d.SelectedPath = $initial }
    if ($d.ShowDialog($w) -eq 'OK') { $picked = $d.SelectedPath }
  }
}
if ($picked) { Write-Output $picked }`;
}
// macOS：choose file 单选时给一个、多选时给一串，统一成一串再逐条转 POSIX 路径
/** @param {{ title: string, current: string, files: boolean, multiple: boolean }} o */
function appleScript({ title, current, files, multiple }) {
  const from = current ? ` default location POSIX file ${JSON.stringify(current)}` : "";
  return [
    `set picked to choose ${files ? "file" : "folder"} with prompt ${JSON.stringify(title)}${multiple ? " with multiple selections allowed" : ""}${from}`,
    "if class of picked is not list then set picked to {picked}",
    'set out to ""',
    "repeat with f in picked",
    "set out to out & POSIX path of f & linefeed",
    "end repeat",
    "return out"
  ];
}
// 用系统自带的选择框：Windows 走上面的脚本，macOS 走 osascript，Linux 尽量用 zenity。
// 选文件给真路径：游目把它径直交给网页、或开 file://，不经页面读、不拷进临时目录。
// 不设时限、不收进程：对话框以前台窗为主窗，开着时那扇窗被禁用，进程被杀就一直禁着（浏览器、任务栏点不动），等人自己关
/** @param {{ files?: boolean, multiple?: boolean, current?: string }} [options] @returns {Promise<{ paths: string[] } | { error: string }>} */
function pick({ files = false, multiple = false, current = "" } = {}) {
  const title = files ? "选择文件" : "选择工作目录",
    ok = files ? "" : "以此为案";
  // 测试里不真弹（YAN_NO_EXTERNAL），当人点了取消
  if (process.env.YAN_NO_EXTERNAL) return Promise.resolve({ paths: [] });
  return new Promise(resolve => {
    let cmd, args;
    if (process.platform === "win32") {
      cmd = "powershell.exe";
      args = [
        "-NoProfile",
        "-NonInteractive",
        "-STA",
        "-ExecutionPolicy",
        "Bypass",
        "-EncodedCommand",
        encodePowerShell(pickerScript({ title, ok, current, files, multiple }))
      ];
    } else if (process.platform === "darwin") {
      cmd = "osascript";
      args = appleScript({ title, current, files, multiple }).flatMap(line => ["-e", line]);
    } else {
      cmd = "zenity";
      args = [
        "--file-selection",
        `--title=${title}`,
        ...(files ? [] : ["--directory"]),
        ...(multiple ? ["--multiple", "--separator=\n"] : []),
        ...(current ? [`--filename=${current.replace(/\/?$/, "/")}`] : [])
      ];
    }
    const child = spawn(cmd, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let out = "",
      err = "";
    child.stdout.on("data", chunk => {
      out += chunk.toString("utf8");
    });
    child.stderr.on("data", chunk => {
      err += chunk.toString("utf8");
    });
    child.on("error", (/** @type {NodeJS.ErrnoException} */ error) => {
      resolve({ error: `无法打开系统的选择框（${error.code === "ENOENT" ? `缺少 ${cmd}` : error.message}）` });
    });
    child.on("close", code => {
      const paths = out
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => (files ? line : line.replace(/(.)\/$/, "$1")));
      // macOS 点了取消是 -128 号错
      if (code && !paths.length && !/-128/.test(err)) resolve({ error: "系统的选择框未能打开" });
      else resolve({ paths });
    });
  });
}

module.exports = { pick };
