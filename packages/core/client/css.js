/**
 * Shared stylesheet + the per-bundle CSS mount.
 *
 * 0.4.0 gives every feature bundle its own `<style data-plugin-css="<package
 * name>/client.css">` tag. `BASE_CSS` below holds only the rules at least two
 * bundles need (theme variables, modifiers, popover/menu, form and button
 * chrome, focus ring, tab glyph); feature-specific rules live in each
 * `packages/<feature>/client/css.js`.
 */

export const BASE_CSS = `
body { --dsh-bw-green: var(--dsw-alias-state-success-primary, #1a7f37); --dsh-bw-red: var(--dsw-alias-state-error-primary, #cf222e); --dsh-bw-yellow: var(--dsw-alias-state-warn-primary, #9a6700); --dsh-bw-purple: #7347af; --dsh-bw-border: var(--dsw-alias-border-l3, rgba(128,128,128,.25)); --dsh-bw-hover: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.12)); --dsh-bw-tertiary: var(--dsw-alias-label-tertiary, #8b949e); --dsh-bw-secondary: var(--dsw-alias-label-secondary, #59636e); --dsh-bw-primary-label: var(--dsw-alias-label-primary, #1f2328); --dsh-bw-accent: var(--dsw-alias-state-business-primary, #2f6feb); --dsh-bw-bg: var(--dsw-alias-bg-base, #fff); --dsh-bw-code: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace); }
body[data-ds-dark-theme] { --dsh-bw-purple: #c9a4f0; }
.dsh-bw-green { color: var(--dsh-bw-green); }
.dsh-bw-red { color: var(--dsh-bw-red); }
.dsh-bw-yellow { color: var(--dsh-bw-yellow); }
.dsh-bw-purple { color: var(--dsh-bw-purple); }

/* ---- shared inline badges ---- */
.dsh-bw-badge { display: inline-flex; align-items: center; gap: 3px; min-width: 0; white-space: nowrap; }
.dsh-bw-ring { flex: none; }

/* ---- popover ---- */
.dsh-bw-pop { position: relative; display: inline-flex; }
.dsh-bw-pop-panel { position: absolute; top: calc(100% + 4px); left: 0; z-index: 60; min-width: 180px; max-width: 340px; background: var(--dsw-alias-bg-overlay, var(--dsh-bw-bg)); border: 1px solid var(--dsh-bw-border); border-radius: 10px; box-shadow: var(--dsw-elevation-prominent, 0 8px 24px rgba(0,0,0,.18)); padding: 4px; color: var(--dsh-bw-primary-label); font-size: 12px; }
.dsh-bw-pop-right { left: auto; right: 0; }
.dsh-bw-menu { display: flex; flex-direction: column; max-height: 320px; overflow-y: auto; }
.dsh-bw-menu-item { display: flex; align-items: baseline; gap: 6px; width: 100%; text-align: left; background: 0 0; border: none; border-radius: 6px; padding: 5px 8px; cursor: pointer; color: var(--dsh-bw-primary-label); font-size: 12px; line-height: 18px; }
.dsh-bw-menu-item:hover:not(:disabled) { background: var(--dsh-bw-hover); }
.dsh-bw-menu-item:disabled { cursor: default; opacity: .55; }
.dsh-bw-menu-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-bw-menu-hint { flex: none; color: var(--dsh-bw-tertiary); font-size: 11px; }
.dsh-bw-menu-reason { flex: none; color: var(--dsh-bw-tertiary); font-size: 11px; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-bw-menu-sep { height: 1px; background: var(--dsh-bw-border); margin: 4px 6px; }
.dsh-bw-menu-item-active .dsh-bw-menu-label { color: var(--dsh-bw-accent); font-weight: 500; }

/* ---- shared view chrome ---- */
.dsh-bw-view { display: flex; flex-direction: column; flex: 1; min-height: 0; height: 100%; overflow: hidden; font-size: 13px; color: var(--dsh-bw-primary-label); background: var(--dsh-bw-bg); }
.dsh-bw-toolbar { display: flex; align-items: center; gap: 8px; padding: 8px 16px; border-bottom: 1px solid var(--dsh-bw-border); flex-wrap: wrap; flex: none; }
.dsh-bw-toolbar-spacer { flex: 1; }
.dsh-bw-seg { display: inline-flex; border: 1px solid var(--dsh-bw-border); border-radius: 8px; overflow: hidden; }
.dsh-bw-seg button { background: 0 0; border: none; padding: 3px 10px; font-size: 12px; cursor: pointer; color: var(--dsh-bw-secondary); }
.dsh-bw-seg button[aria-pressed="true"] { background: var(--dsh-bw-hover); color: var(--dsh-bw-primary-label); font-weight: 500; }
.dsh-bw-btn { height: 26px; padding: 0 12px; border-radius: 13px; border: 1px solid var(--dsh-bw-border); background: 0 0; cursor: pointer; font-size: 12px; color: var(--dsh-bw-primary-label); display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
.dsh-bw-btn:hover:not(:disabled) { background: var(--dsh-bw-hover); }
.dsh-bw-btn:disabled { opacity: .45; cursor: default; }
.dsh-bw-btn-primary { background: var(--dsh-bw-accent); border-color: transparent; color: #fff; }
.dsh-bw-btn-primary:hover:not(:disabled) { background: var(--dsh-bw-accent); filter: brightness(1.08); }
.dsh-bw-btn-danger { color: var(--dsh-bw-red); }
.dsh-bw-check { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--dsh-bw-secondary); cursor: pointer; user-select: none; }
.dsh-bw-banner { margin: 8px 16px 0; padding: 6px 10px; font-size: 12px; border-radius: 8px; flex: none; overflow-wrap: anywhere; }
.dsh-bw-banner-ok { background: color-mix(in srgb, var(--dsh-bw-green) 12%, transparent); color: var(--dsh-bw-green); }
.dsh-bw-banner-err { background: color-mix(in srgb, var(--dsh-bw-red) 12%, transparent); color: var(--dsh-bw-red); }
.dsh-bw-form { display: flex; flex-direction: column; gap: 8px; padding: 8px 10px; min-width: 260px; }
.dsh-bw-form label { font-size: 12px; color: var(--dsh-bw-secondary); display: flex; flex-direction: column; gap: 3px; }
.dsh-bw-form input[type="text"], .dsh-bw-form textarea { border: 1px solid var(--dsh-bw-border); background: 0 0; color: var(--dsh-bw-primary-label); border-radius: 6px; outline: none; padding: 4px 8px; font-size: 12px; font-family: inherit; }
.dsh-bw-form textarea { min-height: 80px; resize: vertical; }
.dsh-bw-form-actions { display: flex; gap: 6px; justify-content: flex-end; align-items: center; }
.dsh-bw-empty { padding: 32px; text-align: center; color: var(--dsh-bw-tertiary); font-size: 13px; }
.dsh-bw-tabicon { display: inline-flex; width: 16px; height: 16px; flex: none; align-items: center; justify-content: center; }
button[class*="dsh-bw-"]:focus-visible, input[class*="dsh-bw-"]:focus-visible, textarea[class*="dsh-bw-"]:focus-visible { outline: 2px solid var(--dsh-bw-accent); outline-offset: 2px; }
`;

