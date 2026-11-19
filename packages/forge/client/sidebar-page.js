/**
 * The `bw-forge` right-sidebar page: the picker's list, promoted to a
 * full-panel browser beside 代码变更.
 *
 * It is registered through the shared `registerSidebarPage` helper, so it is a
 * first-class page type: a `sidebar.right.pane.tab` body, a chip title, a tab
 * type the sidebar can open by `kind`, and a `guide` entry beside the diff
 * page's capsule.
 *
 * The data path is the composer picker's (`useForgeItems` / `ForgeItemRow` /
 * `attachForgeReference`), so both surfaces always agree on auth states, item
 * identity and the reference chip codec. The page never closes on a pick: it
 * reports the attachment inline so the user can keep adding references.
 */
import { react, h } from '@ds-hu/dsh-bw-core/client/react.js';
import { mountCss } from '@ds-hu/dsh-bw-core/client/css.js';
import { registerSidebarPage } from '@ds-hu/dsh-bw-core/client/sidebar-page.js';
import { GithubMark } from '@ds-hu/dsh-bw-core/client/icons.js';
import { t } from '@ds-hu/dsh-bw-core/client/i18n.js';
import { fmtRelTime } from '@ds-hu/dsh-bw-core/client/util.js';
import { useForgeItems, ForgeItemRow, attachForgeReference } from './picker-parts.js';

const { Fragment, useEffect, useRef, useState } = react;

/** This page type's identity in the tab system (the diff page owns `.../diff`). */
export const FORGE_SIDEBAR_ID = 'dsh-better-workspaces/forge';
/** Type discriminator; `sidebarRight.openTab` names it. */
export const FORGE_SIDEBAR_KIND = 'bw-forge';
/** The guide entry's stable identity within the sidebar's guide list. */
export const FORGE_GUIDE_ID = 'forge';
/** The page's own CSS tag (distinct from the bundle's base stylesheet). */
export const FORGE_SIDEBAR_CSS_ID = '@ds-hu/dsh-bw-forge/sidebar.css';

/** Auth states that still leave a usable list on screen. */
const USABLE_AUTH = new Set(['authenticated', 'partial']);
/** Auth failure states the host publishes; anything else is a generic error. */
const AUTH_KEYS = new Set(['no_remote', 'cli_missing', 'unauthenticated', 'error']);

const SIDEBAR_CSS = `
.dsh-bw-sbf { display: flex; flex-direction: column; height: 100%; min-height: 0; font-size: 13px; color: var(--dsh-bw-primary-label, var(--dsw-alias-label-primary, inherit)); background: var(--dsh-bw-bg, transparent); }
.dsh-bw-sbf-head { flex: none; display: flex; flex-direction: column; gap: 8px; padding: 14px 16px 10px; border-bottom: 1px solid var(--dsh-bw-border, var(--dsw-alias-border-l3, rgba(128,128,128,.25))); }
.dsh-bw-sbf-headtext { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.dsh-bw-sbf-title { font-size: 14px; font-weight: 600; line-height: 20px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-bw-sbf-desc { font-size: 12px; line-height: 17px; color: var(--dsh-bw-tertiary, var(--dsw-alias-label-tertiary, #8b949e)); }
.dsh-bw-sbf-controls { display: flex; align-items: center; gap: 8px; min-width: 0; }
.dsh-bw-sbf-filter { flex: 1; min-width: 0; box-sizing: border-box; border: 1px solid var(--dsh-bw-border, var(--dsw-alias-border-l3, rgba(128,128,128,.25))); background: 0 0; color: var(--dsh-bw-primary-label, inherit); border-radius: 8px; outline: none; padding: 5px 10px; font-size: 13px; font-family: inherit; line-height: 20px; }
.dsh-bw-sbf-filter:focus { border-color: var(--dsh-bw-accent, var(--dsw-alias-state-business-primary, #2f6feb)); }
.dsh-bw-sbf-refresh { flex: none; }
.dsh-bw-sbf-body { flex: 1; min-height: 0; overflow-y: auto; padding: 8px 10px 24px; display: flex; flex-direction: column; gap: 2px; }
.dsh-bw-sbf-item { display: flex; flex-direction: column; gap: 0; min-width: 0; }
.dsh-bw-sbf-meta { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 0 9px 4px; }
.dsh-bw-sbf-kind { flex: none; padding: 0 6px; border: 1px solid var(--dsh-bw-border, var(--dsw-alias-border-l3, rgba(128,128,128,.25))); border-radius: 999px; color: var(--dsh-bw-secondary, var(--dsw-alias-label-secondary, #59636e)); font-size: 10px; line-height: 15px; font-weight: 500; }
.dsh-bw-sbf-kind[data-kind="change_request"] { color: var(--dsh-bw-accent, var(--dsw-alias-state-business-primary, #2f6feb)); }
.dsh-bw-sbf-time { flex: none; color: var(--dsh-bw-tertiary, var(--dsw-alias-label-tertiary, #8b949e)); font-size: 11px; line-height: 15px; font-variant-numeric: tabular-nums; }
.dsh-bw-sbf-list { display: flex; flex-direction: column; gap: 2px; }
.dsh-bw-sbf-notice { flex: none; margin: 8px 16px 0; padding: 6px 10px; border-radius: 8px; font-size: 12px; line-height: 18px; overflow-wrap: anywhere; background: color-mix(in srgb, var(--dsh-bw-green, #1a7f37) 12%, transparent); color: var(--dsh-bw-green, #1a7f37); }
.dsh-bw-sbf-notice[data-kind="error"] { background: color-mix(in srgb, var(--dsh-bw-red, #cf222e) 12%, transparent); color: var(--dsh-bw-red, #cf222e); }
.dsh-bw-sbf-empty { padding: 28px 16px; text-align: center; color: var(--dsh-bw-tertiary, var(--dsw-alias-label-tertiary, #8b949e)); font-size: 12px; line-height: 18px; overflow-wrap: anywhere; }
.dsh-bw-sbf-empty[role="alert"] { color: var(--dsh-bw-red, #cf222e); }
.dsh-bw-sbf-tabicon { display: inline-flex; width: 16px; height: 16px; flex: none; align-items: center; justify-content: center; }
`;

