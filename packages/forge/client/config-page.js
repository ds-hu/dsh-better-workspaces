/**
 * The `bw-forge` row's native config page (plugin panel → Issue 与 PR).
 *
 * Two module-level sub-surfaces are switched here, each persisted in
 * `surfacePrefs`; flipping one makes the bundle entry unregister/register
 * exactly that surface, so the page never needs a reload. The row's Loader
 * switch stays the outer on/off; this page only hides surfaces *inside* it.
 *
 * The visual language is deliberately the one the other row config pages in
 * this profile use (title + description, plain rows, a switch on the right,
 * `--dsw-alias-*` theme tokens), not the plugin's own `.dsh-bw-*` chrome.
 */
import { react, h } from '@ds-hu/dsh-bw-core/client/react.js';
import { t } from '@ds-hu/dsh-bw-core/client/i18n.js';
import { surfacePrefs } from './prefs.js';

const { useEffect, useState } = react;

/** Row labels/descriptions live in the locale dictionary, not in the layout. */
const PREF_KEYS = ['composer', 'sidebar'];
const PREF_LABEL = { composer: 'config.composer', sidebar: 'config.sidebar' };
const PREF_DESCRIPTION = { composer: 'config.composerDescription', sidebar: 'config.sidebarDescription' };

const pageStyle = {
	padding: '16px 20px 40px',
	maxWidth: 640,
	display: 'flex',
	flexDirection: 'column',
	gap: 20,
	color: 'var(--dsw-alias-label-primary)',
	fontFamily: 'inherit',
};
const headStyle = { display: 'flex', flexDirection: 'column', gap: 6 };
const titleStyle = { margin: 0, fontSize: 18, fontWeight: 600, lineHeight: 1.35 };
const descriptionStyle = {
	margin: 0,
	fontSize: 13,
	lineHeight: 1.5,
	color: 'var(--dsw-alias-label-tertiary)',
};
const sectionStyle = { display: 'flex', flexDirection: 'column', gap: 10 };
const rowStyle = {
	display: 'flex',
	alignItems: 'center',
	justifyContent: 'space-between',
	gap: 16,
	padding: '10px 14px',
	background: 'var(--dsw-alias-bg-layer-1, transparent)',
	border: '0.5px solid var(--dsw-alias-border-l2, rgba(128,128,128,.25))',
	borderRadius: 10,
};
const rowTextStyle = { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 };
const rowLabelStyle = { fontSize: 14, fontWeight: 500, lineHeight: 1.4 };
const rowDescriptionStyle = {
	fontSize: 12,
	lineHeight: 1.45,
	color: 'var(--dsw-alias-label-tertiary)',
};

function switchStyle(on) {
	return {
		flex: 'none',
		position: 'relative',
		width: 36,
		height: 20,
		padding: 0,
		border: 'none',
		borderRadius: 10,
		cursor: 'pointer',
		background: on
			? 'var(--dsw-alias-state-business-primary, #2f6feb)'
			: 'var(--dsw-alias-border-l4, rgba(128,128,128,.4))',
		transition: 'background .12s ease',
	};
}

function knobStyle(on) {
	return {
		position: 'absolute',
		top: 2,
		left: on ? 18 : 2,
		width: 16,
		height: 16,
		borderRadius: '50%',
		background: '#fff',
		boxShadow: '0 1px 2px rgba(0,0,0,.25)',
		transition: 'left .12s ease',
	};
}

/**
 * One native-looking switch row. The switch itself is a real button with
 * `role="switch"`, so it is focusable and operable from the keyboard; the
 * label/description pair is the row's readable text.
 */
function SwitchRow({ label, description, checked, onToggle }) {
	return h('div', { style: rowStyle },
		h('span', { style: rowTextStyle },
			h('span', { style: rowLabelStyle }, label),
			h('span', { style: rowDescriptionStyle }, description)),
		h('button', {
			type: 'button',
			role: 'switch',
			'aria-checked': checked ? 'true' : 'false',
			'aria-label': label,
			'data-bw-pref-switch': '',
			style: switchStyle(checked),
			onClick: onToggle,
		}, h('span', { style: knobStyle(checked), 'aria-hidden': 'true' })));
}

/**
 * Bind the page to the pref store. A local mirror keeps React's render pure;
 * `subscribe` is what makes a change from anywhere else (another tab, the
 * store's own toggle helper) repaint these switches, and `set` is what makes
 * this page's click reach the entry that re-registers surfaces.
 */
function useSurfacePrefs(names) {
	const read = () => names.map((name) => Boolean(surfacePrefs.get(name)));
	const [values, setValues] = useState(read);
	useEffect(() => {
		let disposed = false;
		const sync = () => { if (!disposed) setValues(read()); };
		sync();
		const release = typeof surfacePrefs.subscribe === 'function' ? surfacePrefs.subscribe(sync) : null;
		return () => {
			disposed = true;
			if (typeof release === 'function') release();
		};
		// The store is a module singleton; names never change for this page.
	}, []);
	const toggle = (index) => {
		const name = names[index];
		surfacePrefs.set(name, !surfacePrefs.get(name));
	};
	return [values, toggle];
}

export function ForgeConfigPage() {
	const [values, toggle] = useSurfacePrefs(PREF_KEYS);
	return h('div', { style: pageStyle },
		h('div', { style: headStyle },
			h('h3', { style: titleStyle }, t('config.title')),
			h('p', { style: descriptionStyle }, t('config.description'))),
		h('div', { style: sectionStyle },
			PREF_KEYS.map((name, index) => h(SwitchRow, {
				key: name,
				label: t(PREF_LABEL[name]),
				description: t(PREF_DESCRIPTION[name]),
				checked: values[index],
				onToggle: () => toggle(index),
			}))));
}

/** Register the row's native config page. Returns the Cordis disposer. */
export function registerForgeConfigPage(ctx) {
	return ctx.slots.inject('plugins.row.config', () => ctx.slots.register({
		name: 'plugins.row.config',
		key: '@ds-hu/dsh-better-workspaces#bw-forge',
		locale: 'bw-forge',
	}, ForgeConfigPage));
}
