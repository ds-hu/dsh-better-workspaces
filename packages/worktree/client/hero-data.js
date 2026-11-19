/**
 * Hero-control resolution, DOM placement and diagnostics (bundle `bw-worktree`).
 *
 * Everything here answers one question: "which directory does the on-screen
 * Session work in, and where does the control go on the page?" The answer is
 * written to `heroDebugState` on every render so `__dshBwDebug` can report what
 * the plugin itself saw — diagnostics only, never an input to a decision.
 */
import { h } from '@ds-hu/dsh-bw-core/client/react.js';
import { createRoot } from 'react-dom/client';
import { effectiveSessionCwd } from '@ds-hu/dsh-bw-core/client/session.js';
import {
  HERO_ANCHOR_DEPTH_CAP, isNonLayoutWrapper, nearestLayoutAncestor,
} from '@ds-hu/dsh-bw-core/client/dom.js';

/* Last inputs and verdict of the hero control, for `__dshBwDebug`.
 * Written by HeroControl on every render and read only on demand: the point is
 * to answer "what did the plugin itself see", which no amount of external
 * inference can settle. Diagnostics only — nothing reads it to make a decision. */
export const heroDebugState = {
  sessionSnapshot: null,
  workspaceSnapshot: null,
  lastCwd: null,
  lastSource: null,
  lastGuard: null,
  lastDetect: null,
  mainViewKey: null,
  mainViewAvailable: false,
  heroBuilds: 0,
};

/** Freshness key for one hero control instance. It must move when the RESOLVED
 * cwd moves, not merely when the session does. */
export function heroControlKey(currentId, cwd) {
  return `${currentId || ''}\u0000${cwd || ''}`;
}

/* A path-resolved async value is only valid for the path it was resolved for.
 * Tag every detect result with its cwd and read it through here. */
export function liveDetect(entry, cwd, sessionId) {
  return entry && cwd && entry.cwd === cwd
    && (entry.sessionId === undefined || entry.sessionId === sessionId) ? entry.value : null;
}

/** The path of the Workspace that owns `currentId`, or undefined for none. */
export function heroWorkspacePathFor(currentId, workspaceItems) {
  if (!workspaceItems || !currentId) return undefined;
  for (const workspace of workspaceItems) {
    if (!workspace || typeof workspace.path !== 'string' || workspace.path === '') continue;
    const sessionIds = workspace.sessionIds;
    if (!Array.isArray(sessionIds)) continue;
    if (sessionIds.some((id) => String(id) === String(currentId))) return workspace.path;
  }
  return undefined;
}

/**
 * Resolve the hero directory and name where it came from. The source is what
 * makes a failure report legible: "hidden although the session has this cwd"
 * and "hidden because nothing resolved" are different bugs.
 * @returns the directory (or null) and `'session'` | `'workspace'` | null.
 */
export function heroResolve(summary, currentId, workspaceItems) {
  const bound = effectiveSessionCwd(summary);
  if (bound) return { cwd: bound, source: 'session' };
  const viaWorkspace = heroWorkspacePathFor(currentId, workspaceItems);
  if (viaWorkspace === undefined) return { cwd: null, source: null };
  return { cwd: viaWorkspace, source: 'workspace' };
}

/* Before the first message a Session can belong to a Workspace while its own
 * `cwd` is still undefined — the official hero derives its picker label from the
 * Workspace membership for exactly that reason. Without the same fallback the
 * hero control renders nothing in the one state it exists for, so read the path
 * off the Workspace that owns this Session.
 *
 * Only a resolved path is returned: with no current Session, or a Session that
 * belongs to no Workspace yet, the caller must hide the control rather than
 * guess a directory. */
export function heroCwdFor(summary, currentId, workspaceItems) {
  return heroResolve(summary, currentId, workspaceItems).cwd;
}

/* The slot framework wraps every slot in an anchor div that carries `data-slot`
 * and `style="display: contents"`, precisely so it stays out of layout while
 * remaining addressable. That wrapper is therefore the slot's `parentElement`,
 * NOT the layout row that contains it (ADR 0001 Amendment 1 — this is exactly
 * how the worktree control went missing while every anchor check still passed).
 * Skip such wrappers until the nearest element that starts a real box; the depth
 * cap keeps a restructured tree from walking us out of the hero entirely. */
export { HERO_ANCHOR_DEPTH_CAP, isNonLayoutWrapper, nearestLayoutAncestor };

