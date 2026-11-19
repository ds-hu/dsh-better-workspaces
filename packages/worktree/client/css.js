/**
 * Styles owned by the `bw-worktree` bundle: the composer hero control and the
 * worktree creation form (inline in the hero row and boxed on the sidebar
 * page). The page's own `dsh-bw-sbw-*` chrome ships with the new surface and is
 * mounted separately on that page's CSS tag.
 */

export const WORKTREE_CSS = `
/* ---- hero control ---- */
.dsh-bw-hero { display: inline-flex; align-items: center; gap: 2px; row-gap: 4px; min-width: 0; max-width: 100%; flex-wrap: wrap; position: relative; }
.dsh-bw-hero-btn { max-width: 240px; min-width: 0; min-height: 28px; color: var(--dsh-bw-primary-label); cursor: pointer; background: 0 0; border: none; border-radius: 16px; align-items: center; gap: 4px; padding: 0 8px; font-size: 13px; font-weight: 500; line-height: 20px; display: inline-flex; }
.dsh-bw-hero-btn:hover:not(:disabled), .dsh-bw-hero-btn[aria-expanded="true"] { background: var(--dsh-bw-hover); }
.dsh-bw-hero-btn:disabled { cursor: default; opacity: .6; }
.dsh-bw-hero-label { text-overflow: ellipsis; white-space: nowrap; overflow: hidden; }
.dsh-bw-hero-chevron { color: var(--dsw-alias-label-caption, #999); flex: none; }
.dsh-bw-hero-error { color: var(--dsh-bw-red); font-size: 12px; line-height: 18px; max-width: 320px; min-width: 0; overflow-wrap: anywhere; padding: 0 8px; }
/* inside the wrapped hero row an error never shares a line with controls: the
 * long host messages (worktree/rollback receipts) read as one block, and the
 * row's flex items can shrink without squeezing the text to one char a line */
.dsh-bw-hero > .dsh-bw-hero-error { flex-basis: 100%; max-width: none; }
.dsh-bw-hero-panel-row { display: flex; align-items: center; gap: 6px; padding: 8px 10px; }
.dsh-bw-hero-input { border: .5px solid var(--dsw-alias-border-l4, rgba(128,128,128,.4)); background: 0 0; color: var(--dsh-bw-primary-label); border-radius: 6px; outline: none; padding: 2px 8px; font-size: 12px; line-height: 20px; min-width: 140px; }

/* ---- worktree create form ---- */
.dsh-bw-form { display: flex; flex-direction: column; gap: 8px; padding: 8px 10px; min-width: 260px; }
.dsh-bw-form label { font-size: 12px; color: var(--dsh-bw-secondary); display: flex; flex-direction: column; gap: 3px; }
.dsh-bw-form input[type="text"], .dsh-bw-form textarea { border: 1px solid var(--dsh-bw-border); background: 0 0; color: var(--dsh-bw-primary-label); border-radius: 6px; outline: none; padding: 4px 8px; font-size: 12px; font-family: inherit; }
.dsh-bw-form textarea { min-height: 80px; resize: vertical; }
.dsh-bw-form-actions { display: flex; gap: 6px; justify-content: flex-end; align-items: center; }
/* the hero variant reuses the row layout: no extra box, padding or column */
.dsh-bw-form-inline { display: contents; }
.dsh-bw-form-page { padding: 0; min-width: 0; }
.dsh-bw-form-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.dsh-bw-form-title { font-size: 13px; font-weight: 600; }
.dsh-bw-form-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 4px 0; }
.dsh-bw-form-page .dsh-bw-hero-input { flex: 1; min-width: 0; }
`;
