# dsh-better-workspaces

DeepSeek Harness Web GUI 的 Git 增强：工作树、差异审阅、Pull Request 与 issue 引用。
0.4.0 起它由**四个可独立开关的插件**组成，共享同一套内核。

`@ds-hu/dsh-better-workspaces` 是组合包（bundle）：它自带的 `cordis.patch.yml`
插入四条 Loader row，因此 dsh 插件面板里会看到四个独立开关：

| Row | 模块 | 提供什么 |
| --- | --- | --- |
| `bw-diff` | **代码变更** | 官方右侧栏的 diff 页：未提交/已提交/任务三种差异、提交列表、提交 → 拉取 → 推送 → PR → 合并 → 归档的动作阶梯，以及带 CAS 保护的文件编辑器。 |
| `bw-worktree` | **新建 worktree** | ① 输入框上方的暂存条（模式菜单、分支名骰子、择基/PR 选择、创建）与 ② 同名的右侧栏页面。两者在同一行里各有一个开关（在该行的配置卡片里）。 |
| `bw-status` | **工作区 Git 状态** | 左侧每个工作区标题下的分支/PR/CI/`+N/−N`/`↑a↓b` 徽章行、托管工作树图标，以及输入框上方的 diff 胶囊。 |
| `bw-forge` | **Issue 与 PR** | ① 输入框里的 GitHub 圆标（issue/PR 选择器，挂上引用 chip）与 ② 同名的右侧栏页面。两者在同一行里各有一个开关。 |

关掉其中任意一行，其余三行完全不受影响：每条 row 都是独立的 Cordis 条目，有各自的
宿主路由、各自的浏览器 bundle、各自的开关。共享库 `@ds-hu/dsh-bw-core` **不是**可开关
模块（既不声明 `dsh.bundle` 也不声明 `dsh.client`），不会被误关。

## 安装

要求：`dsh` ≥ 0.2.0、`web` profile、Node.js ≥ 20.19、`PATH` 上有 `pnpm`、`git` ≥ 2.31；
支持 Linux / Windows 10+（Git for Windows）/ macOS 13+。`gh` 可选（已登录时才有 PR/CI
徽章、选择器与 PR 检出，缺失时其余功能照常）。

```bash
dsh plugin --profile web add @ds-hu/dsh-better-workspaces
```

重启一次 `dsh --profile web` 即可，没有第二步：组合包声明了 `dsh.bundle`，它的 patch
就是四个模块的挂载来源。**不要**手工往 profile 的 `cordis.patch.yml` 里再写一遍行。

### 从 0.3.x（单行）升级

0.3.x 只有一条 `better-workspaces` row；0.4.x 换成 `bw-diff`、`bw-worktree`、`bw-status`、
`bw-forge`。老 profile 里请：删掉 `- id: better-workspaces` 的覆盖项（未知 id 只是警告，
但已无意义）；按模块重新选择开关；`worktreesDir` 写在任意一个功能行上（建议 `bw-worktree`）。
浏览器存储键、草稿交接协议与所有 HTTP 响应形状都没变。

## 原生模块开关

* **整个模块**：插件面板里那一行的开关。关闭后宿主半边不会挂载，浏览器 bundle 也会从
  `__DSH_BOOT__` 里消失。
* **模块 II / IV 的两个界面**：该行自己的配置卡片（同一个 bundle 内注册，拨动开关即时
  重新注册，无需刷新）。
* **路由组**：关闭的模块，其路由返回 `404 {"ok":false,"error":"feature module disabled"}`。
  只读数据面（`/snapshots`、`/events`、`/detect`、`/pulls`、`/pull`）由共享内核持有，
  只要还有任意一个模块在就可用——这就是每个模块单独开启也能完整工作的原因。

契约见 [docs/ARCHITECTURE-modules.md](docs/ARCHITECTURE-modules.md)，术语表见
[CONTEXT.md](CONTEXT.md)，设计记录见 [docs/adr/](docs/adr/)。

## 配置

唯一的宿主配置键是 `worktreesDir`（托管工作树命名空间的父目录，默认
`<DSH_HOME>/worktrees`），写在某一个功能行上（建议 `bw-worktree`）：

```yaml
- id: bw-worktree
  config:
    worktreesDir: /absolute/path/to/worktrees
```

已有工作树时改动基目录：那些检出仍可 diff/提交/推送，但不再属于托管命名空间（不可归档、
不被废弃清扫），宿主会在启动日志里点名被落下的目录。

## 开发

仓库是 npm workspaces 单仓多包：

```
packages/core       @ds-hu/dsh-bw-core    共享宿主引擎 + 共享浏览器源码（不是 row）
packages/diff       @ds-hu/dsh-bw-diff    row bw-diff
packages/worktree   @ds-hu/dsh-bw-worktree row bw-worktree
packages/status     @ds-hu/dsh-bw-status  row bw-status
packages/forge      @ds-hu/dsh-bw-forge   row bw-forge
```

浏览器 bundle 是 **CI 产物**：`npm run build:client`（esbuild）生成
`packages/<feature>/lib/client.js`，该文件被 git 忽略、由 CI 在测试与发布前构建。
仓库里永不提交构建产物，所以 checkout 不会出现「源码与产物不一致」。
质量门禁与发布都在 GitHub Actions 里跑（`.github/workflows/ci.yml`、
`.github/workflows/release.yml`），`npm run check` 是同一条门禁。

## 许可

MIT。工作树与编辑器设计部分参考 [paseo](https://github.com/paseo-ai/paseo)
（Apache-2.0）与 harness 的 `dsh-git-worktree`（MIT），见 `NOTICE` 与 `LICENSES/`。
