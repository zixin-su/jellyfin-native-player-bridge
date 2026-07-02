# Tampermonkey 用户脚本方案

本方案用 Tampermonkey 脚本接管 Jellyfin Web 的播放按钮，本地 Node 服务仍负责调用 PotPlayer。

## 组成

- Tampermonkey：通过 Edge 官方扩展商店安装，负责运行用户脚本。
- 用户脚本：`userscript/jellyfin-native-player-bridge.user.js`。
- 本地服务：默认监听 `127.0.0.1:<port>`，接收脚本发送的 `/play` 请求并启动播放器。

## 安装 Tampermonkey

项目提供 Edge 策略安装脚本：

```bat
<install-dir>\scripts\install-tampermonkey-edge.bat
```

它写入当前用户的 Edge 策略：

```text
HKCU\Software\Policies\Microsoft\Edge\ExtensionInstallForcelist
```

Tampermonkey 的 Edge Add-ons 扩展 ID：

```text
iikmkjmpaadaobahmlepeloendndfphd
```

Edge 官方商店 update URL：

```text
https://edge.microsoft.com/extensionwebstorebase/v1/crx
```

安装策略写入后，重启 Edge 或等待策略刷新，再打开：

```text
edge://extensions/
```

确认 Tampermonkey 已安装。

如果要移除这条安装策略：

```bat
<install-dir>\scripts\uninstall-tampermonkey-edge-policy.bat
```

## 安装 Jellyfin 用户脚本

部署脚本会从 `config\config.json` 读取监听端口和 `browserSecret`，生成安装目录中的实际脚本：

```text
<install-dir>\userscript\jellyfin-native-player-bridge.user.js
```

本地服务同时提供脚本安装 URL：

```text
http://127.0.0.1:<port>/userscript/jellyfin-native-player-bridge.user.js
```

在已安装 Tampermonkey 的 Edge 中打开这个 URL，Tampermonkey 会显示脚本安装确认页，确认安装即可。

## 为什么需要部署时生成

源码里的 `userscript/jellyfin-native-player-bridge.user.js` 是模板，里面不会提交真实 `browserSecret`。

部署到 `<install-dir>` 时，`scripts\deploy.ps1` 会注入：

- `serviceHost`
- `servicePort`
- `serviceToken`

这样后续推送到 GitHub 时不会泄露本机 token。

## 工作方式

用户脚本在部署时配置的 Jellyfin 地址下运行，例如：

```text
http://<jellyfin-host>:8096/*
```

脚本会拦截 Jellyfin 页面里的播放入口：

- 海报卡片播放按钮。
- 季页播放按钮。
- 剧集/影片详情页播放按钮。
- 继续播放按钮。

脚本从 Jellyfin Web 的本地存储中读取当前登录用户的 serverUrl、userId 和 access token，然后把 itemId 和播放位置发给本地服务：

```text
POST http://127.0.0.1:<port>/play
```

本地服务解析可播放视频并启动 PotPlayer。

## 限制

- Tampermonkey 可以通过 Edge 商店策略安装，但用户脚本本身仍需要 Tampermonkey 的安装确认页确认。
- 用户脚本不能直接启动本地 exe，必须依赖本地服务。
- `@match` 在部署时按 Jellyfin 地址生成；如果 Jellyfin 地址变化，需要重新部署或重新生成脚本后安装。
- 脚本安装后会包含本机服务 token，不要把安装目录中生成后的 `.user.js` 发布到公网。
