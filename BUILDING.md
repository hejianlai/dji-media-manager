# 构建 Mac / Windows 安装包

## 本地构建

```bash
npm ci

export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
export ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/

npm run dist:mac      # macOS DMG + ZIP
```

Windows 包有两种方式：

### 方式 A：macOS 交叉构建 x64（已支持）

先下载 Windows x64 ffmpeg，再构建：

```bash
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
export ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
export FFMPEG_BINARIES_URL=https://npmmirror.com/mirrors/ffmpeg-static/
export FFMPEG_NO_PROXY=1

npm run dist:win
```

产物：

```text
release/dji-media-manager-Setup-1.0.0-x64.exe
release/dji-media-manager-Portable-1.0.0-x64.exe
```

说明：

- 构建脚本会从镜像下载 `ffmpeg-win32-x64.gz`
- Electron 强制使用 `--x64`
- 输出的是 Windows x64 安装版和免安装版
- 不要分发带 `arm64` 的 Windows 包

### 方式 B：Windows x64 或 GitHub Actions windows-latest

```powershell
npm install
npm run dist:win
```

CI 配置已默认在 Windows runner 上构建。

## GitHub Actions 自动发布

1. 修改 `package.json` 的 `version`
2. 提交并打 tag：

```bash
git tag v1.0.0
git push origin v1.0.0
```

3. GitHub Actions 会分别构建 macOS 与 Windows，并上传：

```text
*.dmg
*mac.zip
*.exe
SHA256SUMS
```

## 许可义务

捆绑 `ffmpeg-static` 后公开发布时，Release 应包含：

- 本仓库源码链接
- `ffmpeg-static` 源码链接
- ffmpeg 6.0 源码链接
- `resources/ffmpeg/ffmpeg-static-LICENSE`

详见 `NOTICE.md`。

## Homebrew Cask

发布稳定后，创建 Homebrew Cask：

```bash
brew tap-homebrew --force https://github.com/jackhe/homebrew-dji-media-manager
brew install --cask dji-media-manager
```

Cask 需要提供：

- GitHub Release 的 `url`
- `sha256`
- `app` 路径
- `name`、`desc`、`homepage`
