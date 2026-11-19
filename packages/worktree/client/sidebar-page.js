/**
 * The `bw-worktree` right-sidebar page: a second, always-available door to the
 * same creation form the composer staging strip opens.
 *
 * It is registered through the shared `registerSidebarPage` helper, so it is a
 * first-class page type beside 代码变更: a `sidebar.right.pane.tab` body, a chip
 * title, a tab type the sidebar can open by `kind`, and a `guide` entry that
 * puts a capsule on the sidebar's 开始 page.
 *
 * Everything visual is scoped to `dsh-bw-sbw-*` and mounted with its own CSS
 * tag, so this page adds nothing to the conversation view's stylesheet and
 * disappears cleanly when the row (or the surface switch) is turned off.
 */
import { react, h } from '@ds-hu/dsh-bw-core/client/react.js';
import { mountCss } from '@ds-hu/dsh-bw-core/client/css.js';
import { registerSidebarPage } from '@ds-hu/dsh-bw-core/client/sidebar-page.js';
import { BranchIcon } from '@ds-hu/dsh-bw-core/client/icons.js';
import { t } from '@ds-hu/dsh-bw-core/client/i18n.js';
import { WorktreeCreateForm } from './create-form.js';

const { Fragment, useState } = react;

/** This page type's identity in the tab system (the diff page owns `.../diff`). */
export const WORKTREE_SIDEBAR_ID = 'dsh-better-workspaces/worktree';
/** Type discriminator; `sidebarRight.openTab` names it. */
export const WORKTREE_SIDEBAR_KIND = 'bw-worktree';
/** The guide entry's stable identity within the sidebar's guide list. */
export const WORKTREE_GUIDE_ID = 'worktree';
/** The page's own CSS tag (distinct from the bundle's base stylesheet). */
export const WORKTREE_SIDEBAR_CSS_ID = '@ds-hu/dsh-bw-worktree/sidebar.css';

const SIDEBAR_CSS = `
.dsh-bw-sbw { display: flex; flex-direction: column; height: 100%; min-height: 0; font-size: 13px; color: var(--dsh-bw-primary-label, var(--dsw-alias-label-primary, inherit)); background: var(--dsh-bw-bg, transparent); }
.dsh-bw-sbw-head { flex: none; display: flex; flex-direction: column; gap: 4px; padding: 14px 16px 10px; border-bottom: 1px solid var(--dsh-bw-border, var(--dsw-alias-border-l3, rgba(128,128,128,.25))); }
.dsh-bw-sbw-title { font-size: 14px; font-weight: 600; line-height: 20px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-bw-sbw-desc { font-size: 12px; line-height: 17px; color: var(--dsh-bw-tertiary, var(--dsw-alias-label-tertiary, #8b949e)); }
.dsh-bw-sbw-body { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; padding: 14px 16px 24px; }
.dsh-bw-sbw-notice { flex: none; padding: 6px 10px; border-radius: 8px; font-size: 12px; line-height: 18px; overflow-wrap: anywhere; background: color-mix(in srgb, var(--dsh-bw-green, #1a7f37) 12%, transparent); color: var(--dsh-bw-green, #1a7f37); }
.dsh-bw-sbw-notice[data-kind="error"] { background: color-mix(in srgb, var(--dsh-bw-red, #cf222e) 12%, transparent); color: var(--dsh-bw-red, #cf222e); }
.dsh-bw-sbw .dsh-bw-form { padding: 0; min-width: 0; }
.dsh-bw-sbw .dsh-bw-form input[type="text"], .dsh-bw-sbw .dsh-bw-form textarea { width: 100%; box-sizing: border-box; }
.dsh-bw-sbw-tabicon { display: inline-flex; width: 16px; height: 16px; flex: none; align-items: center; justify-content: center; }
`;

/**
 * The page's glyph: the branch motif the composer control already wears, so the
 * guide capsule and the tab chip read as the same surface.
 * @param props - rendered size and class.
 * @returns the glyph.
 */
