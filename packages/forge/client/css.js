/**
 * Styles owned by the `bw-forge` bundle: the composer GitHub control, the
 * reference picker dialog and the row chips. Shared chrome lives in `BASE_CSS`;
 * the 右侧栏 page ships its own `dsh-bw-sbf-*` stylesheet with the surface.
 */

export const FORGE_CSS = `
/* ---- composer forge control (issue / pull request reference) ---- */
.dsh-bw-forge { display: inline-flex; align-items: center; }
.dsh-bw-forge-btn { position: relative; width: 28px; height: 28px; flex: none; display: grid; place-items: center; border: none; border-radius: 999px; background: 0 0; color: var(--dsh-bw-primary-label); cursor: pointer; padding: 0; }
.dsh-bw-forge-btn:hover:not(:disabled) { background: var(--dsh-bw-hover); }
.dsh-bw-forge-btn:disabled { opacity: .5; cursor: default; }
.dsh-bw-forge-btn[data-armed="true"] { color: var(--dsh-bw-accent); }
.dsh-bw-forge-count { position: absolute; top: -1px; right: -1px; min-width: 13px; height: 13px; padding: 0 3px; border-radius: 7px; background: var(--dsh-bw-accent); color: #fff; font-size: 9px; font-weight: 600; line-height: 13px; text-align: center; font-variant-numeric: tabular-nums; }
/* The picker is a fixed dialog, not an anchored popover: the composer row's
   overflow would clip a panel that grows upward, and the list needs room. */
.dsh-bw-forge-overlay { position: fixed; inset: 0; z-index: 90; background: rgba(0,0,0,.28); display: flex; align-items: center; justify-content: center; padding: 24px; }
.dsh-bw-forge-dialog { width: min(560px, 100%); max-height: min(70vh, 560px); display: flex; flex-direction: column; background: var(--dsw-alias-bg-overlay, var(--dsh-bw-bg)); border: 1px solid var(--dsh-bw-border); border-radius: 12px; box-shadow: var(--dsw-elevation-prominent, 0 8px 24px rgba(0,0,0,.18)); color: var(--dsh-bw-primary-label); overflow: hidden; }
.dsh-bw-forge-head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--dsh-bw-border); flex: none; }
.dsh-bw-forge-titlebar { flex: none; font-size: 13px; font-weight: 600; }
.dsh-bw-forge-search { flex: 1; min-width: 0; border: 1px solid var(--dsh-bw-border); background: 0 0; color: var(--dsh-bw-primary-label); border-radius: 8px; outline: none; padding: 5px 10px; font-size: 13px; font-family: inherit; line-height: 20px; }
.dsh-bw-forge-search:focus { border-color: var(--dsh-bw-accent); }
.dsh-bw-forge-close { flex: none; width: 26px; height: 26px; border: none; border-radius: 8px; background: 0 0; color: var(--dsh-bw-secondary); cursor: pointer; font-size: 15px; line-height: 1; }
.dsh-bw-forge-close:hover { background: var(--dsh-bw-hover); }
.dsh-bw-forge-list { overflow-y: auto; padding: 4px; flex: 1; min-height: 0; }
.dsh-bw-forge-row { display: flex; align-items: baseline; gap: 8px; width: 100%; text-align: left; background: 0 0; border: none; border-radius: 8px; padding: 7px 9px; cursor: pointer; color: var(--dsh-bw-primary-label); font-size: 13px; line-height: 19px; }
.dsh-bw-forge-row:hover { background: var(--dsh-bw-hover); }
.dsh-bw-forge-row[data-attached="true"] { background: color-mix(in srgb, var(--dsh-bw-accent) 10%, transparent); }
button[class*="dsh-bw-"]:focus-visible, input[class*="dsh-bw-"]:focus-visible, textarea[class*="dsh-bw-"]:focus-visible { outline: 2px solid var(--dsh-bw-accent); outline-offset: 2px; }
.dsh-bw-forge-num { flex: none; font-weight: 600; font-variant-numeric: tabular-nums; }
.dsh-bw-forge-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-bw-forge-meta { flex: none; color: var(--dsh-bw-tertiary); font-size: 11px; }
.dsh-bw-forge-icon { flex: none; color: var(--dsh-bw-tertiary); }
.dsh-bw-forge-empty { padding: 24px 16px; text-align: center; color: var(--dsh-bw-tertiary); font-size: 12px; line-height: 18px; overflow-wrap: anywhere; }
.dsh-bw-forge-hint { padding: 6px 12px 10px; color: var(--dsh-bw-tertiary); font-size: 11px; line-height: 16px; flex: none; }

/* ---- right-sidebar diff tab ---- */
/* The panel is as narrow as 300px: stack the file list over the diff pane
   instead of the conversation view's side-by-side split. */
.dsh-bw-sb { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.dsh-bw-sb .dsh-bw-toolbar { padding-left: 12px; padding-right: 12px; }
.dsh-bw-sb .dsh-bw-commitrow { padding-left: 12px; padding-right: 12px; }
.dsh-bw-sb .dsh-bw-body { flex-direction: column; }
.dsh-bw-sb .dsh-bw-filelist { width: auto; max-width: none; max-height: 32%; border-right: none; border-bottom: 1px solid var(--dsh-bw-border); }
.dsh-bw-tabicon { display: inline-flex; width: 16px; height: 16px; flex: none; align-items: center; justify-content: center; }
`;
