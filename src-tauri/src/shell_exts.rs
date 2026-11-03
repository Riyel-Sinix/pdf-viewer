// 右键菜单里出现「转成 PDF」的文件类型（小写扩展名）：常见的图片、Office 文档、Markdown、CSV、网页和纯文本（都在 src/js/convert.js 的 EXTS 里）。
// 代码文件虽然也能转，但不加——不然右键菜单到处都是。
// 桌面外壳（shell_menu.rs，旧式右键菜单）和 Windows 11 右键组件（shell-menu/src/lib.rs）都用 include! 引这一份
pub const EXTS: &[&str] = &[
    "jpg", "jpeg", "jpe", "jfif", "png", "gif", "webp", "bmp", "avif", "svg", "tif", "tiff", "heic", "heif", "jxr",
    "doc", "docx", "docm", "rtf", "odt", "wps",
    "xls", "xlsx", "xlsm", "xlsb", "ods", "et",
    "ppt", "pptx", "pptm", "pps", "ppsx", "odp", "dps",
    "md", "markdown", "csv", "tsv", "html", "htm", "mht", "mhtml", "txt",
];
