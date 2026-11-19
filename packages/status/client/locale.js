/**
 * The `bw-status` dictionary: the strings this feature bundle owns.
 *
 * Keys borrowed from another feature are duplicated here on purpose: a
 * feature bundle is self-contained at runtime (it registers exactly one
 * locale namespace), and the sentence is read by a component in this bundle.
 */
export const zh = {
	"pill.title": "在右侧栏查看代码变更",
	"pill.dirty": "{n} 个文件有改动",
	"view.diff": "diff",
	"diff.unpushed": "未推送",
};

export const en = {
	"pill.title": "View changes in the sidebar",
	"pill.dirty": "{n} files changed",
	"view.diff": "diff",
	"diff.unpushed": "unpushed",
};