export function isHeroRow(node) {
  return Boolean(node)
    && typeof node.className === 'string'
    && node.className.indexOf('_heroWorkspaceRow') !== -1;
}

/**
 * Inspect the DOM the way the injector does, so a report distinguishes "never
 * injected" from "injected but not visible".
 * @returns the hero row state and every injected control found.
 */
export function probeHeroDom() {
  if (typeof document === 'undefined') return { rowFound: false, controls: [] };
  const rows = document.querySelectorAll('[class*="_heroWorkspaceRow"]');
  const row = rows[0] || null;
  const describe = (el) => ({
    cls: typeof el.className === 'string' ? el.className : String(el.getAttribute('class') || ''),
    dataSlot: el.getAttribute('data-slot'),
    display: el.style ? el.style.display || null : null,
    text: (el.textContent || '').trim().slice(0, 60),
  });
  const controls = [...document.querySelectorAll('.dsh-bw-hero')].map((el) => ({
    parentIsRow: el.parentElement === row,
    inRow: Boolean(row && row.contains(el)),
    display: typeof getComputedStyle === 'function' ? getComputedStyle(el).display : null,
    width: el.offsetWidth,
    height: el.offsetHeight,
    text: (el.textContent || '').trim().slice(0, 80),
    // Per-button state, because "the control rendered" and "the control works"
    // are different questions: a visible but disabled submit button looked
    // exactly like a broken click from the outside.
    buttons: [...el.querySelectorAll('button')].map((button) => ({
      label: (button.textContent || '').trim().slice(0, 40),
      disabled: Boolean(button.disabled),
      ariaExpanded: button.getAttribute('aria-expanded'),
    })),
  }));
  return {
    rowCount: rows.length,
    rowFound: Boolean(row),
    heroBuilds: heroDebugState.heroBuilds,
    rowChildren: row ? [...row.children].map(describe) : [],
    slotTags: [...document.querySelectorAll('[data-slot]')].slice(0, 40).map((el) => el.getAttribute('data-slot')),
    controls,
  };
}

/** Recompute the resolution from the stores as they are right now. */
export function probeHeroResolution() {
  const listState = heroDebugState.sessionSnapshot;
  const workspaceState = heroDebugState.workspaceSnapshot;
  const session = projectSessionSnapshotLocal(listState);
  const workspaces = projectWorkspaceSnapshotLocal(workspaceState);
  const currentId = session ? session.current : null;
  const summary = currentId && session ? session.byId[currentId] : undefined;
  const resolved = heroResolve(summary, currentId, workspaces ? workspaces.items : null);
  const owner = workspaces
    ? workspaces.items.find((workspace) => currentId && workspace.sessionIds.some((id) => String(id) === String(currentId)))
    : undefined;
  return {
    currentId,
    // Which source supplied the id is the whole question when the control is
    // invisible, so the raw key and its availability are reported next to the
    // resolution below.
    uiSessionKey: heroDebugState.mainViewKey ?? null,
    mainViewAvailable: Boolean(heroDebugState.mainViewAvailable),
    sessionCwd: effectiveSessionCwd(summary),
    headerCwd: summary && typeof summary.cwd === 'string' ? summary.cwd : null,
    resolvedCwd: resolved.cwd,
    source: resolved.source,
    owningWorkspaceId: owner ? owner.workspaceId : null,
    owningWorkspacePath: owner ? owner.path : null,
    lastCwd: heroDebugState.lastCwd,
    lastSource: heroDebugState.lastSource,
    lastGuard: heroDebugState.lastGuard,
    lastDetect: heroDebugState.lastDetect,
  };
}

/* Local copies of the two projections (the debug module owns the exported
 * versions; the hero reports its OWN captured snapshots, so it needs the plain
 * projection without any bundle-global state). */
function projectSessionSnapshotLocal(state) {
  if (!state || typeof state !== 'object') return null;
  const byId = {};
  for (const [id, summary] of Object.entries(state.byId || {})) {
    const projected = summary && summary.projectionValues
      ? summary.projectionValues.workingDirectory
      : undefined;
    byId[id] = {
      cwd: effectiveSessionCwd(summary),
      headerCwd: summary && typeof summary.cwd === 'string' ? summary.cwd : null,
      workingDirectory: typeof projected === 'string' && projected !== '' ? projected : null,
      title: summary && summary.title !== undefined ? summary.title : (summary && summary.displayTitle) || null,
    };
  }
  return { current: state.current ?? null, ids: Array.isArray(state.ids) ? [...state.ids] : [], phase: state.phase ?? null, byId };
}

