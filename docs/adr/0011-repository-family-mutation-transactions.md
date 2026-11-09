# ADR 0011：仓库族变更串行化与可恢复事务

- 状态：Accepted
- 日期：2026-09-11

## 背景

同一 Git 仓库的主 checkout 与 linked worktree 共享 refs、配置和 worktree 管理区。分别按 cwd 或文件路径加锁，不能阻止 create/create、create/archive、action/action、后台 fetch 与自动改名互相穿插；失败路径里的无条件 `merge --abort` 或先删 branch 再确认 worktree 消失还可能破坏不属于本次调用的状态。Cordis 更新期间旧实例也可能仍在排空异步操作。

## 决策

1. 宿主进程使用一个模块级 FIFO mutation coordinator。所有 Git 变更按 `git:<canonical-main-root>` 串行，普通非 Git 工作区按 `workspace:<canonical-root>` 串行；不同 key 可并行。
2. key 只能来自授权阶段返回的规范主仓库身份，不得在排队后通过带 cwd fallback 的探测重新推导。获得 gate 后重新授权，并同时核对目标 root 与 main repo 的 dev/inode；Linux 复合事务自持目录 fd，Git 文件保存固定按「仓库/工作区 gate → 文件 mutex」取锁。
3. create 的 fetch、命名、路径选择、`worktree add`、元数据提交、postcondition 与 rollback 全部位于同一仓库 gate。branch-off 从预先解析的完整 OID 创建，不再使用可移动 ref。
4. 仓库专属受管根以 fsync owner record 绑定 main repo dev/inode，路径被另一仓库复用时拒绝恢复。`worktree add` 前写入并 fsync `prepared` create journal；此阶段绝不声称分支所有权。add 通过 parent-death guardian 执行，Host 被 SIGKILL 时 guardian 会终止 Git 进程组。只有 add 成功且 worktree row、branch、HEAD、path inode 与 gitdir inode 均验证后，才把 journal 原子升级为 `added` 并记录分支所有权。自动恢复不删除任何仍存在的 path 或 row（ignored/事后文件无法被竞态前的 status 完整证明），只在两者都已由人工移除后以 expected OID 做 CAS branch 删除；证据不足保留现场。有效元数据代表提交完成，只清 journal。插件专属 PR 临时 ref 同样被验证删除并在恢复时清扫。
5. archive 返回成功前证明路径不存在且 Git worktree row 不存在。此后 prune 只是 maintenance warning，不把已经提交的删除伪装成可安全整体重试的失败。Workspace registry 在归档前捕获 ID 并 fsync durable deletion tombstone；同一 repo-family gate 内仅按该 ID 删除，绝不按可能复用的路径重新查询，从而阻止新 create 在旧 generation 收敛前复用路径。删除抛错或进程在跨服务窗口退出时，启动/定时恢复重放 tombstone，确认 path 与 Git row 均已消失后幂等收敛 registry。
6. Merge 使用预先解析的 immutable target OID。冲突后即使 MERGE_HEAD、分支和 HEAD 仍匹配，插件也不自动 `merge --abort`：外部用户/Agent 可能已接管并开始解决冲突，而宿主没有跨进程 lease 可原子证明所有权。接口保留冲突现场并返回显式 recovery 提示。
7. API、Hub、自动命名和 abandoned scheduler 采用 lifecycle generation/AbortSignal。排队中的 mutation 与未完成 request body 可取消；破坏性 commit point 一旦开始就排空到一致终态。disposer 关闭 SSE/定时器并等待 in-flight promise；进程级 coordinator 防止旧、新插件实例重叠。
8. 没有 Session 原子 lease 时，abandoned cleanup 对任何 live session（包括 blank）都失败关闭；定时 sweep 进一步降为仅重放崩溃恢复日志，不自动归档。显式人工清理仍会报告并承认最后一次 session snapshot 与新会话创建之间存在插件外 TOCTOU。

## 后果

- 同一仓库中的 Host 变更吞吐量降低，但行为变成确定的 FIFO；不同仓库不受影响。
- 粗粒度单 gate 避免 merge-to-base 跨两个 worktree 时的多锁死锁，也覆盖共享 refs/config。
- 该边界只约束插件自己的 Host mutator。用户、Agent 或其他进程直接执行 Git 仍是外部并发，因此破坏性操作保留最终 Git 守卫与所有权 postcondition。
- create journal 解决 Host 在 add→metadata 窗口崩溃后的收敛；HTTP 响应丢失与当前工作区归档的跨服务交接由下述 Amendment 1 补齐。

## Amendment 1（2026-09-12）：创建收据与工作区删除交接

### 新背景

