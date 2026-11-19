/**
 * The sidebar injector: one React root per Workspace row, inserted under the
 * row title, plus the managed-worktree icon pass.
 *
 * The row is identified by `data-row-key` against the workspaces store (ADR
 * 0001); an ambiguous old-shell title injects nothing rather than guessing.
 */
import { createRoot } from 'react-dom/client';
import { h } from '@ds-hu/dsh-bw-core/client/react.js';
import { apiGet } from '@ds-hu/dsh-bw-core/client/api.js';
import { getFeed } from '@ds-hu/dsh-bw-core/client/runtime.js';
import { workspaceItems } from '@ds-hu/dsh-bw-core/client/workspace.js';
import {
  SIDEBAR_WORKSPACE_ROW,
  SIDEBAR_ROW_TITLE,
  SIDEBAR_TITLE_COLUMN,
  workspaceForRow,
  applyManagedIcons,
  clearManagedIcons,
} from '@ds-hu/dsh-bw-core/client/dom.js';
import { Badges } from './badges.js';

/** Create the badge-line injector for one applied bundle. */
export function createSidebarInjector(ctx) {
  const feed = getFeed();
  const roots = new Map(); // container → react root
  let observer = null;
  let timer = null;
  let disposed = false;
  let anchorWarned = false;

  /** Unmount one injected line (row anchor gone, Workspace gone, stale identity). */
  function removeRowLine(row) {
    const rec = row && row.__dshBw;
    if (!rec) return;
    try { roots.get(rec.container)?.unmount(); } catch { /* ignore */ }
    try { if (rec.container.isConnected) rec.container.remove(); } catch { /* ignore */ }
    roots.delete(rec.container);
    row.__dshBw = undefined;
  }

  /* Managed-worktree icon (ADR 0001 Revision 1): matched by title text —
   * managed-worktree workspaces swap the folder icon for the branch icon so
   * their provenance is visible at a glance. */
  let managedTitles = null;
  let managedTitleSeq = 0;
  let managedTitleRequest = null;
  async function refreshManagedTitles() {
    const seq = ++managedTitleSeq;
    if (managedTitleRequest) managedTitleRequest.abort();
    managedTitleRequest = new AbortController();
    const signal = managedTitleRequest.signal;
    const titles = new Set();
    // source 1: live git snapshots — any tracked cwd that IS a managed worktree
    // marks its workspace row (works even on old hosts)
    try {
      const snap = feed.store.get();
      const byCwd = (snap && snap.byCwd) || {};
      for (const cwdKey of Object.keys(byCwd)) {
        const entry = byCwd[cwdKey];
        if (!entry || !entry.managed || !entry.isLinkedWorktree) continue;
        const ws = workspaceItems().find((w) => w.path === cwdKey);
        if (ws && typeof ws.title === 'string' && ws.title !== '') titles.add(ws.title);
      }
    } catch { /* store not ready yet */ }
    // source 2: host registry route (covers worktrees without sessions)
    try {
      const res = await apiGet('/worktree-workspaces', signal);
      if (res && res.ok && Array.isArray(res.items)) {
        const ids = new Set(res.items.map((i) => i && i.workspaceId).filter(Boolean));
        for (const w of workspaceItems()) {
          if (ids.has(w.workspaceId) && typeof w.title === 'string' && w.title !== '') titles.add(w.title);
        }
      }
    } catch { /* older host without the route or superseded */ }
    if (!disposed && !signal.aborted && seq === managedTitleSeq) managedTitles = titles;
  }

  function passWorkspaceIcons() {
    if (disposed || managedTitles === null) return;
    applyManagedIcons(managedTitles);
  }

  function schedule() {
    if (disposed || timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      pass();
    }, 300);
  }

  function pass() {
    if (disposed || typeof document === 'undefined') return;
    // prune detached containers
    for (const [container, root] of [...roots.entries()]) {
      if (!container.isConnected) {
        try { root.unmount(); } catch { /* gone */ }
        roots.delete(container);
      }
    }
    let rows;
    try {
      rows = document.querySelectorAll(SIDEBAR_WORKSPACE_ROW);
    } catch {
      return;
    }
    for (const row of rows) {
      const titleEl = row.querySelector(SIDEBAR_ROW_TITLE);
      const columnEl = row.querySelector(SIDEBAR_TITLE_COLUMN);
      // anchor self-check (ADR 0001): the shipped title span and the column
      // that holds it must both exist
      if (!titleEl || !columnEl) {
        if (!anchorWarned) {
          anchorWarned = true;
          console.debug('[better-workspaces] workspace row anchor changed — badges degraded');
        }
        removeRowLine(row);
        continue;
      }
      const workspace = workspaceForRow(row, titleEl);
      if (!workspace || typeof workspace.path !== 'string' || workspace.path === '') {
        // The row still exists but no longer names a checkout (ungrouped
        // bucket, deleted Workspace, ambiguous old-shell title): do not leave
        // the previous Workspace's line behind on it.
        removeRowLine(row);
        continue;
      }
      const cwd = workspace.path;
      const workspaceId = workspace.workspaceId;
      const rec = row.__dshBw;
      if (rec && rec.container.isConnected && rec.workspaceId === workspaceId && rec.cwd === cwd) {
        /* React re-renders the row around the injected node. The line belongs
         * inside the title column, last, so a re-created column re-homes the
         * node. The guard matters: re-appending an already-last node would
         * feed our own MutationObserver an endless churn of no-op mutations. */
        if (rec.container.parentElement !== columnEl || rec.container.nextElementSibling !== null) {
          columnEl.appendChild(rec.container);
        }
        continue;
      }
      if (rec && rec.container.isConnected) {
        // identity or path changed → re-render in place when same workspace,
        // rebuild otherwise
        if (rec.workspaceId === workspaceId) {
          rec.cwd = cwd;
          const root = roots.get(rec.container);
          if (root) root.render(h(Badges, { cwd }));
          continue;
        }
        removeRowLine(row);
      }
      const container = document.createElement('div');
      container.className = 'dsh-bw-badges';
      columnEl.appendChild(container);
      const root = createRoot(container);
      roots.set(container, root);
      row.__dshBw = { container, workspaceId, cwd };
      root.render(h(Badges, { cwd }));
    }
    passWorkspaceIcons();
  }

  return {
    start() {
      if (disposed) return;
      try {
        observer = new MutationObserver(schedule);
        observer.observe(document.body, { childList: true, subtree: true });
      } catch {
        observer = null;
      }
      let disposeWorkspaces = () => {};
      try {
        if (ctx.workspaces && ctx.workspaces.list && ctx.workspaces.list.subscribe) {
          disposeWorkspaces = ctx.workspaces.list.subscribe(() => {
            refreshManagedTitles().then(schedule);
          }) || (() => {});
        }
      } catch { /* no store */ }
      this._disposeWorkspaces = disposeWorkspaces;
      refreshManagedTitles().then(() => { if (!disposed) passWorkspaceIcons(); });
      pass();
      // gentle keep-alive: React reorders rows without DOM add/remove at times
      this._interval = setInterval(() => { if (!disposed) pass(); }, 5000);
    },
    dispose() {
      disposed = true;
      if (managedTitleRequest) managedTitleRequest.abort();
      if (timer !== null) clearTimeout(timer);
      try { observer && observer.disconnect(); } catch { /* ignore */ }
      try { this._disposeWorkspaces && this._disposeWorkspaces(); } catch { /* ignore */ }
      if (this._interval) clearInterval(this._interval);
      clearManagedIcons();
      for (const [container, root] of roots.entries()) {
        try { root.unmount(); } catch { /* ignore */ }
        try { container.remove(); } catch { /* ignore */ }
      }
      roots.clear();
    },
  };
}

/**
 * Inspect the sidebar the way the badge injector does, so a report can separate
 * "no Workspace row matched" from "row matched, line empty".
 * @returns every Workspace row's anchors and the injected badge lines.
 */
export function probeBadgeDom() {
  if (typeof document === 'undefined') return { rows: [], injected: [] };
  const trim = (el) => ((el && el.textContent) || '').trim().slice(0, 80);
  const rows = [...document.querySelectorAll(SIDEBAR_WORKSPACE_ROW)].map((row) => {
    const column = row.querySelector(SIDEBAR_TITLE_COLUMN);
    const title = row.querySelector(SIDEBAR_ROW_TITLE);
    const line = row.querySelector('.dsh-bw-badges');
    return {
      rowKey: row.getAttribute('data-row-key'),
      title: trim(title) || null,
      hasTitle: Boolean(title),
      hasTitleColumn: Boolean(column),
      lineInTitleColumn: Boolean(line && column && line.parentElement === column),
      lineText: trim(line),
    };
  });
  const injected = [...document.querySelectorAll('.dsh-bw-badges')].map((el) => ({
    inWorkspaceRow: Boolean(el.closest(SIDEBAR_WORKSPACE_ROW)),
    text: trim(el),
  }));
  return { rows, injected };
}