/**
 * The page's glyph: the GitHub mark the composer control already wears, so the
 * guide capsule and the tab chip read as the same surface.
 * @param props - rendered size and class.
 * @returns the glyph.
 */
export function ForgeGlyph({ size, className } = {}) {
	const edge = size || 16;
	return h(GithubMark, { width: edge, height: edge, className, style: { flex: 'none', display: 'block' } });
}

/** The UI language for relative times; the dictionaries come from the locale. */
function uiLang() {
	try {
		const value = typeof navigator !== 'undefined' ? navigator.language : '';
		return /^en/i.test(String(value || '')) ? 'en' : 'zh';
	} catch {
		return 'zh';
	}
}

/** One item's "last updated", from the ISO string the host publishes. */
function updatedLabel(updatedAt) {
	if (!updatedAt) return '';
	const at = typeof updatedAt === 'number' ? updatedAt : Date.parse(String(updatedAt));
	if (!Number.isFinite(at)) return '';
	return fmtRelTime(at, uiLang());
}

/** One row's readable identity for the inline attachment notice. */
function itemLabel(item) {
	if (!item) return '';
	const kind = item.kind === 'change_request' ? t('kind.pr') : t('kind.issue');
	return kind + ' #' + item.number + (item.title ? ' ' + item.title : '');
}

/** Filter is purely client-side: number substring or title substring. */
function matchesFilter(item, needle) {
	if (needle === '') return true;
	if (String(item.number).includes(needle)) return true;
	return String(item.title || '').toLowerCase().includes(needle);
}

function authMessage(authState) {
	const key = AUTH_KEYS.has(authState) ? 'auth.' + authState : 'auth.error';
	return t(key);
}

/**
 * The page body. The official pane-tab slot injects `{ sessionId }`; the
 * sidebar itself passes `useTabInfo` (the diff body uses it to learn whether
 * its tab is showing — this page only records the fact for diagnostics/attrs).
 */