浏览器不能根据一次断开的 POST 判断 `worktree add` 是否已经提交；把「未知」当失败并强制删除会误删已经被 Agent 或外部进程继续使用的 worktree。另一个真实故障窗口是：Host 在 archive 响应前先删当前 Workspace 行，Workspace 投影随即卸载发起操作的界面；刷新后该 Workspace 的会话可能显示为「未分组」，客户端也失去先跳转到主仓库的机会。持久 registry 在事后检查中仍保有全部无关 Workspace，说明安全边界应同时覆盖「精确删除哪一行」与「何时删除当前行」，不能用恢复全表来掩盖。

### 补充决策

1. hero 为每个规范化创建意图保留稳定 `txId` 与完整请求体；未决收据必须先收敛，换分支或 PR 也不能直接覆盖它。Host 对规范请求计算指纹，把 `txId + fingerprint` 写入 create journal 与最终受管元数据；同 tx、同指纹重放既有结果，同 tx、不同指纹或不明确 pending 一律 409。journal 用随机临时文件加原子 no-replace 发布，并标记活跃 Host PID；恢复不接管仍存活 owner 的事务。
2. worktree 元数据提交后，Host 仍在同一 repo-family gate 内 `create(path, title)` 或复用精确路径的 Workspace，并把 `workspaceId` 纳入响应，随后写入独立于目标 worktree 的持久创建收据。该收据在 worktree 被显式归档后仍保留并返回 terminal retired，因此旧 tx 永远不会重新创建；若活 worktree 的 Workspace 行确实缺失，则只采用唯一精确路径行或创建新行，并以原子 receipt generation 记录新 ID。只有 worktree 与 Workspace 两者都可重放时才返回成功。
3. 创建响应未知时客户端只以同 tx 重试/调和，绝不 force-archive 猜测结果。Host 另以源 Session 身份做原子跨页面 admission；只有证明 tx 没有 journal、receipt 或 worktree 时才释放失败 claim。目标 Session ID 由 tx 确定，响应丢失或多页面重放都收敛到同一个 Session；未完成交接时保留该精确目标供重试，而不是猜测归档。
4. 当前 Workspace 与 Agent 服务没有共享的“停止接纳新 Session/Agent”租约，浏览器页面之间也没有权威的草稿所有权租约；因此仅靠空草稿快照、composer block 与两次 running 检查不能证明全局安全。此版本从 GUI 动作阶梯移除手工物理归档，并让生产 Host 对所有物理归档路由失败关闭。后台清理也只做非破坏的崩溃事务恢复；在平台提供跨服务 retiring lease 前，不以便利性换取会话失组或另一页面草稿丢失风险。
5. 对升级前或已进入物理阶段的事务，deferred 墓碑仍持久保存 Session ID 且可由已授权的主 checkout 枚举；响应、页面或 Host 在交接窗口丢失后，新客户端只在可证明安全的精确当前 Session 上续跑，其他情况保留墓碑等待人工/后续租约能力。partial teardown 不清墓碑，直到路径与 Git row 都确实消失。兑现时重新验证 repo owner、墓碑 main root 与随机 token；目标 Workspace 行已不存在时只幂等完成墓碑，仍存在时一律保留，因为旧墓碑的 Session 快照可能漏掉稍后接入的成员，而路径消失后公开投影无法证明原始成员全集。崩溃或失联宁可留下一个指向已归档路径的 Workspace 行，也不把会话变成「未分组」或按路径误删替代行。
6. 非 GUI/旧客户端未请求 deferred 时继续沿用原有 tombstone 自动收敛，以保持协议兼容；新 GUI 的 deferred token 必须由客户端交接显式完成。

### 补充后果

- 创建可能在调用方看到网络错误后已经成功，但结果保持可见且可用同一收据找回，不再依赖破坏性补偿。
- GUI 归档多一个跨服务阶段，且客户端崩溃可能暂留不可打开的 Workspace 行；这是为了优先保持会话归组与无关 Workspace 不变量。
- public Conversation API 可条件转移文本与运行时附件 ID，并由 Conversation 服务重绑文件上传；它不能重建结构化引用 chip，因此存在 chip 时交接失败关闭而不是降级为文本。

## Amendment 2（2026-09-12）：Git 元数据能力与 Hub 生命周期

### 新背景

仅固定工作树目录并不足以阻止路径替换：普通仓库可用 `.git` 文件指向外置 Git dir，linked worktree 还会共享 common dir；如果命令在授权后重新按路径发现这些目录，攻击者可在检查与执行之间替换再恢复（ABA）。另一方面，Hub 的异步授权、watcher、fetch 与 PR poll 会跨 Cordis 更新排空，旧 generation 的完成值不能写回新实例。

### 补充决策

