# dsh-better-workspaces

[English](README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · [Français](README.fr.md) · [한국어](README.ko.md)

在 DeepSeek Harness Web GUI 的对话里直接使用 worktree、差异、Pull Request 和 Issue。一个会话专注一个改动，从第一条消息到提交都在同一个页面完成。

![输入框上方的 Local 与 New worktree 切换](docs/screenshots/01-worktree-mode.png)

**1 · 先选工作位置。** 输入框上方有 `Local` 和 `New worktree` 两个选项。小修改留在当前目录；任务需要独立分支和目录时，选 `New worktree`。

![包含分支名、基线与创建按钮的 worktree 表单](docs/screenshots/02-worktree-form.png)

**2 · 起名、选基线、创建。** 输入分支名，或点骰子生成一个。基线可以是本地分支、远端分支或 Pull Request。点 Create 后，worktree 会作为独立工作区打开，并准备好会话。

![会话行显示分支与改动量](docs/screenshots/03-sidebar-badges.png)

**3 · 一眼看到每个会话的状态。** 分支和改动量就在会话标题下方。分支有 PR 和检查时，它们会出现在同一行。确认进度不必打开终端。

![差异页包含范围切换、文件列表、逐行差异和操作按钮](docs/screenshots/04-diff-view.png)

**4 · 在一个页面里看完整个改动。** 点 `±` 在右侧打开差异页，可在未提交、本会话、任务、对比基线之间切换。展开文件可以看逐行差异，也能直接编辑或查看提交列表。

![Commit 按钮与包含 Pull、Push、PR、合并、更新、丢弃的 More 菜单](docs/screenshots/05-diff-actions.png)

**5 · 不离开页面完成交付。** 可以 Commit、Pull、Push、创建 PR、合并、从基线更新或丢弃改动。不可用的操作会说明缺少什么。

![列出开放 Pull Request 和 Issue 的 GitHub 选择器](docs/screenshots/06-github-picker.png)

**6 · 把 PR 或 Issue 带进输入框。** 输入框旁的 GitHub 按钮会列出当前仓库的开放 PR 和 Issue，选一条即可附加引用。

![输入框中只显示一个紧凑的 Issue 引用标签和发送按钮](docs/screenshots/07-reference-chip.png)

**7 · 草稿保持简洁。** 输入框里只多一个小标签。发送时，它会展开成完整的标题、链接、基线/分支和正文，让模型得到准确上下文。

## 安装

```bash
dsh plugin --profile web add github:ds-hu/dsh-better-workspaces
```

重启一次 `dsh --profile web`。需要 dsh ≥ 0.2.0、Node.js ≥ 20.19、`pnpm`（在 `PATH` 中）和 git。PR 与 Issue 功能还需要已登录的 `gh`；其余功能没有 `gh` 也能使用。

## 使用

1. 打开一个 git 工作区，新建会话。
2. 在输入框上方选择 `Local` 或 `New worktree`。
3. 用 `±` 查看改动，用 `Commit` / `More` 完成提交，用 GitHub 按钮附加 PR 或 Issue。

## 说明

- 支持 Linux、macOS 13+ 和 Windows 10+。
- `gh` 可选。未安装时，worktree、徽章和差异页照常工作。
- 所有操作都留在当前浏览器标签页内。

## 文档

架构、设计记录、安全、开发与运维见 [docs/TECHNICAL.md](docs/TECHNICAL.md)。设计决策见 [docs/adr/](docs/adr/)。

## 许可证

MIT。第三方声明见 [NOTICE](NOTICE) 和 [LICENSES/](LICENSES/)。
