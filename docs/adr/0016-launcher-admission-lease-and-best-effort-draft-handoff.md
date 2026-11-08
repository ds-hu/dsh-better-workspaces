# 0016：发起会话准入租约与尽力而为的草稿交接

- 状态：Accepted
- 日期：2026-10-07

## 背景：两条真实故障都来自「把一次成功的创建当成永远的状态」

**故障一（来源声明永不释放）。** `claimWorktreeCreationSource` 按发起会话写一份
`.creation-source-<sessionHash>.json`，但成功路径从不释放它：只有
`releaseWorktreeCreationSource` 会删除文件，而它的调用点只在事务 `retired`/`absent`
时执行，且要求 txId 与 fingerprint 完全一致。客户端在成功后本就清掉自己的 txId
（`clearHeroCreationTx`），于是**同一个会话再也不可能在该仓库创建第二个 worktree**：
新 txId 撞上遗留声明，得到 `worktree: source session already owns another creation
transaction`，除手工删除文件之外没有任何出路。

现场证据（一次真实使用）：某个仓库的受管根里 7 份声明与 7 张收据按 txId 一一对应，
全部来自**已成功**的创建。其中一份属于一个先成功创建过 `silver-lantern-1149` 的会话；
数天后在同一会话里再点「创建」即被永久拒绝。

**故障二（交接读的是点击那一刻的冻结快照）。** `transferSessionDraft` 用点击时捕获的
快照判断 `phase !== "plain"`，并把否决原因写进 `lastDraftTransferReason`；调用方的
50 ms × 2 s 重试循环读的是**同一个冻结值**，因此当输入框在点击时处于
`claimed`/`adjudicating`/`submitting`，交接必然失败——而此时 worktree、工作区与会话
**已经落盘**。失败随后被当成「创建失败」上报，用户看到的是宿主英文内部消息（该实例里
目标目录 `…-crimson-cipher-eb03` 与其收据早于报错约 20 秒就已提交）。

`InputState.phase` 的契约是 `plain | adjudicating | claimed | submitting`
（`dsh-client-ui-conversation` input.d.ts），`setDraft` 无守卫、附件动词只在两个忙阶段
拒绝，本插件的 forge 链路也早已把 `plain||claimed` 当可写——交接的判据比契约更严，
且判在了错的快照上。

## 决策

1. **来源声明是准入租约，不是永久锁。** 拒绝只允许发生在「上一个事务仍可能在进行中」
   这一条证据上：旧事务有有效收据（已结算）、或既无收据也无 create journal（可证明
   从未提交）时，声明被**接管**（写 version 2，记录 `supersededTxId`/`supersededAt`）。
   旧的活 journal 才是拒绝依据：owner 存活 → `WORKTREE_TX_PENDING`；owner 已死
   （journal 尚未收敛）→ `WORKTREE_SOURCE_CONFLICT`。同一 txId 换请求体永远冲突，
   不可读的旧声明一律失败关闭。接管规则同时是存量泄漏文件的自愈路径，不需要用户删文件。
2. **宿主把该拒绝类型化。** 409 响应携带 `error: "source_conflict"`（以及可选的
   `previous`），客户端据此渲染自己的文案；宿主的英文 `message` 只作为未知错误码的兜底。
3. **草稿交接按「活的可写层级」判定。** 判据是 `plain || claimed`，且读的是**实时**
   输入状态；冻结快照的 phase 不再是判据，`sourceStillMatches()` 的 CAS（文本、修订、
   附件）才是负载唯一的证据。任何未知 phase 都按冻结处理。
4. **空源短路。** 当捕获与实时状态同时为空（无草稿、无附件、无引用）时，交接不读取
   目标作用域，直接 reveal 目标并成功——空 launcher 这一最常见路径不再受
   「目标作用域尚未物化」影响。
5. **交接失败不使已提交的创建失败。** 在发请求之前先做预检（读不到输入框、或在
   1500 ms 内有界等待后仍处于冻结层级 → 直接拒绝，什么都不创建）；请求之后若交接
   仍无法完成，则保留 worktree/工作区/会话、**不归档**源会话（草稿绝不被藏起来）、
   **不跳转**目标，保留 tx 记录（连同 `settled` 标记）以便再次点击「创建」重放同一
   txId 只重试交接，并用中文说明具体原因（可重试与不可重试两类文案分开：引用小片这类
   公开接口无法重建的内容直接提示手动粘贴）。
6. **收敛只针对未结算事务。** 已结算记录 + 选择变化 → 铸新 txId 与新请求体；否则
   会静默创建旧分支名。txId 在请求确定发出之前不再铸造。

## 否决的备选

- **保留「一个发起会话永远只创建一个 worktree」并只改善文案**：仍然把一次成功创建
  变成无出路的永久状态，且需要额外机制把「上次创建」告知客户端；租约语义下并发保护
  （同一会话同时只能有一个未决创建）完整保留，只是不再惩罚后续的显式请求。
- **预检失败关闭（草稿含引用小片或输入框长期忙就不创建）**：草稿迁移只是便利，不是
  创建的前提，让一个 UI 小片挡住建 worktree 是更强的主张；改为「创建照常完成 + 草稿
  留在原地 + 说明原因」。

## 后果

- 崩溃窗口（元数据已写、收据未写）里旧事务既无收据也无 journal 时会看到「无 journal」
  并被接管，理论上允许一次重复创建；这是为了消除永久死锁而接受的窄窗口，已有 journal
  的情况仍失败关闭。
- 声明文件不再被删除，而是记录该 launcher 最近一次事务；下一次创建覆写它。
- 交接失败后源会话保持可见与可编辑，目标会话仍在其工作区中可打开；用户可手动携带
  草稿，或再次点击「创建」重试。
## Amendment 1（2026-11-08）：`transaction_conflict` 也是终点

### 新背景

决策 1、5、6 都假设客户端手上的记录只有两种归宿：可重放（未结算）或已结算。实际还有第三种结果——宿主回 `transaction_conflict`，它意味着「这条 txId 的请求宿主永远不能接受」（收据指纹不符、检出的创建元数据指向别的事务、收据指向上一代 worktrees 目录等）。此时保留记录正是故障一在客户端的翻版：收敛规则每次「创建」都重发这条死事务，用户输入的分支名根本没离开浏览器，唯一出路是手工删 `localStorage`。

### 补充决策

1. 释放集合是 `retired` / `absent` / `transaction_conflict`（`releaseCreationTxOnFailure`）；`transaction_pending` 不在其中——那条事务仍在进行中，重放它才是收敛方式。
2. 释放的代价被显式接受：在「检出还在、只是不再属于这条事务」的两类冲突（`transaction-target-unreadable`、`transaction-target-identity-changed`）里，下一次「创建」会在它旁边建一个兄弟（`target-1`）。这与宿主对「分支名已被占用」给出的答案一致，而且只发生在用户已经看到一次拒绝之后；若按「只放行目标确实消失的原因」收窄，等于把永久锁还给 `transaction-target-replaced`——正是本次现场故障的形态。

### 补充后果

- 任何冲突都不会再让「创建」变成只会复读同一句错误的控件；用户下一次点击提交的是当时的选择。
- 一次冲突之后可能多出一个兄弟检出：它在侧栏可见、可正常归档，宿主侧的收据仍是它自己那条事务的凭证。
