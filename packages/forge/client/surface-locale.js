/**
 * Every string the new `bw-forge` surfaces introduce: the right-sidebar
 * Issue 与 PR page and the row's native config page.
 *
 * The bundle entry merges these dictionaries into the `bw-forge` locale
 * namespace, so keys are shared with the composer GitHub control. Keep the
 * legacy key style (`sidebar.*`, `guide.*`, `config.*`, `auth.*`) and never
 * put display text in a component.
 */
export const zh = {
	'sidebar.title': 'Issue 与 PR',
	'sidebar.description': '浏览本仓库的 issue 与 pull request，选中即作为引用插入当前草稿。',
	'guide.title': 'Issue 与 PR',
	'guide.description': '浏览并引用本仓库的 issue 与 pull request',
	'config.title': 'Issue 与 PR',
	'config.description': 'GitHub 引用有两个独立入口：输入框里的图标，以及右侧栏里的页面。改动即时生效，无需刷新页面。',
	'config.composer': '输入框里的 GitHub 图标',
	'config.composerDescription': '在输入框工具行显示 GitHub 图标，用于添加 issue / PR 引用',
	'config.sidebar': '右侧栏的「Issue 与 PR」页面',
	'config.sidebarDescription': '在右侧栏「代码变更」旁新增 Issue 与 PR 浏览页面',
	'filter.label': '筛选 issue 与 PR',
	'filter.placeholder': '筛选编号或标题',
	'refresh': '刷新',
	'refreshing': '刷新中…',
	'loading': '加载中…',
	'kind.issue': 'Issue',
	'kind.pr': 'PR',
	'kind.unknown': '条目',
	'count': '{n} 条',
	'attached': '已添加引用：{label}',
	'attachFailed': '无法添加引用：{reason}',
	'attachUnavailable': '当前会话的输入框不可写入',
	'list.empty': '这个仓库没有未关闭的 issue 或 PR',
	'list.noResults': '没有匹配的 issue 或 PR',
	'auth.no_remote': '该仓库没有可用的 GitHub 远端',
	'auth.cli_missing': '未找到 gh CLI：请先安装 GitHub CLI',
	'auth.unauthenticated': 'gh 未登录：请先执行 gh auth login',
	'auth.error': '读取 GitHub 列表失败，请检查网络或权限',
	'auth.partial': '部分列表不可用：{message}',
	'error.unknown': '未知错误',
};

export const en = {
	'sidebar.title': 'Issues & PRs',
	'sidebar.description': "Browse this repository's issues and pull requests; picking one inserts it into the current draft as a reference.",
	'guide.title': 'Issues & PRs',
	'guide.description': "Browse and reference this repository's issues and pull requests",
	'config.title': 'Issues & PRs',
	'config.description': 'GitHub references have two independent entry points: the icon in the composer and the right-sidebar page. Changes apply immediately, no reload needed.',
	'config.composer': 'GitHub icon in the composer',
	'config.composerDescription': 'Show the GitHub icon in the composer tool row for adding issue / PR references',
	'config.sidebar': 'Right-sidebar “Issues & PRs” page',
	'config.sidebarDescription': 'Add an issue/PR browser page beside Changes in the right sidebar',
	'filter.label': 'Filter issues and pull requests',
	'filter.placeholder': 'Filter by number or title',
	'refresh': 'Refresh',
	'refreshing': 'Refreshing…',
	'loading': 'Loading…',
	'kind.issue': 'Issue',
	'kind.pr': 'PR',
	'kind.unknown': 'Item',
	'count': '{n} items',
	'attached': 'Reference added: {label}',
	'attachFailed': 'Could not add the reference: {reason}',
	'attachUnavailable': 'The composer of this session is not writable',
	'list.empty': 'This repository has no open issues or pull requests',
	'list.noResults': 'No matching issues or pull requests',
	'auth.no_remote': 'This repository has no usable GitHub remote',
	'auth.cli_missing': 'gh CLI not found — install GitHub CLI first',
	'auth.unauthenticated': 'gh is not logged in — run gh auth login first',
	'auth.error': 'Could not read the GitHub list; check network or permissions',
	'auth.partial': 'Part of the list is unavailable: {message}',
	'error.unknown': 'Unknown error',
};

export default { zh, en };
