# Edge 扩展安装说明

这个项目的扩展是本地开发版扩展，没有发布到 Microsoft Edge Add-ons。

Edge 官方支持的静默强制安装主要面向已发布扩展和企业策略。未发布的本地扩展在普通个人 Edge 中不能可靠地无交互永久安装。项目因此提供两种使用方式：

详细安装路线、限制和实测结论见 [edge-extension-installation-strategy.md](edge-extension-installation-strategy.md)。

## 推荐：项目专用 Edge 配置

执行：

```bat
<install-dir>\scripts\open-edge-with-extension.bat
```

这个脚本会使用独立 Edge 用户数据目录：

```text
<install-dir>\data\edge-profile
```

并通过 `--load-extension` 加载：

```text
<install-dir>\extension
```

这不会污染你日常 Edge 配置；登录 Jellyfin 一次后会保存在这个专用配置里。

## 手动加载到日常 Edge

1. 打开 `edge://extensions/`
2. 开启“开发人员模式”
3. 点击“加载解压缩的扩展”
4. 选择：

```text
<install-dir>\extension
```

加载后打开扩展的设置页，确认监听地址为 `127.0.0.1`，端口为 `45789`。部署脚本已经把密钥写入扩展默认配置。
