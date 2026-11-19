/**
 * Styles owned by the `bw-status` bundle: the Workspace-row badge line, its
 * stretch rule and the composer diff pill. Shared chrome lives in `BASE_CSS`
 * (`@ds-hu/dsh-bw-core/client/css.js`).
 */

export const STATUS_CSS = `
/* ---- sidebar workspace rows: stretch + badge line ---- */
/* One badge line per Workspace, under its title. The state is a fact about the
 * checkout, so it belongs to the row that owns the checkout. The line lives
 * inside the shipped title column (_projectText, a flex column), so it stacks
 * under the title by itself. The row only has to stop pinning its height. */
[class*="_projectRow"] { height: auto !important; min-height: 34px; }
.dsh-bw-badges { min-width: 0; display: flex; align-items: center; gap: 6px; padding: 0 0 2px; font-size: 11px; line-height: 16px; color: var(--dsh-bw-tertiary); pointer-events: none; overflow: hidden; }
/* A non-git Workspace (or one whose snapshot has not arrived yet) renders
 * nothing, and the wrapper must not contribute a gap or padding of its own:
 * the row stays the shell's 34 px until there is a line to show. */
.dsh-bw-badges:empty { display: none; }
.dsh-bw-badge-branch { max-width: 45%; overflow: hidden; text-overflow: ellipsis; }
.dsh-bw-badge-diff { font-variant-numeric: tabular-nums; }

/* ---- dock pill ---- */
.dsh-bw-pill { display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 10px; margin: 2px 0; border-radius: 12px; border: 1px solid var(--dsh-bw-border); background: 0 0; color: var(--dsh-bw-secondary); cursor: pointer; font-size: 12px; line-height: 1; font-variant-numeric: tabular-nums; align-self: flex-start; flex: 0 0 auto; width: fit-content; max-width: 100%; white-space: nowrap; margin-left: max(var(--dsh-composer-side-clearance, 16px), calc((100% - var(--dsh-composer-card-max-width, 920px)) / 2)); }
.dsh-bw-pill > span:last-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.dsh-bw-pill:hover { background: var(--dsh-bw-hover); color: var(--dsh-bw-primary-label); }
.dsh-bw-pill-icon { color: var(--dsh-bw-tertiary); }

/* ---- managed-worktree icon in a workspace row ---- */
[data-bw-wt] > svg { display: none; }
.dsh-bw-wt-icon { display: inline-flex; width: 16px; height: 16px; align-items: center; justify-content: center; }
.dsh-bw-wt-icon svg { width: 15px; height: 15px; }
`;