export function WorktreeGlyph({ size, className } = {}) {
	const edge = size || 16;
	return h(BranchIcon, { width: edge, height: edge, className, style: { flex: 'none', display: 'block' } });
}

/** Pull the branch out of whatever receipt shape the form hands back. */
function createdBranch(result) {
	if (!result || typeof result !== 'object') return '';
	if (typeof result.branch === 'string' && result.branch) return result.branch;
	if (typeof result.branchName === 'string' && result.branchName) return result.branchName;
	if (typeof result.path === 'string' && result.path) {
		const parts = result.path.split(/[\\/]/).filter(Boolean);
		if (parts.length > 0) return parts[parts.length - 1];
	}
	return '';
}

function createdNotice(result) {
	const branch = createdBranch(result);
	return branch ? t('created.notice', { branch }) : t('created.unknownBranch');
}

/**
 * The page body. The official pane-tab slot injects `{ sessionId }`; the
 * sidebar itself passes `useTabInfo`, which is how a body knows whether its tab
 * is the visible one (the diff body uses it to stop work while hidden).
 */
function WorktreeSidebarBody(props) {
	const { sessionId } = props;
	const info = typeof props.useTabInfo === 'function' ? props.useTabInfo() : null;
	const visible = !info || !info.tab || info.tab.visible !== false;
	const [notice, setNotice] = useState(null);
	return h('div', { className: 'dsh-bw-sbw' },
		h('div', { className: 'dsh-bw-sbw-head' },
			h('div', { className: 'dsh-bw-sbw-title' }, t('sidebar.title')),
			h('div', { className: 'dsh-bw-sbw-desc' }, t('sidebar.description'))),
		h('div', { className: 'dsh-bw-sbw-body' },
			notice
				? h('div', {
					className: 'dsh-bw-sbw-notice',
					'data-kind': notice.kind || 'ok',
					role: notice.kind === 'error' ? 'alert' : 'status',
					'aria-live': 'polite',
				}, notice.text)
				: null,
			h(WorktreeCreateForm, {
				sessionId,
				variant: 'page',
				visible,
				onCreated: (result) => setNotice({ kind: 'ok', text: createdNotice(result) }),
				onClose: () => setNotice(null),
			})));
}

/** The page's chip: the glyph before the tab's captured title. */
function WorktreeSidebarTitle({ useTabInfo } = {}) {
	const info = typeof useTabInfo === 'function' ? useTabInfo() : null;
	return h(Fragment, null,
		h(WorktreeGlyph, { size: 16, className: 'dsh-bw-sbw-tabicon' }),
		info && info.tab ? info.tab.title : null);
}

/**
 * The page definition handed to the shared helper.
 * @returns the definition.
 */
export function worktreeSidebarDefinition() {
	return {
		id: WORKTREE_SIDEBAR_ID,
		kind: WORKTREE_SIDEBAR_KIND,
		priority: 'extension',
		title: () => t('sidebar.title'),
		guide: {
			id: WORKTREE_GUIDE_ID,
			order: 30,
			title: () => t('guide.title'),
			description: () => t('guide.description'),
			icon: WorktreeGlyph,
		},
		Body: WorktreeSidebarBody,
		Title: WorktreeSidebarTitle,
	};
}

/**
 * Register the page (tab type + body + chip title + guide entry) and its CSS.
 * @param ctx - a Cordis context with the right-sidebar services.
 * @returns a disposer releasing every registration and the stylesheet.
 */
export function registerWorktreeSidebarPage(ctx) {
	const releaseCss = mountCss(SIDEBAR_CSS, WORKTREE_SIDEBAR_CSS_ID);
	const dispose = registerSidebarPage(ctx, worktreeSidebarDefinition());
	return () => {
		try {
			if (typeof dispose === 'function') dispose();
			else if (dispose && typeof dispose.dispose === 'function') dispose.dispose();
		} finally {
			if (typeof releaseCss === 'function') releaseCss();
		}
	};
}
