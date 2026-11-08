# 隐私说明

DJI Media Manager 不需要账号，不包含默认遥测。

## 不收集

- 用户媒体文件内容
- 文件路径
- 使用行为统计
- 设备标识
- 崩溃报告

## 本地缓存

应用会在系统用户数据目录保存缩略图缓存：

- macOS：`~/Library/Application Support/DJI Media Manager/cache`
- Windows：`%APPDATA%/DJI Media Manager/cache`

用户可以删除该缓存目录，应用会在需要时重建。

## 网络访问

- 桌面服务只监听 `127.0.0.1`
- 正常使用不需要外部网络
- “检查更新”如启用，只会访问本仓库的 GitHub Releases API
