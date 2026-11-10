# 以锚点自检的 DOM 注入扩展原生 UI，而非影子替换槽位

> **修订 3 取代本决定里的徽章座位与会话身份映射**：徽章行现在挂在工作区行（`workspace:<workspaceId>`，唯一标题兜底），会话行不再注入；React fiber 反查已从代码中移除。下文是当时的决定记录。

需求要求两处进入原生 UI 内部：侧栏每个会话行标题下方的徽章行，以及预备区「工作目录」「模式」两个下拉之间的 worktree 下拉。这两处都没有细粒度 Cordis Slot——唯一缝隙是 `sidebar.workspaces` 与 `conversation.hero.workspace` 两个单占用者槽，其原生占用者（WorkspaceBrowser 约 1500 行、WorkspacePicker）包含搜索、分组树、拖拽排序、重命名/删除对话框、目录创建流等完整交互；影子替换意味着整体复刻并从此与上游漂移。

**决定**：保留全部原生 UI，用 MutationObserver 锚定的 DOM 注入 + React portal + 作用域 CSS 扩展这两处；会话身份映射以 React fiber 反查行组件 props 为主、标题文本匹配兜底。每个注入器挂载时与每次结构变化时做锚点自检：锚点缺失即静默降级（不注入、console 告警），绝不破坏原生渲染。具备正规加法槽位的界面一律走官方注册而非注入：「文件」「diff」tab 注册进 `conversation.view`（list slot，order 20/30），diff pill 注册进 `conversation.input.dock`。

**后果**：dsh 升级改动 DOM 时，降级表现是「徽章/下拉不可见」而非界面损坏；修复即更新锚点选择器。所有注入代码集中于独立的注入面模块，锚点选择器声明为具名常量，便于升级后逐点核对。


## 修订 1：工作区行图标

worktree 工作区需要在侧栏工作区行上以分支图标替代文件夹图标。工作区行（`dsh-client-ui-workspace` 的 `*_projectRow`）同样没有细粒度 Slot，行元素也不携带 workspaceId——沿用本 ADR 的注入模式：MutationObserver 锚定行结构，行→工作区以**标题文本匹配**（fiber 反查在该组件不可用；创建标题带 `-2` 冲突后缀，重名概率极低），命中受管 worktree 工作区（`GET /worktree-workspaces`，随 workspaces store 变更刷新）时向 `*_folder` span 注入分支 SVG，并以 `[data-bw-wt] > svg { display: none }` 隐藏原文件夹图标。锚点自检与静默降级规则与徽章注入完全一致；dispose 还原全部注入节点。


## 修订 2：槽位渲染器的 `display: contents` 锚点，以及「父节点 ≠ 布局父节点」

`dsh-client-ui-renderer` 给**每一个** slot 都套了一层锚点 div：

```js
const ANCHOR_STYLE = { display: "contents" };
jsx("div", { "data-slot": slotKey, style: ANCHOR_STYLE, children: renderOutletContent(...) })
```

`display: contents` 让这层不生成自己的盒子，从而「只是可寻址表面、不参与布局」——但它**确实是 DOM 父子链上的一环**。因此 slot 的 `parentElement` 是这层包装，不是包含它的布局行：

```
div._heroWorkspaceRow              ← 布局行，也是本注入器真正的锚点
└── div[data-slot=…][display:contents]   ← parentElement 实际指向这里
    └── (插件内容)
```

**触发器**：预备区 worktree 控件的锚点自检原本写成「preset slot 的 `parentElement` 的 className 含 `_heroWorkspaceRow`」。这层包装出现后该项**恒为 false**，于是每次 pass 都走静默降级——控件永不注入。危险之处在于它是**最坏的一种失败**：`querySelector('[data-slot="conversation.hero.agentPreset"]')` 仍能找到节点，所以「锚点缺失」这一路看起来完全正常，只有 `parentElement` 的判据错了，而告警只走 `console.debug`（浏览器默认不显示）。