function projectWorkspaceSnapshotLocal(state) {
  if (!state || typeof state !== 'object') return null;
  return {
    phase: state.phase ?? null,
    items: Array.isArray(state.items) ? state.items.map((workspace) => ({
      workspaceId: workspace && workspace.workspaceId,
      path: workspace && workspace.path,
      title: workspace && workspace.title,
      sessionIds: workspace && Array.isArray(workspace.sessionIds) ? [...workspace.sessionIds] : [],
    })) : [],
  };
}

/**
 * Create the hero-seat injector. The seat is rebuilt only when the row is
 * replaced, and the control is a real React root so its state survives the
 * shell's re-renders.
 * @param Component - the component mounted into the seat (`HeroControl`).
 */
export function createHeroInjector(Component) {
  let container = null;
  let root = null;
  let observer = null;
  let timer = null;
  let disposed = false;
  let anchorWarned = false;
  // How many times the seat was rebuilt. Diagnostics only: a rebuild unmounts
  // the React tree, so a popover that "does nothing" is often a remount storm,
  // and this counter is what makes that visible from the console instead of
  // inferable from behaviour.
  let heroBuilds = 0;

  function teardown() {
    if (root) {
      try { root.unmount(); } catch { /* ignore */ }
      root = null;
    }
    if (container && container.isConnected) container.remove();
    container = null;
  }

  function pass() {
    if (disposed || typeof document === 'undefined') return;
    // the class name is the layout anchor this control belongs to; the preset
    // slot is only how we locate that row and where to sit in it
    let heroRow = null;
    let presetSlot = null;
    try {
      heroRow = document.querySelector('[class*="_heroWorkspaceRow"]');
      presetSlot = document.querySelector('[data-slot="conversation.hero.agentPreset"]');
    } catch { /* no dom */ }
    if (!isHeroRow(heroRow)) {
      // the class hook can be renamed; fall back to climbing from the preset
      // slot past the slot framework's display:contents anchor
      const climbed = nearestLayoutAncestor(presetSlot);
      heroRow = isHeroRow(climbed) ? climbed : null;
    }
    // A seat is usable only when the slot sits directly in the row. When the
    // slot framework wrapped it, the wrapper is not a layout box, so fall back
    // to appending into the row instead of before the wrapper.
    if (presetSlot && (!heroRow || presetSlot.parentElement !== heroRow)) presetSlot = null;
    if (!heroRow) {
      // Anchor self-check (ADR 0001, Amendment 1): the hero row is absent or
      // restructured → silent degradation. Warn only while this is
      // demonstrably a hero we failed to recognize, not on every session
      // without a hero at all.
      if (presetSlot && !anchorWarned) {
        anchorWarned = true;
        console.debug('[better-workspaces] hero row anchor changed — worktree control degraded');
      }
      teardown();
      return;
    }
    // Reuse is decided by the row, not by referential equality with the seat:
    // the seat moves when a re-render inserts its own wrapper, and remounting
    // on every such pass would flash the control.
    if (container && container.isConnected && container.parentElement === heroRow) {
      if (presetSlot ? container.nextSibling === presetSlot : container === heroRow.lastElementChild) return;
    }
    teardown();
    container = document.createElement('div');
    container.className = 'dsh-bw-hero';
    if (presetSlot && presetSlot.parentElement === heroRow) heroRow.insertBefore(container, presetSlot);
    else heroRow.appendChild(container);
    root = createRoot(container);
    heroBuilds += 1;
    heroDebugState.heroBuilds = heroBuilds;
    root.render(h(Component, null));
  }

  function schedule() {
    if (disposed || timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      pass();
    }, 300);
  }

  return {
    start() {
      if (disposed || typeof document === 'undefined') return;
      try {
        observer = new MutationObserver(schedule);
        observer.observe(document.body, { childList: true, subtree: true });
      } catch {
        observer = null;
      }
      pass();
      this._interval = setInterval(() => { if (!disposed) pass(); }, 5000);
    },
    dispose() {
      disposed = true;
      if (timer !== null) clearTimeout(timer);
      try { observer && observer.disconnect(); } catch { /* ignore */ }
      if (this._interval) clearInterval(this._interval);
      teardown();
    },
  };
}

