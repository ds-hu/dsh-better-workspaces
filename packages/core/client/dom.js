/**
 * DOM injection helpers shared by the two injectors (status badge line,
 * worktree hero control).
 *
 * Sidebar anchors (ADR 0001): the shipped class-name hooks, named here so an
 * upstream rename is one edit, and every pass re-checks them before injecting.
 * `_projectText` is the column that holds the Workspace title, so a node
 * appended to it renders under the title.
 */
import { WT_ICON_SVG } from './icons.js';
import { workspaceItems } from './workspace.js';

export const SIDEBAR_WORKSPACE_ROW = '[class*="_projectRow"]';
export const SIDEBAR_TITLE_COLUMN = '[class*="_projectText"]';
export const SIDEBAR_ROW_TITLE = '[class*="_title"]';
export const SIDEBAR_FOLDER = '[class*="_folder"]';
export const WORKSPACE_ROW_KEY_PREFIX = 'workspace:';

/**
 * Workspace-row identity (ADR 0001 DOM heuristic): the row's `data-row-key` is
 * `workspace:<workspaceId>` and resolves exactly against the workspaces store.
 * Shells predating that attribute fall back to a *unique* title match; an
 * ambiguous title injects nothing. The ungrouped group carries no Workspace, so
 * it gets no badges.
 */
export function workspaceForRow(row, titleEl) {
  let items;
  try { items = workspaceItems(); } catch { return null; }
  // A row that carries a row key is identified by it, not by its text.
  if (row.hasAttribute('data-row-key')) {
    const raw = row.getAttribute('data-row-key') || '';
    if (raw.indexOf(WORKSPACE_ROW_KEY_PREFIX) !== 0) return null;
    const workspaceId = raw.slice(WORKSPACE_ROW_KEY_PREFIX.length);
    if (workspaceId === '') return null; // ungrouped pseudo-group: no checkout
    const exact = items.find((item) => item && item.workspaceId === workspaceId);
    return exact && typeof exact.path === 'string' && exact.path !== '' ? exact : null;
  }
  // Shells predating `data-row-key`: a unique display title is the only
  // identity available (ADR 0001 Revision 3).
  const title = (titleEl.textContent || '').trim();
  if (title === '') return null;
  let unique = null;
  for (const item of items) {
    if (!item || item.title !== title) continue;
    if (typeof item.path !== 'string' || item.path === '') continue;
    if (unique !== null) return null;
    unique = item;
  }
  return unique;
}

/**
 * Managed-worktree icon (ADR 0001 Revision 1): matched by title text — managed
 * worktree workspaces swap the folder icon for the branch icon so their
 * provenance is visible at a glance.
 */
export function applyManagedIcons(managedTitles) {
  if (typeof document === 'undefined' || managedTitles === null) return;
  let rows;
  try {
    rows = document.querySelectorAll(SIDEBAR_WORKSPACE_ROW);
  } catch {
    return;
  }
  for (const row of rows) {
    const titleEl = row.querySelector(SIDEBAR_ROW_TITLE);
    const folderEl = row.querySelector(SIDEBAR_FOLDER);
    if (!titleEl || !folderEl) continue;
    const isWt = managedTitles.has(titleEl.textContent || '');
    const marked = folderEl.getAttribute('data-bw-wt') === '1';
    if (isWt && !marked) {
      folderEl.setAttribute('data-bw-wt', '1');
      const icon = document.createElement('span');
      icon.className = 'dsh-bw-wt-icon';
      icon.innerHTML = WT_ICON_SVG;
      folderEl.appendChild(icon);
    } else if (!isWt && marked) {
      folderEl.removeAttribute('data-bw-wt');
      const prev = folderEl.querySelector('.dsh-bw-wt-icon');
      if (prev) prev.remove();
    }
  }
}

/** Remove every managed-worktree icon this plugin injected. */
export function clearManagedIcons() {
  try {
    for (const el of document.querySelectorAll('[data-bw-wt]')) {
      el.removeAttribute('data-bw-wt');
      const icon = el.querySelector('.dsh-bw-wt-icon');
      if (icon) icon.remove();
    }
  } catch { /* no dom */ }
}

/* The slot framework wraps every slot in an anchor div that carries
 * `data-slot` and `style="display: contents"`, precisely so it stays out of
 * layout while remaining addressable. That wrapper is therefore the slot's
 * `parentElement`, NOT the layout row that contains it (ADR 0001 Amendment 1).
 *
 * A `display: contents` box generates no box of its own, so it can never be an
 * insertion point: skip such wrappers, and empty emission wrappers too, until
 * the nearest element that starts a real box. The depth cap keeps a
 * restructured tree from walking us out of the hero entirely. */
export const HERO_ANCHOR_DEPTH_CAP = 8;

export function isNonLayoutWrapper(node) {
  if (!(node instanceof HTMLElement)) return false;
  if (node.style && node.style.display === 'contents') return true;
  // an emission/outlet wrapper that renders nothing owns no box either
  return node.childElementCount === 0 && (node.textContent ?? '').trim() === '';
}

export function nearestLayoutAncestor(node) {
  let current = node instanceof HTMLElement ? node.parentElement : null;
  for (let depth = 0; current && depth < HERO_ANCHOR_DEPTH_CAP; depth += 1) {
    if (!isNonLayoutWrapper(current)) return current;
    current = current.parentElement;
  }
  return null;
}