1. Workspace 能力同时携带 worktree Git dir、common dir 及二者 dev/inode。Linux 读取和主要写事务分别打开、复验并持有工作树、主仓库、Git dir 与 common dir，把 `GIT_DIR`、`GIT_COMMON_DIR`、`GIT_WORK_TREE` 指向宿主进程的 `/proc/<pid>/fd/<n>`；这也支持 `.git` 文件与 separate-git-dir。非 Linux 没有等价锚点时失败关闭，而不以“事后再验”冒充稳定读取。
2. Git 环境与生命周期 AbortSignal 通过 AsyncLocalStorage 传播；全局并发队列在入队前捕获调用者作用域、出队后重新进入，避免并发请求互相泄漏 Git 身份。新 worktree 建成后的自身验证会显式退出来源仓库作用域，防止把来源的 Git dir 误当成新目标。
3. Hub 的 target 由 `session/cwd` generation、精确 map 身份和 lifecycle signal 共同围栏。授权逆序返回、切换后旧请求、dispose 后 watcher/fetch/Forge 完成都不能发布；强制刷新在已有计算期间只排队一个后继 generation，部分 watcher 覆盖降级为轮询。
4. SSE、target/negative/client caches 与 mutation lease 均设上限或精确 owner token；停止时中止可取消的 Git/gh 请求并销毁慢 SSE 客户端。已经越过破坏性 commit point 的事务仍按本 ADR 的原规则排空到一致终态。

### 补充后果

- Linux `/proc` 成为稳定 Git API 的明确平台前提；换取的是读取和写入都不再依赖可被路径 ABA 替换的元数据发现。
- Git helper 的调用上下文成为能力的一部分，测试必须覆盖并发队列饱和、外置 Git dir 和环境变量清洗。
- Hub 更新/停止更快且不会把旧会话结果投射到新 cwd，但缓存和 SSE 超限时会主动淘汰或断开而不是无限保留。

## Amendment 3（2026-09-17）：遗留受管根的事务解析顺序

### 新背景

owner record 是本 ADR 引入的（提交 `6e509f2`，2026-09-11）。在此之前诞生的受管根没有该文件，而**客户端每次创建都携带持久化 txId**（幂等重试）。POST /worktrees 的顺序是：先 `findWorktreeCreation` 事务预检，再进入 `createWorktree`；但前者调用 `verifyRepoOwner(..., { create: false })`，对缺少 owner record 的根直接返回 `conflict/repo-owner-changed`，被映射为 409 `transaction_conflict`。真正会认领遗留根的 `prepareManagedRoot`（`create: true`）位于 `createWorktree` 内部，永远轮不到执行 —— 于是「有受管历史但无 owner record」的仓库**永久无法创建**，而从未建过 worktree 的仓库（受管根不存在）不受影响。这个缺陷此前被同源门禁的 403 掩盖（请求根本没进入业务层），直到隧道场景放行后才暴露。

### 补充决策

1. 事务解析（`findWorktreeCreation`）保持只读、`create: false` 的严格语义：它必须能对「存在但身份不符」的根失败关闭，不得由解析器本身写入状态。
2. 任何以创建为目的、且在创建前解析事务的入口，必须先调用导出的 `prepareManagedRoot`：owner record 缺失即按既有语义认领（写入当前 main repo 的 dev/inode），记录存在但不符仍抛错拒绝。API 的预检路径与失败后的来源声明释放路径都遵守此顺序。
3. `prepareManagedRoot` 因此成为公开的宿主 API 契约（供 api 层在 mutation gate 内、以授权后的稳定根调用），而不是 worktree 创建路径的内部细节。
4. 回归测试固定该场景：预置一个只有目录、没有 owner record 的受管根，携带 txId 的创建必须 201 并写入记录，重试必须 200 replay。测试在移除引导调用时必须以 `transaction_conflict` + `reason: repo-owner-changed` 失败。

### 补充后果

- 升级后首次在某仓库创建 worktree 会自动认领其遗留受管根，无需人工补写 owner record；已存在的 worktree 与元数据不受影响。
- 解析与认领的职责分离被显式化：只读解析器不再承担引导，引导必须发生在持有仓库 mutation gate 的写路径上。
- 若仓库路径被真正替换（dev/inode 变化），行为与 Amendment 2 一致：拒绝，不认领。

## Amendment 4（2026-11-08）：已提交收据的重放不要求检出仍在创建时的分支

### 新背景

一次现场故障：某会话在 11-06 成功创建了 worktree（收据与元数据齐备、指纹一致），随后工作就在那个检出里进行，分支被改成了另一条。此后该发起会话每次点「创建」都得到同一句 `hero.txConflict`（当时的文案是「同一创建事务的请求不一致，已保留原请求」，该措辞随后按 ADR 0016 Amendment 1 更正），换任何分支名都无效，唯一出路是手工清 `localStorage`。

原因在重放的身份证明上：`findWorktreeCreation` 用 `validateManagedWorktree` 的**严格**答案校验收据指向的检出，于是「元数据分支 == git 当前分支」成了重放成立的前提。检出就是干活的地方，分支改名或切换是正常使用，不是「目标被替换」；而客户端对未结算事务的收敛规则会持续重发同一个 txId，所以这条严格检查把一次**早已成功**的创建变成了永久的 409。