**决定**：锚点自检区分「**布局锚点**」与「**座位**」两件事，各自求法不同：

- **布局锚点**（本控件属于哪一行）优先用行本身的类名钩子 `[class*="_heroWorkspaceRow"]`；取不到时从座位向上爬，**跳过 `display: contents` 的包装与渲染为空的 emission 包装**，直到第一个生成盒子的元素，并用类名判据确认；**设深度上限**，结构异常时宁可放弃也不返回错误的行。
- **座位**（插在该行哪个位置）只在 slot 直接挂在布局行下时才成立。包装层自身不生成盒子，**不能作为插入点**，所以包装存在时退回「追加到行内」。

**后果**：判断依据从「某个兄弟节点的父节点是谁」换成「最近的生盒祖先是谁」。测试必须按**生产形状**构造 DOM（`行 > div[display:contents] > slot`），否则这类回归在离线套件里永远不可见——`test/client-react.mjs` 的 hero 锚点用例即为此而设，并保留了「slot 直接挂在行下」的旧形状回归。同类升级核对清单增加一条：**槽位包装层存在时，`parentElement` 与布局行并非同一节点**。

## 修订 3：徽章行归属工作区行，而非每个会话行

徽章行原本注入在**每个会话行**标题下方。可一行 git 状态描述的是**工作副本**（分支、PR、dirty、DiffStat、ahead/behind），不是某个会话：同一工作区里的每个会话行因此重复同一行信息，一个工作区有 N 个会话就多占 N 行高度，信息量与 N 无关。本插件的模型里「一个受管 worktree = 一个工作区」，所以工作区行恰好是这份状态的天然归属。

**决定**：徽章行改注入**工作区行**标题下方，会话行完全不碰。

- **归属解析**：行元素的 `data-row-key` 是 `workspace:<workspaceId>`，与 workspaces store 精确对上；没有该属性的旧外壳退回**唯一标题匹配**，标题重复（两个同名工作区）一律不注入——把别的仓库的分支画到这一行比不显示更糟。未分组伪组（key 为空）没有工作区，自然没有徽章。
- **座位**：沿用生产行结构，注入节点追加进标题列 `_projectText`。该列是 flex column，节点因此在**流内**排在标题下方，不需要 `order` 之类的跨行排序；React 自己的尾随单元格（行操作）本来就在该列之外，所以会话行时代必须靠 `order:1` 加回填 DOM 顺序才压住的「后挂载单元格跑到注入节点前面」问题不再存在。
- **行高**：工作区行原本 `height: 34px` 固定，注入的规则改为 `height: auto; min-height: 34px`，让行随标题列长高；会话行的样式覆盖全部删除，外壳渲染保持原样。
- **锚点自检**：`_projectRow` / `_projectText` / `_title` 三个钩子缺一即静默降级（`console.debug`），`window.__dshBwDebug.badges()` 报告每行的锚点与注入结果，用来区分「没匹配到行」与「注入了但为空」。
- **数据面**：`feed.track()` 的选择器从「每个会话的有效目录」变成「每个工作区的路径」，同一批请求的选择器数量随**工作区数**而非会话数增长；会话移进子目录时的 `enclosingRoot` 别名（见快照读取路径）仍服务于 diff 页与 forge 控件，只是不再决定徽章落在哪一行。

**后果**：一个工作区一个徽章行，重复消失。代价是会话级 git 差异不再可见——但那本来也只在会话被移进**未注册为工作区**的目录时才出现，且那种会话的真实状态由它的 diff 页回答。另一项已知代价：外壳的「按工作区分组」视图之外，**扁平列表与搜索结果没有工作区行**，因此这两种视图不再显示徽章行；这是把徽章定义成工作区事实的直接结果，重新按会话注入会回到本次修订要消除的重复。CSS 回归从「会话行 flex 换行」改为「工作区行长高」，`test/client-react.mjs` 的注入用例按生产工作区行形状重写。
