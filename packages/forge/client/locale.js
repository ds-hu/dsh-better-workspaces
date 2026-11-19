/**
 * The `bw-forge` dictionary: the strings this feature bundle owns.
 *
 * Keys borrowed from another feature are duplicated here on purpose: a
 * feature bundle is self-contained at runtime (it registers exactly one
 * locale namespace), and the sentence is read by a component in this bundle.
 */
export const zh = {
	"forge.addIssuePr": "添加 issue 或 PR",
	"forge.pickerTitle": "添加 issue 或 PR",
	"forge.searchPlaceholder": "在已取回的列表里筛选编号或标题",
	"forge.empty": "这个仓库没有未关闭的 issue 或 PR",
	"forge.noResults": "没有匹配的 issue 或 PR",
	"forge.loadFailed": "无法读取列表",
	"forge.detailFailed": "无法读取该 issue/PR 的内容",
	"forge.close": "关闭",
	"forge.fork": "fork",
	"forge.attachFailed": "无法把引用插入输入框：{reason}",
	"forge.attachFailedNoTarget": "输入框当前不可写入（正在提交或不可编辑）",
	"forge.attachFailedRejected": "引用插入坐标无效或草稿已变化，请重试",
	"forge.restorePending": "引用尚未安全恢复，请等待片刻后重试发送",
	"forge.invalid": "损坏的 Forge 引用（可删除）",
	"forge.hint": "选中即挂上引用；发送时展开为标题 / 链接 / 基线 / 正文，草稿里只留一个引用片",
	"forge.auth.cli_missing": "未找到 gh CLI：请先安装 GitHub CLI",
	"forge.auth.unauthenticated": "gh 未登录：请先执行 gh auth login",
	"forge.auth.no_remote": "该仓库没有可用的 GitHub 远端",
	"forge.auth.error": "gh 调用失败，请检查网络或权限",
	"forge.pullsFailed": "PR 列表不可用:{message}",
	"forge.issuesFailed": "Issue 列表不可用:{message}",
	"diff.loading": "加载中…",
};

export const en = {
	"forge.addIssuePr": "Add issue or PR",
	"forge.pickerTitle": "Add issue or PR",
	"forge.searchPlaceholder": "Filter the fetched page by number or title",
	"forge.empty": "No open issues or pull requests in this repository",
	"forge.noResults": "No matching issue or pull request",
	"forge.loadFailed": "Could not load the list",
	"forge.detailFailed": "Could not read that issue/pull request",
	"forge.close": "Close",
	"forge.fork": "fork",
	"forge.attachFailed": "Could not insert the reference: {reason}",
	"forge.attachFailedNoTarget": "the input is not writable right now (submitting or read-only)",
	"forge.attachFailedRejected": "the insertion span is invalid or the draft changed; please try again",
	"forge.restorePending": "a reference has not been safely restored yet; wait a moment and retry send",
	"forge.invalid": "Broken Forge reference (delete it to continue)",
	"forge.hint": "Picking attaches a reference; sending expands it to title / link / base / body — the draft keeps one chip",
	"forge.auth.cli_missing": "gh CLI not found — install GitHub CLI first",
	"forge.auth.unauthenticated": "gh is not signed in — run gh auth login",
	"forge.auth.no_remote": "This repository has no usable GitHub remote",
	"forge.auth.error": "gh call failed — check network or permissions",
	"forge.pullsFailed": "Pull request list unavailable: {message}",
	"forge.issuesFailed": "Issue list unavailable: {message}",
	"diff.loading": "Loading…",
};
