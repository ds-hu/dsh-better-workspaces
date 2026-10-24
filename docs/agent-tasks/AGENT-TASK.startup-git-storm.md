# 委托书：修复 snapshots / detect 抢占启动、与后台 git spawn 风暴

日期：2026-10-24 · 委托来源：本机 dsh webui 卡顿排查会话（证据均为实测） · 优先级：高 · **状态：已完成，实测验收通过；机制更正见下文**

## 任务一句话

启动时 webui 会为**每个工作区**各发一条 `POST /snapshots`（客户端按 cwd 拆条，服务端每 cwd 顺序跑 10+ 个 `git.exe`），20 个工作区叠加成数百个并发子进程，单条请求 30s–1.6 分钟；这些长请求占满浏览器对 dsh web 宿主仅有的 6 条 HTTP/1.1 连接，导致整个 UI（新建对话、`/plan`、其他插件的取数）排队卡死。**请把启动与增量计算收敛成"批量、限流、按需"的模型。**

## 症状（用户可感知）

- 打开/刷新 webui 后一段时间内整个界面无响应；DevTools Network 里 8 条左右 `POST /snapshots` 分列 30.08s / 29.10s / 37.19s / 1.1min ×3 / 1.2min / 1.6min，另有 `GET /worktrees/deferred?cwd=…` 1.2 分钟、`GET /detect?path=…` 长挂起。
- 同一时刻别的插件接口（如 toolbridge 的 `/state`）也一起排队——属同一机制：6 连接池被长请求占满。

## 诊断证据（2026-10-24 实测，dsh 0.2.0-rc.2，插件以 github 方式装在 `~/.dsh/profiles/web`）

**客户端扇出**
- `lib/client.js` 的 `track(cwd)` 在 cwd 首次被追踪时调用 `pollCwd(cwd)`；每条 `pollCwd` 是一次独立的 `POST /snapshots`，body 只有 1 个 cwd，**无 in-flight 去重、无批合并、无并发上限**。启动时侧栏每渲染一个工作区就发一条 → 20 个工作区 = 20 条并发长请求。
- 对比：同文件的 `pollAll`（15s 周期）其实已经用批量 + `polling` 互斥，说明批量通路已存在，只是启动路径没走它。

**服务端计算成本**
- `lib/api.js` 的批量 `/snapshots` 对 `selectors` 是 `for … await authorizeGit(...)` **串行**鉴权（每次鉴权本身还要跑 git）。
- `lib/state.js` 的 `snapshotFor` 有 3s 缓存（`SNAPSHOT_FRESH_MS`），但缓存未命中时每个 cwd 顺序执行一长串 git 调用：`currentBranchInfo`、`porcelainStatus`、`resolveDefaultBranch`、`resolveBestComparisonBaseRef`、`aheadBehind`、`upstreamInfo`、`originUrl`、`originBranchDelta`、`diffStat`、`validateManagedWorktree`、forge 身份、`remoteUrl('upstream')`。
- 后台还有持续放大：fs.watch 变更 → `scheduleCompute(WATCH_DEBOUNCE_MS=1000)` 全量重算；`TICK_MS=5000`、`DEGRADED_POLL_MS=5000`、`FETCH_INTERVAL_MS=180000`（每个 repo 每 3 分钟 `git fetch`）。agent 在会话里写文件时，1 秒级 debounce 会反复触发全量重算。

**串行 lane 的额外等待**
- `lib/api.js` 的 `GET /worktrees/deferred` 是**只读**，却包在 `mutations.run(mutationKeyFor(auth), …)` 里——仓库有写事务（worktree 创建/删除等）在跑时，这个读请求只能在 lane 上排队，实测 1.2 分钟。

## 机制更正（实测，落地前复核代码后确认）

原始诊断的**症状与定位都对**，但三条机制推断与代码不符，它们改变了修复的形状：

| # | 原判断 | 实测 | 后果 |
|---|---|---|---|
| F1 | 需要新增「全局 git 信号量（4–6 并发）」 | `lib/git.js` 早已有 8 槽 FIFO 限流器，所有 `runGit` 必经 | 峰值并发是 8，不是 200+；200 是**排队深度**。降并发只会拉长墙钟。原验收标准第 3 条（峰值 ≤6）在修复前就已满足。 |
| F2 | 每 cwd ~10–12 个 git 子进程 | 实测 ~42–48 个，其中 **27 个来自授权**：每次 `authorize` 跑 `detectRepo`(3) 再在 `validateManagedWorktree` 里再跑一次(3)，而一个 target 首次出现要授权两次、每次计算前后又各授权一次。快照本身只有 ~15–18 个。 | 降本的主战场是**授权**，不是快照字段；因此有了发现缓存（ADR 0013 修订 2）。 |
| F3 | `git fetch` 属 Phase 2 | 新 target 一出现就以 0 延迟排一条 fetch，下个 5s tick 每 repo 各起一条、120s 超时，占**同一条** 8 槽车道 | 启动期最多 8 条网络型 fetch 堵在 `/snapshots` 队列前；它是一阶原因，已进 Phase 1。 |
| F4 | 客户端合并请求后单条应 < 2s | 合并只改条数：服务端仍 `await Promise.all` 全部计算，那一条请求的墙钟等于全部计算之和 | 必须让响应**不等待**（ADR 0018），否则验收标准第 1 条不可达。 |
| F5 | 两条 404 疑为 client bundle 与 host 版本不一致 | 与本仓库无关：`changes.summary` 属 harness 自身 `dsh-client-ui-deliverables`（`/api/changes.summary`）；`state?sessionId=` 属 `@ds-hu/dsh-plugin-toolbridge`。已装 `@ds-hu/dsh-better-workspaces@0.2.10` = 仓库 HEAD，无版本漂移。 | 该检查项作废，不在本仓库修。 |
| F6 | 后台重算节流属 Phase 2 | `tools/result` 与 `api-session/status` 都触发**全量** `refreshActive()`；20 工作区 × ~45 spawns ≈ 25s 车道时间 > 5s 节流 ⇒ agent 工作期间车道永不排空 | 稳态与启动是同一机制，已进 Phase 1。 |

