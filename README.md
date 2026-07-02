# Jellyfin Native Player Bridge

接管 Jellyfin Web 端的播放入口，把海报卡片、季页、剧集/影片详情页上的播放动作转发到本机监听服务，再由本地播放器打开 Jellyfin 视频流。

## 组成

- `service/`: 本地 Node.js HTTP 监听服务，只监听 `127.0.0.1` 默认端口 `45789`。
- `extension/`: Microsoft Edge / Chromium MV3 浏览器扩展。
- `userscript/`: Tampermonkey 用户脚本模板。
- `scripts/`: Windows 启停、重载、部署和计划任务脚本。
- `runtime/`: 项目内置 Node.js 运行时。服务脚本只使用这里的 `node.exe`，不依赖系统 PATH。

## 快速部署

在 PowerShell 或命令提示符中执行：

```bat
<repo-dir>\scripts\install-one-click.bat
```

部署目标默认是：

```text
%ProgramFiles%\jellyfin-native-player-bridge
```

部署脚本会：

- 复制工程到安装目录。
- 保留并使用项目内的 `runtime\node.exe`。
- 生成 `config\config.json` 和扩展默认配置 `extension\default-config.js`。
- 自动探测 VLC、mpv、PotPlayer；没有找到时需要手动配置 `playerPath`。
- 可选注册当前用户登录启动的 Windows 计划任务。

## 安装 Edge 扩展

扩展安装方式和限制见 [docs/edge-extension-install.md](docs/edge-extension-install.md) 和 [docs/edge-extension-installation-strategy.md](docs/edge-extension-installation-strategy.md)。

Tampermonkey 用户脚本方案见 [docs/tampermonkey-userscript.md](docs/tampermonkey-userscript.md)。

## 配置

服务配置文件：

```text
<install-dir>\config\config.json
```

常用字段：

- `host`: 监听地址，默认 `127.0.0.1`。
- `port`: 监听端口，默认 `45789`。
- `browserSecret`: 浏览器扩展访问本地服务的密钥，部署时自动生成。
- `playerPath`: 本地播放器 exe 路径。
- `playerArgs`: 播放器参数模板，默认 `["{url}"]`。
- `jellyfin.reportPlaybackStart`: 成功调起本地播放器后向 Jellyfin 上报“开始播放”，默认开启；不持续同步进度。
- `logging.retentionDays`: 日志保留天数。
- `logging.cleanupIntervalHours`: 定时清理日志的间隔。

修改 `playerPath`、`playerArgs`、日志策略后可执行重载配置；修改监听地址或端口后需要重启服务。

## BAT 脚本

安装目录 `scripts` 下提供：

- `start-listener.bat`: 启动监听。
- `stop-listener.bat`: 停止监听。
- `reload-config.bat`: 重载配置。
- `restart-listener.bat`: 重启服务。
- `status.bat`: 查看状态。
- `cleanup-logs.bat`: 立即触发日志清理。
- `edit-config.bat`: 打开配置文件。
- `register-startup-task.bat`: 注册当前用户登录后台静默启动。
- `unregister-startup-task.bat`: 删除登录启动计划任务。
- `install-edge-extension.bat`: 打包扩展并写入 Edge 安装策略。
- `run-admin-install.bat`: 弹出 UAC，以管理员权限写入系统级 Edge 策略并注册登录启动任务。
- `install-one-click.bat`: 一键部署、启动服务、注册登录启动任务，并创建系统 Edge 启动快捷方式。
- `install-tampermonkey-edge.bat`: 通过 Edge 官方商店策略安装 Tampermonkey。
- `uninstall-tampermonkey-edge-policy.bat`: 移除 Tampermonkey 安装策略。

计划任务通过 `wscript.exe scripts\run-hidden.vbs` 静默启动，不显示控制台黑框。

## 日志

日志默认写入：

```text
<install-dir>\logs
```

服务启动时和运行期间会按 `logging.cleanupIntervalHours` 定时清理早于 `logging.retentionDays` 的日志文件。

## Jellyfin 行为

扩展只在识别到 Jellyfin Web 页面时工作。命中播放按钮后，它会把当前 Jellyfin 地址、用户 ID、访问 token、itemId 和播放位置发送到本机服务。服务端会：

1. 通过 Jellyfin API 查询 item。
2. 如果 item 是季、系列或文件夹，解析第一个可播放视频。
3. 请求 PlaybackInfo。
4. 拼出 Jellyfin `/Videos/{itemId}/stream` 播放地址。
5. 调起本地播放器。
6. 向 Jellyfin 上报“开始播放”事件。

普通详情页导航不会被阻止；只有识别为播放/继续播放的动作会被接管。
