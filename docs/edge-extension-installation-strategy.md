# Edge 扩展安装方案记录

记录日期：2026-07-02

本项目的浏览器端是 Manifest V3 扩展，当前没有发布到 Microsoft Edge Add-ons。Edge 对未发布扩展的安装方式有明确限制，所以这里把已验证的安装路线、限制和后续可选方案集中记录，避免散落在 README 首页。

## 目标

- 日常 Edge 打开 Jellyfin 时，扩展能接管 Jellyfin Web 的播放按钮。
- 扩展需要拿到 Jellyfin 当前页面中的 serverUrl、itemId、userId 和 access token，再发给本机监听服务。
- 本机服务默认监听 `127.0.0.1:<port>`，用 `X-JEP-Token` 做本地请求校验。

## 方案 1：手动加载未打包扩展

这是 Edge 对本地开发扩展最稳定的方式。

步骤：

```text
edge://extensions/
打开“开发人员模式”
加载解压缩的扩展
选择 <install-dir>\extension
```

优点：

- 使用当前日常 Edge Profile。
- 安装后能在 `edge://extensions/` 的“来自其他源”里看到扩展。
- 不依赖企业域、扩展商店或发布审核。

限制：

- 需要一次人工确认目录选择。
- Edge 会提示“开发人员模式下的扩展”，这是浏览器安全提示，不能由扩展自身关闭。

## 方案 2：`--load-extension` 启动参数

脚本：

```bat
<install-dir>\scripts\open-system-edge-with-extension.bat
```

它使用当前系统 Edge 配置，并追加：

```text
--load-extension=<install-dir>\extension
```

优点：

- 不需要发布到 Edge Add-ons。
- 不需要修改 Edge 受保护配置文件。
- 对调试和本机使用可靠。

限制：

- 只有通过这个启动入口打开的 Edge 会加载扩展。
- 如果 Edge 已经在后台运行，后续启动参数可能被现有进程忽略；必要时需要先关闭 Edge。
- 这不是 Edge 扩展页里的永久安装。

项目同时提供专用 Profile 入口：

```bat
<install-dir>\scripts\open-edge-with-extension.bat
```

专用 Profile 放在：

```text
<install-dir>\data\edge-profile
```

## 方案 3：Edge 企业策略强制安装

相关脚本：

```bat
<install-dir>\scripts\install-edge-extension.bat
<install-dir>\scripts\install-system-integration-admin.bat
```

思路：

1. 用 Edge 打包扩展，生成 CRX 和 PEM。
2. 本机服务提供 CRX 下载和 `updates.xml`。
3. 写入 Edge `ExtensionInstallForcelist` 策略。

限制：

- Microsoft Edge 文档说明，自托管扩展的强制安装主要面向企业策略场景。
- 在非 Active Directory 域环境的普通个人 Edge 上，自托管 CRX 强制安装不可靠。
- 本机已实测：运行期可以看到策略/更新地址，但普通 Edge 没有稳定安装到扩展列表。

结论：

- 这条路线保留脚本用于企业环境或后续验证。
- 不作为普通本机的一键安装主路径。

参考：

- Microsoft Edge `ExtensionInstallForcelist` policy: https://learn.microsoft.com/deployedge/microsoft-edge-browser-policies/extensioninstallforcelist
- Microsoft Edge self-hosting extensions: https://learn.microsoft.com/microsoft-edge/extensions-chromium/publish/self-hosting

## 方案 4：后台模拟“加载解压缩的扩展”

已验证过两种后台自动化：

- DevTools 协议打开 `edge://extensions/`，调用内部扩展页接口。
- Windows UI Automation 操作 Edge 页面和系统目录选择器。

实测结果：

- 运行期可以加载扩展，并能在当前 Edge 进程的内部扩展列表看到 `Jellyfin Native Player Bridge`。
- 关闭 Edge 后，扩展没有稳定写入默认 Profile 的 `Preferences` / `Secure Preferences`。
- 用户重新打开普通 Edge 后，`edge://extensions/` 里可能看不到该扩展。

结论：

- 后台自动化只能作为调试验证手段，不能作为可靠安装方式。
- 不建议直接修改 `Preferences` / `Secure Preferences`，这些文件有浏览器保护校验，强行写入容易被 Edge 回滚或造成配置损坏。

## 方案 5：发布到 Microsoft Edge Add-ons

这是“通过一个链接安装”的正式路线。

流程：

1. 注册/登录 Microsoft Partner Center。
2. 创建 Edge extension submission。
3. 上传扩展包。
4. 填写隐私、权限说明、截图和测试信息。
5. 审核通过后获取 Edge Add-ons 链接。
6. 用户通过链接点击安装。

优点：

- 日常 Edge 原生安装体验最好。
- 后续自动更新由 Edge Add-ons 处理。
- 不需要开发人员模式。

限制：

- 需要 Microsoft 开发者/合作伙伴账号。
- 需要审核时间。
- 扩展会申请 `http://*/*` 和 `https://*/*` host permissions，发布时需要清楚说明用途；后续可以把匹配范围收窄到用户配置的 Jellyfin 地址。

## 当前建议

普通本机环境：

1. 开发和快速使用：使用 `open-system-edge-with-extension.bat` 或专用 Profile 启动脚本。
2. 想在日常 Edge 扩展页里永久出现：手动加载未打包扩展。
3. 想通过链接安装：发布到 Microsoft Edge Add-ons。
4. 想减少自定义扩展安装成本：使用 Tampermonkey 用户脚本方案，见 [tampermonkey-userscript.md](tampermonkey-userscript.md)。

企业域环境：

1. 使用 CRX + update manifest + `ExtensionInstallForcelist`。
2. 配套部署本机监听服务和开机计划任务。
