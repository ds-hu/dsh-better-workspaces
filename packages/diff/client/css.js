/**
 * Styles owned by the `bw-diff` bundle: the diff view, its file list and
 * commit list, the CAS file editor, the status letters and the right-sidebar
 * page layout. Shared chrome lives in `BASE_CSS`.
 */

export const DIFF_CSS = `
/* ---- PR / branch toolbar bits ---- */
.dsh-bw-pr { display: inline-flex; align-items: center; gap: 6px; min-width: 0; max-width: 420px; font-size: 12px; }
.dsh-bw-pr-num { flex: none; font-weight: 600; font-variant-numeric: tabular-nums; }
.dsh-bw-pr-title { color: var(--dsh-bw-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.dsh-bw-pr a { color: var(--dsh-bw-accent); text-decoration: none; flex: none; }
.dsh-bw-branch { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--dsh-bw-secondary); min-width: 0; }
.dsh-bw-branch-name { font-family: var(--dsh-bw-code); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 220px; }
.dsh-bw-sync { font-size: 12px; color: var(--dsh-bw-tertiary); font-variant-numeric: tabular-nums; flex: none; }

/* ---- diff body split ---- */
.dsh-bw-body { flex: 1; min-height: 0; display: flex; }
.dsh-bw-filelist { width: 320px; max-width: 40%; flex: none; border-right: 1px solid var(--dsh-bw-border); overflow-y: auto; }
.dsh-bw-fileitem { width: 100%; border: 0; background: transparent; color: inherit; text-align: left; padding: 4px 10px; cursor: pointer; display: flex; gap: 6px; align-items: baseline; font: inherit; font-size: 12px; }
.dsh-bw-fileitem:hover { background: var(--dsh-bw-hover); }
.dsh-bw-fileitem-active { background: var(--dsh-bw-hover); }
.dsh-bw-fileitem-path { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-bw-fileitem-stat { flex: none; font-variant-numeric: tabular-nums; font-size: 11px; }

/* ---- file editor ---- */
.dsh-bw-editor { display: flex; flex-direction: column; flex: 1; min-height: 0; min-width: 0; }
.dsh-bw-editor-bar { display: flex; gap: 8px; align-items: center; padding: 6px 10px; border-bottom: 1px solid var(--dsh-bw-border); flex: none; }
.dsh-bw-editor-path { font-size: 12px; color: var(--dsh-bw-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.dsh-bw-editor-dirty { color: var(--dsh-bw-accent); font-size: 11px; flex: none; }
.dsh-bw-editor-area { flex: 1; min-height: 0; resize: none; border: none; outline: none; padding: 10px 12px; font-family: var(--dsh-bw-code); font-size: 12px; line-height: 1.55; color: var(--dsh-bw-primary-label); background: var(--dsh-bw-bg); tab-size: 4; white-space: pre; overflow: auto; }
.dsh-bw-fileedit { flex: none; margin-left: 8px; }
.dsh-bw-statusletter { flex: none; width: 14px; text-align: center; font-family: var(--dsh-bw-code); font-weight: 600; }

/* ---- diff pane ---- */
.dsh-bw-diffpane { flex: 1; min-width: 0; overflow: auto; }
.dsh-bw-file { border-bottom: 1px solid var(--dsh-bw-border); }
.dsh-bw-filehead { position: sticky; top: 0; z-index: 2; display: flex; align-items: center; background: var(--dsh-bw-bg); border-bottom: 1px solid var(--dsh-bw-border); font-size: 12px; }
.dsh-bw-filetoggle { min-width: 0; flex: 1; display: flex; align-items: center; gap: 8px; border: 0; padding: 6px 12px; background: transparent; color: inherit; text-align: left; font: inherit; cursor: pointer; }
.dsh-bw-filetoggle:hover { background: var(--dsh-bw-hover); }
.dsh-bw-caret { flex: none; color: var(--dsh-bw-tertiary); width: 12px; }
.dsh-bw-filepath { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--dsh-bw-code); font-weight: 500; }
.dsh-bw-filestat { flex: none; font-variant-numeric: tabular-nums; }
.dsh-bw-notice { padding: 12px; color: var(--dsh-bw-tertiary); font-size: 12px; }
.dsh-bw-hunkhdr { padding: 2px 12px 2px 100px; background: color-mix(in srgb, var(--dsh-bw-accent) 6%, transparent); color: var(--dsh-bw-tertiary); font-family: var(--dsh-bw-code); font-size: 11px; line-height: 18px; white-space: pre; overflow: hidden; }
.dsh-bw-line { display: flex; font-family: var(--dsh-bw-code); font-size: 12px; line-height: 18px; }
.dsh-bw-ln { flex: none; width: 44px; text-align: right; padding-right: 8px; color: var(--dsw-alias-label-caption, #999); user-select: none; font-size: 11px; line-height: 18px; }
.dsh-bw-code { flex: 1; min-width: 0; white-space: pre; padding-right: 12px; }
.dsh-bw-wrap .dsh-bw-code { white-space: pre-wrap; overflow-wrap: anywhere; }
.dsh-bw-line-add { background: color-mix(in srgb, var(--dsh-bw-green) 13%, transparent); }
.dsh-bw-line-del { background: color-mix(in srgb, var(--dsh-bw-red) 13%, transparent); }
.dsh-bw-line-meta { color: var(--dsh-bw-tertiary); font-style: italic; }

/* ---- commit list / commit row ---- */
.dsh-bw-commitrow { display: flex; gap: 8px; padding: 8px 16px; border-bottom: 1px solid var(--dsh-bw-border); align-items: center; flex: none; }
.dsh-bw-commit-input { flex: 1; min-width: 0; border: 1px solid var(--dsh-bw-border); background: 0 0; color: var(--dsh-bw-primary-label); border-radius: 8px; outline: none; padding: 4px 10px; font-size: 12px; line-height: 18px; }
.dsh-bw-commit-input:focus { border-color: var(--dsh-bw-accent); }
.dsh-bw-commits { overflow-y: auto; border-bottom: 1px solid var(--dsh-bw-border); max-height: 220px; flex: none; }
.dsh-bw-commit { width: 100%; border: 0; background: transparent; color: inherit; text-align: left; padding: 5px 12px; cursor: pointer; display: flex; gap: 8px; align-items: baseline; font: inherit; font-size: 12px; }
.dsh-bw-commit:hover { background: var(--dsh-bw-hover); }
.dsh-bw-commit-active { background: var(--dsh-bw-hover); }
.dsh-bw-sha { font-family: var(--dsh-bw-code); color: var(--dsh-bw-accent); flex: none; }
.dsh-bw-commit-subject { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-bw-commit-meta { flex: none; color: var(--dsh-bw-tertiary); font-size: 11px; }
.dsh-bw-unpushed-dot { flex: none; color: var(--dsh-bw-green); font-size: 11px; }

/* ---- right-sidebar diff page ---- */
/* The panel is as narrow as 300px: stack the file list over the diff pane
   instead of the conversation view's side-by-side split. */
.dsh-bw-sb { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.dsh-bw-sb .dsh-bw-toolbar { padding-left: 12px; padding-right: 12px; }
.dsh-bw-sb .dsh-bw-commitrow { padding-left: 12px; padding-right: 12px; }
.dsh-bw-sb .dsh-bw-body { flex-direction: column; }
.dsh-bw-sb .dsh-bw-filelist { width: auto; max-width: none; max-height: 32%; border-right: none; border-bottom: 1px solid var(--dsh-bw-border); }
`;
