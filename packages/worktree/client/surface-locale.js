/**
 * Every string the new `bw-worktree` surfaces introduce: the right-sidebar
 * 新建 worktree page and the row's native config page.
 *
 * The bundle entry merges these dictionaries into the `bw-worktree` locale
 * namespace, so keys are shared with the composer staging strip. Keep the
 * legacy key style (`sidebar.*`, `guide.*`, `config.*`) and never put display
 * text in a component.
 */
export const zh = {
	'sidebar.title': '新建 worktree',
	'sidebar.description': '从当前分支创建一个隔离的 worktree，并在新会话里继续。',
	'guide.title': '新建 worktree',
	'guide.description': '从当前分支创建一个隔离的 worktree，并在新会话里继续',
	'config.title': '新建 worktree',
	'config.description': '新建 worktree 有两个独立入口：输入框上方的控件，以及右侧栏里的页面。改动即时生效，无需刷新页面。',
	'config.hero': '输入框上方的「新建 worktree」',
	'config.heroDescription': '在输入框工具行显示新建 worktree 控件',
	'config.sidebar': '右侧栏的「新建 worktree」页面',
	'config.sidebarDescription': '在右侧栏「代码变更」旁新增一个新建 worktree 页面',
	'created.notice': 'worktree 已创建：{branch}',
	'created.unknownBranch': 'worktree 已创建',
};

export const en = {
	'sidebar.title': 'New worktree',
	'sidebar.description': 'Cut an isolated worktree from the current branch and continue in a new session.',
	'guide.title': 'New worktree',
	'guide.description': 'Cut an isolated worktree from the current branch and continue in a new session',
	'config.title': 'New worktree',
	'config.description': 'New worktree has two independent entry points: the control above the composer and the right-sidebar page. Changes apply immediately, no reload needed.',
	'config.hero': 'New worktree above the composer',
	'config.heroDescription': 'Show the new-worktree control in the composer tool row',
	'config.sidebar': 'Right-sidebar “New worktree” page',
	'config.sidebarDescription': 'Add a new-worktree page beside Changes in the right sidebar',
	'created.notice': 'Worktree created: {branch}',
	'created.unknownBranch': 'Worktree created',
};

export default { zh, en };