### 补充决策

1. 收据重放的身份证明只由两样东西构成：收据的 `requestFingerprint`，以及该检出自身元数据里的 `creationTxId`/`creationFingerprint`——即「这条事务创建了这个检出」。当前分支不参与判断。
2. 「当前分支不是身份」是**读路径与动作路径**的规则，不是重放这一处的特例，也不是全局规则。这些调用点统一改问 `validateManagedCheckout`（内部即 `allowBranchMismatch`）：快照的 `managed`、动作阶梯的 Archive 门禁、侧栏分支图标、`authorize` 的 `kind` 判定（连带 `/detect`、标题自愈与任务 diff）、worktree 列表与 txId 扫描。另有**三处**保留严格形态，各自写明理由：崩溃 journal 的恢复、刚完成创建的收尾后置条件，以及清理候选（下一条）。
3. 清理仍用严格形态，因为它的风险守卫读的是检出的**活 HEAD**。dirty、相对不可变基线的超出提交、以及当前分支的未推送 ref，量的都是它现在所在的分支；一个被切到别处、在新分支上与基线齐平且工作树干净的检出，会让这三条全部通过，而真正的未推送工作留在它离开的那条分支上——sweep 于是会删掉这个检出、连带它的 ignored 文件与工作区行，并报出一条工作从未发生过的分支名。分支相等不是身份，但对一次**自动** sweep，它是让那三条守卫名副其实的前提。回归测试固定该场景：漂移且带未推送提交的检出必须被报告、不被清扫，提交仍可达。
   - 用户主动点的 Archive 不是同一类决定：检出现在眼前，归档只删检出、分支与提交始终保留，动作阶梯对 dirty/未推送另有警告。
   - 装配现状：清理的**候选循环**今天到不了——插件以 `recoveryOnly: true` 构造清理，进程内定时任务传 `abandoned: true, automatic: true`，HTTP 路由不传 `abandoned`。因此本条描述的是「将来打开 sweep 时必须成立」，不是今天就生效的行为；本修订早先的注释与后果把「每轮 sweep 报 ownership 错误」当作既成事实，那是错的。
4. 重放的回答描述检出的**当前**状态：`result.branch` 取 `actualBranch`，否则退回创建时记录的分支。后者只在 detached HEAD 时出现（worktree 列表行的 `branch` 为 `null`），那时「当前分支」没有名字，退回记录的旧名只是可显示值，不承诺它就是 HEAD。
5. 同 tx 不同指纹仍然冲突（回到 Amendment 1 的规则），回归测试固定这一点。
6. 改了 `worktreesDir`（ADR 0017）之后，收据文件本身也随基目录走：旧收据留在旧基目录，新基目录里根本读不到它，所以重放得到的是 **`absent`**，而不是 `transaction-receipt-mismatch`（后者要求收据被读到、路径却落在受管根之外）。这是**有意的**：插件不认领当前基目录之外的检出，旧检出原地保留、分支完好，由 ADR 0017 的 stranded 提示负责让人看见；一次带同一 txId 的创建请求于是会在新基目录下建出第二个检出（并排），而不是复用旧的。

### 补充后果

- 一个创建后又被切了分支的 worktree，现在重放为 `committed`，客户端拿到原收据里的 path/workspaceId 继续交接，不再被锁死；回答里的分支名是它现在所在的分支。
- 漂移的检出在产品里不再是「未知检出」：动作阶梯的 Archive 恢复可用、侧栏保留分支图标、`authorize` 仍判为 `managed-worktree`、`/detect` 仍报 `managed`，标题自愈与任务 diff 因此恢复。（物理归档接口仍按 ADR 0016 失败关闭——那是既有的会话租约缺口，与本次判定无关。）
- 读路径一致也意味着 PR 来源信任随之成立：`pullIdentityTrusted` 现在对一个「创建自 PR、之后又被切到别的分支」的检出也为真，因此合并、关闭自动合并等远程动作与 PR 徽章对它仍可用。这不是新增权限——那些动作本来就要求用户点击、并用 `gh` 的既有身份——而是「漂移不是身份」这条规则在读路径上的直接后果；本修订之前，它会被当作普通 worktree 而静默关掉这些能力。
- 自动 sweep 对它仍然拒绝并报告（决策 3）。这条只有在将来解除 `recoveryOnly` 之后才会被观察到。
- 收据指向的检出若真的被替换或不可读，仍按原样 conflict（`transaction-target-replaced` / `transaction-target-unreadable`）。
- 客户端在冲突时释放事务记录（ADR 0016 Amendment 1），与此处的放宽互为兜底：两侧都不会再产生永久锁。
