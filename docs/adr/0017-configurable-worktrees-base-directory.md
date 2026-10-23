# ADR 0017：worktrees 基目录作为配置项，单根且不做并集

- 状态：Accepted
- 日期：2026-10-24

## 背景

托管 worktree 的基目录写死在 `lib/worktree.js` 的 `worktreesRoot()`：`${DSH_HOME:-~/.dsh}/worktrees`。要把 worktree 放到另一块盘或另一个卷，用户唯一的手段是搬 `DSH_HOME`——而那是 profile、会话、日志与凭据的家，代价远大于目的。请求因此是明确的：**在配置 yml 里指定基目录，不要 UI**。

约束来自既有决策：ADR 0010 要求托管 worktree 的归属能由「插件元数据 + 来源仓库 + 托管命名空间 + Git worktree 清单」四者共同证明，且全局根与仓库 hash 根必须是直接规范目录。基目录成为可配置项后，「托管命名空间」的位置由配置决定，证明本身不变，但它的边界变得可移动——这正是本 ADR 要钉死的地方。

## 决策

1. **`worktreesDir` 是插件行 `config` 的唯一键**，在挂载时（`apply`）读取并一次性定格。它只替换 hash 分组的父层：布局仍是 `<worktreesDir>/<projectHash(主检出)>/<repo>-<branch>`。hash 分组不是装饰——ADR 0010 的命名空间证明、cleanup 的全量扫描、`pendingTransactionMainRoots` 的恢复扫描都以它为轮转单位。
2. **结构性无效在 `apply` 抛错，行不进入 running**：非字符串、相对路径、`~其他用户`、未知键。磁盘状态（目录不存在、是符号链接/junction、不可写）留到首次使用时报精确错误——网络盘不在线不该让整个插件拒启，而插件其余功能（徽章、diff、PR）与 worktree 创建无关。任一路径都**不回落默认目录**：静默换目录会把 worktree 写到用户没选的地方。
3. **单一命名空间，不做并集**：托管身份只按当前基目录判定。把「配置根 ∪ 内置默认根」都算托管可以保住旧树，但要同时改 cleanup 扫描、journal 恢复、`validateManagedWorktree`，并把 ADR 0010 的边界从「一个已知根」改成「一个根集合」——收益只是省掉一次搬迁。代价则用一条**启动告警**补上：当配置基目录与内置默认目录不同、而默认目录下仍有托管检出时，宿主打一行日志点名两个目录与数量，说明这些检出仍可 diff/提交/推送但不再托管（无归档、无 abandoned 清理）。这是诊断，不是授权：它读元数据、按 `projectHash` 关系判断命名空间归属，从不参与任何授权决定，也从不修改任何东西。
4. **拒绝把基目录放进被创建仓库的主检出**：创建立刻就能免费拿到 `mainRoot`，一个纯路径判断即可。否则 `worktreesDir: D:\Projects\my-repo`（把父目录写成了仓库本身）会让 worktree 落在主检出内部、把主检出弄脏，并制造嵌套 worktree。

## Considered Options

- **并集（配置根 + 默认根都算托管）**：保住旧树，代价见决策 3；且「到底哪个根才算」会渗进每一个校验点。
- **连 hash 层一起去掉（`<基目录>/<repo>-<branch>`）**：目录更直观，但两个同名仓库在同一层碰撞、`uniquePath` 只能退化成 `-1`，命名空间证明也失去「每仓库专属根」这一环。
- **环境变量入口**（如 `BETTER_WORKSPACES_WORKTREES_DIR`）：不必改 profile patch，但与本请求不符，且多一条优先级规则要说清。`DSH_HOME` 继续只是默认值的来源。
- **UI**：一个键的表单不划算，用户也明确不需要。

## 后果

- 首次改动基目录时，默认目录下的既有托管 worktree 会**降为普通 worktree**：授权退为 `kind:'workspace'`，diff/commit/push/PR/merge 全部照旧，但归档被拒、abandoned 清理扫不到、`/detect` 报 `managed:false`（于是 diff 视图的默认范围从 task 降为 session/uncommitted）。旧基目录下的 create journal 与 registry tombstone 同理不再被扫描，所以改配置前应先跑完在途创建。
- 基目录继承 ADR 0010 的直接规范目录要求：符号链接、junction、8.3 短名会在首次使用时被拒绝，错误文案点名配置值与原因。
- 配置值是整行 `config` 的整体替换（host patch 语义）。目前只有一个键，所以 `- id: better-workspaces` + `config: { worktreesDir: … }` 是完整的；将来加第二个键时，用户 patch 必须一并重述，否则会静默回落默认值。
- 基目录是模块级单例，因为一个进程只有一条挂载行；配置层热重载会重新 `apply` 并重设它，不带 `worktreesDir` 的挂载会恢复内置默认值。测试以 `configureWorktreesBaseDir(null)` 复位。
- 目录名、分支名、`projectHash` 与元数据格式全部不变——本决策只移动父目录。