function ForgeSidebarBody(props) {
	const { sessionId } = props;
	const info = typeof props.useTabInfo === 'function' ? props.useTabInfo() : null;
	const visible = !info || !info.tab || info.tab.visible !== false;
	const { items, authState, loading, error, reload } = useForgeItems({ sessionId });
	const [query, setQuery] = useState('');
	const [pendingKey, setPendingKey] = useState(null);
	const [notice, setNotice] = useState(null);
	const alive = useRef(true);
	useEffect(() => () => { alive.current = false; }, []);

	const list = Array.isArray(items) ? items : [];
	const needle = query.trim().toLowerCase();
	const filtered = list.filter((item) => matchesFilter(item, needle));
	const authOk = !authState || USABLE_AUTH.has(authState);
	const partialMessage = authState === 'partial' ? error || t('auth.partial', { message: '' }) : null;
	const shownError = authOk && !partialMessage ? error : null;

	async function pick(item) {
		if (pendingKey !== null) return;
		const key = String(item.kind) + ':' + String(item.number);
		setPendingKey(key);
		let landed;
		try {
			landed = (await attachForgeReference(sessionId, item)) === true;
		} catch {
			landed = false;
		}
		if (!alive.current) return;
		setPendingKey(null);
		setNotice(landed
			? { kind: 'ok', text: t('attached', { label: itemLabel(item) }) }
			: { kind: 'error', text: t('attachFailed', { reason: t('attachUnavailable') }) });
	}

	function refresh() {
		if (typeof reload !== 'function') return;
		try {
			const result = reload();
			if (result && typeof result.catch === 'function') result.catch(() => {});
		} catch { /* a failed refresh is already reported through error */ }
	}

	let connector;
	if (loading && list.length === 0) {
		connector = h('div', { className: 'dsh-bw-sbf-empty', role: 'status', 'aria-live': 'polite' }, t('loading'));
	} else if (!authOk) {
		connector = h('div', { className: 'dsh-bw-sbf-empty', role: 'alert' }, authMessage(authState));
	} else if (error && list.length === 0) {
		connector = h('div', { className: 'dsh-bw-sbf-empty', role: 'alert' }, t('auth.error'));
	} else if (list.length === 0) {
		connector = h('div', { className: 'dsh-bw-sbf-empty', role: 'status', 'aria-live': 'polite' }, t('list.empty'));
	} else if (filtered.length === 0) {
		connector = h('div', { className: 'dsh-bw-sbf-empty', role: 'status', 'aria-live': 'polite' }, t('list.noResults'));
	} else {
		connector = h('div', { className: 'dsh-bw-sbf-list', role: 'list' },
			filtered.map((item) => h('div', {
				key: String(item.kind) + ':' + String(item.number),
				className: 'dsh-bw-sbf-item',
				role: 'listitem',
			},
				h(ForgeItemRow, { item, onPick: pick }),
				h('div', { className: 'dsh-bw-sbf-meta' },
					h('span', {
						className: 'dsh-bw-sbf-kind',
						'data-kind': item.kind === 'change_request' ? 'change_request' : 'issue',
					}, item.kind === 'change_request' ? t('kind.pr') : t('kind.issue')),
					updatedLabel(item.updatedAt)
						? h('span', { className: 'dsh-bw-sbf-time' }, updatedLabel(item.updatedAt))
						: null))));
	}

	return h('div', { className: 'dsh-bw-sbf', 'data-visible': visible ? 'true' : 'false' },
		h('div', { className: 'dsh-bw-sbf-head' },
			h('div', { className: 'dsh-bw-sbf-headtext' },
				h('div', { className: 'dsh-bw-sbf-title' }, t('sidebar.title')),
				h('div', { className: 'dsh-bw-sbf-desc' }, t('sidebar.description'))),
			h('div', { className: 'dsh-bw-sbf-controls' },
				h('input', {
					className: 'dsh-bw-sbf-filter',
					type: 'search',
					value: query,
					placeholder: t('filter.placeholder'),
					'aria-label': t('filter.label'),
					onChange: (event) => setQuery(event.target.value),
				}),
				h('button', {
					type: 'button',
					className: 'dsh-bw-btn dsh-bw-sbf-refresh',
					onClick: refresh,
					disabled: Boolean(loading),
					'aria-label': t('refresh'),
					title: t('refresh'),
				}, loading ? t('refreshing') : t('refresh')))),
		notice
			? h('div', {
				className: 'dsh-bw-sbf-notice',
				'data-kind': notice.kind,
				role: notice.kind === 'error' ? 'alert' : 'status',
				'aria-live': 'polite',
			}, notice.text)
			: null,
		partialMessage
			? h('div', { className: 'dsh-bw-sbf-notice', 'data-kind': 'error', role: 'status', 'aria-live': 'polite' },
				t('auth.partial', { message: partialMessage }))
			: null,
		shownError ? h('div', { className: 'dsh-bw-sbf-notice', 'data-kind': 'error', role: 'alert' }, t('auth.error')) : null,
		h('div', { className: 'dsh-bw-sbf-body' }, connector));
}

/** The page's chip: the glyph before the tab's captured title. */
function ForgeSidebarTitle({ useTabInfo } = {}) {
	const info = typeof useTabInfo === 'function' ? useTabInfo() : null;
	return h(Fragment, null,
		h(ForgeGlyph, { size: 16, className: 'dsh-bw-sbf-tabicon' }),
		info && info.tab ? info.tab.title : null);
}

/**
 * The page definition handed to the shared helper.
 * @returns the definition.
 */
export function forgeSidebarDefinition() {
	return {
		id: FORGE_SIDEBAR_ID,
		kind: FORGE_SIDEBAR_KIND,
		priority: 'extension',
		title: () => t('sidebar.title'),
		guide: {
			id: FORGE_GUIDE_ID,
			order: 40,
			title: () => t('guide.title'),
			description: () => t('guide.description'),
			icon: ForgeGlyph,
		},
		Body: ForgeSidebarBody,
		Title: ForgeSidebarTitle,
	};
}

/**
 * Register the page (tab type + body + chip title + guide entry) and its CSS.
 * @param ctx - a Cordis context with the right-sidebar services.
 * @returns a disposer releasing every registration and the stylesheet.
 */
export function registerForgeSidebarPage(ctx) {
	const releaseCss = mountCss(SIDEBAR_CSS, FORGE_SIDEBAR_CSS_ID);
	const dispose = registerSidebarPage(ctx, forgeSidebarDefinition());
	return () => {
		try {
			if (typeof dispose === 'function') dispose();
			else if (dispose && typeof dispose.dispose === 'function') dispose.dispose();
		} finally {
			if (typeof releaseCss === 'function') releaseCss();
		}
	};
}
