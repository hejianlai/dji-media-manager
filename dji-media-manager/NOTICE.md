# 第三方组件

## Electron

- License: MIT
- https://github.com/electron/electron

## electron-builder

- License: MIT
- https://github.com/electron-builder/electron-builder

## ffmpeg-static

- npm 包 License：GPL-3.0-or-later
- 版本：5.2.0
- 源码：https://github.com/eugeneware/ffmpeg-static
- 下载的 ffmpeg 版本：6.0
- 上游二进制来源见 ffmpeg-static README

本应用捆绑了 `ffmpeg-static` 提供的静态 ffmpeg 可执行文件。该构建启用了 GPL 组件，相关许可要求随分发一同生效。

按照 GPL / LGPL /第三方组件的要求，发布时需要在 GitHub Release 中附上：

1. 本仓库完整源码链接
2. `ffmpeg-static` 源码链接
3. 对应 ffmpeg 6.0 源码链接
4. 各平台二进制附带的 LICENSE 文件（构建时会自动从 `ffmpeg-static` 下载）

本项目 MIT 许可仅适用于本项目自有代码，不覆盖捆绑的 ffmpeg 二进制。

## 系统工具

- macOS：`sips`、`osascript`、Finder 为 Apple 系统组件
- Windows：PowerShell、Shell API 为 Microsoft 系统组件
