# GitHub 发布

目标仓库名建议使用：

```text
jellyfin-native-player-bridge
```

当前环境没有 GitHub CLI，也没有可用的 GitHub 写权限 token。发布到 `zixin-su` 账号需要任选一种授权方式：

1. 安装并登录 GitHub CLI 后执行 `gh auth login`，然后让 Codex 继续。
2. 提供一个只用于本次建仓和推送的 GitHub Personal Access Token，权限至少包含 public repository 创建/写入。

授权后可执行：

```bat
git remote add origin https://github.com/zixin-su/jellyfin-native-player-bridge.git
git push -u origin main
```