/**
 * The shared stylesheet state: one entry per plugin CSS id, keyed on a global
 * symbol so overlapping materializations of the same bundle share the tag.
 */
const CSS_STATE = Symbol.for('dsh-bw:client-css-state');

function cssState() {
  if (typeof window === 'undefined') return null;
  if (!window[CSS_STATE] || typeof window[CSS_STATE] !== 'object') window[CSS_STATE] = Object.create(null);
  return window[CSS_STATE];
}

/**
 * Mount (or adopt) one plugin stylesheet.
 *
 * Idempotent release: the tag survives while any live materialization of the
 * same bundle still owns it. An existing tag carrying the same
 * `data-plugin-css` id — e.g. one left by an HMR overlap — is adopted and its
 * content replaced with the current text.
 *
 * @param cssText - the stylesheet text.
 * @param pluginCssId - `<package name>/client.css` (also the eviction id).
 * @returns an idempotent release function.
 */
export function mountCss(cssText, pluginCssId) {
  if (typeof document === 'undefined') return () => {};
  const id = pluginCssId || 'dsh-better-workspaces/client.css';
  const packageName = id.endsWith('/client.css') ? id.slice(0, -'/client.css'.length) : id;
  const states = cssState();
  let state = states ? states[id] : null;
  if (!state || !state.tag) {
    let tag = document.querySelector('style[data-plugin-css="' + id + '"]');
    if (!tag) {
      tag = document.createElement('style');
      tag.dataset.pluginCss = id;
      document.head.appendChild(tag);
    }
    /* DSH evicts this bundle's styles by the module id it serves, so the
       ownership marker must follow the scoped package name even when an older
       tag was adopted. */
    tag.dataset.plugin = packageName;
    tag.textContent = cssText;
    state = { tag, refs: 0 };
    if (states) states[id] = state;
  }
  state.tag.textContent = cssText;
  state.refs += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    state.refs -= 1;
    if (state.refs > 0) return;
    if (state.tag.parentNode) state.tag.parentNode.removeChild(state.tag);
    if (states && states[id] === state) delete states[id];
  };
}