术语上还有一处要分清：仓库已有三套不同机制——**变更门**（仓库族写事务 FIFO，ADR 0011）、**git 车道**（`runGit` 并发上限）、**授权**。原委托书的「并发上限 + 按 repo 串行」会造出第四套并重复前两套的职责；实际做法是只给车道加分级。

## 实际落地（按提交）

1. `feat(git)` 车道分级（`lib/lane.js`，前台/后台 + 防饿死提升）。
2. `perf(authorize)` 发现缓存（只缓存字符串，键含 dev/ino，写入路径绕开）。
3. `perf(state)` 单次 `status --porcelain=v2 --branch` 合并探测 + per-repo 事实 TTL + fetch 首见延迟/限流/30s 超时。
4. `perf(api)` `/snapshots` 不再等待计算（`pending` + SSE），授权并发但仍在触碰 hub 之前全部通过。
5. `perf(client)` 轮询合并（一次一批、不丢 cwd、`refresh` 用 `fresh`）。
6. `perf(hub)` 稳态按仓库族收窄、分钟级轮转兜底、degraded 退避、墓碑读取移出变更门、deferred 恢复不再逐工作区 `/detect`。
7. `docs` 本文件、ADR 0018、ADR 0013 修订 2、`CONTEXT.md` 术语、`TECHNICAL.md`。

## 验收标准（重写后，人工实测）

**状态：2026-10-24 由报告人在真实环境实测通过**（Windows + dsh 0.2.0-rc.x，≥15 个已登记工作区）。实测数字未回填——若要留档，把 DevTools 的响应时间、`netstat -ano | findstr :3080` 的 ESTABLISHED 峰值、Process Explorer 的 `git.exe` 峰值贴到本文件即可。

在 ≥15 个已登记工作区的真实环境（Windows + dsh 0.2.0-rc.x）上：

1. 冷启动后：`POST /snapshots` **响应 < 200 ms**；全部工作区的分支/ahead-behind/diff stat/worktree 徽标在 **30 s 内收敛**正确。（原「单条 < 2s 且一次算完」在 Windows 上不可达：降本后 20 个工作区仍约 240 个 spawn、≈25 s 的 8 车道时间，只能靠「不等待 + 推送」满足体感；要 15 s 需再砍掉配置守卫子进程，属单独 ADR。）
2. `netstat -ano | findstr :3080`：浏览器侧 ESTABLISHED 连接启动期峰值 **≤ 3**（1 条 SSE + ≤2 条请求）。
3. 同时启动 `git.exe` 的峰值 **≤ 8**（总车道容量）。后台 `git fetch` 只限**起步速率**：每 5 s tick 最多起 2 条、单条 30 s 超时，因此冷启动最坏约 12 条同时在途——它们全部属后台类、共用同一条 8 槽车道，所以既排在交互式读取之后，也不会让 `git.exe` 峰值越过 8。**并发硬限 2 是后续改动，当前版本不作此承诺**（见 ADR 0018 后果最后一条）。
4. 启动期与 agent 写文件期间，另发一条交互式 `GET /detect`：等待 ≤ 单次 spawn 量级（前台不被后台重算或 fetch 挡住）。
5. 工作区 git 状态（分支、ahead/behind、diff stat、worktree 徽标）与修复前一致，无回归。
6. 启动完成后新建对话/`/plan` 不再出现整 UI 排队。
7. 证据（DevTools Network 时间线、`netstat`、Process Explorer 计数）记录在 PR。

## 检查项（已结论）

- 截图中的两条 404（`changes.summary?sessionId=…`、`state?session=…`）**不属本仓库**：前者是 harness 自身的 `dsh-client-ui-deliverables`（宿主路由 `/api/changes.summary`），后者是 `@ds-hu/dsh-plugin-toolbridge`（`/state?sessionId=`）。已装插件版本 0.2.10 与仓库 HEAD 一致。按「非目标」在各自仓库处理。

## 环境事实

- 仓库即源码（`lib/*.js` 手写，无构建步骤）；测试在 `test/`，`npm test`/`vitest` 运行。
- 客户端 bundle 改动**无需重启** dsh web：宿主 500ms stat 轮询会推新 rev，刷新页面即生效；host 侧（`lib/api.js`、`lib/state.js`、`lib/git.js`、`lib/index.js`）改动需要重启 dsh web。
- 相关文档：`docs/TECHNICAL.md`、`docs/adr/0018-read-path-never-waits.md`、`docs/adr/0013-cross-platform-stable-operations.md`（修订 2）、`CONTEXT.md`（快照读取路径 / 快照计算 / git 车道 / 发现缓存）、`docs/adr/0011-repository-family-mutation-transactions.md`、`docs/adr/0004-worktree-branch-semantics.md`。
- 上一轮同族修复（toolbridge 每会话轮询霸占连接池）已完成，本单是该类问题的第二个、也是启动阶段最大的占用者。
