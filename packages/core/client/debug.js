/**
 * The read-only diagnostic hook (`window.__dshBwDebug`).
 *
 * Every bundle materialized on the page installs its own provider into one
 * page-global hook, so whichever row is applied last, the debug surface can
 * report the hero control (worktree bundle) and the badge line (status bundle).
 * Diagnostics only: it reads the same stores the surfaces read and never
 * mutates them; the hook disappears with the last disposer.
 */
import { effectiveSessionCwd } from './session.js';
import { nearestLayoutAncestor } from './dom.js';

/** Strip the stores' own objects down to a printable projection. */
export function projectSessionSnapshot(state) {
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

export function projectWorkspaceSnapshot(state) {
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

const STATE_KEY = '__dshBwDebugState';

function debugState() {
  if (!window[STATE_KEY] || typeof window[STATE_KEY] !== 'object') {
    window[STATE_KEY] = { refs: 0, providers: new Set(), previous: undefined, hook: null };
  }
  return window[STATE_KEY];
}

function pick(state, name) {
  for (const provider of state.providers) {
    if (provider && typeof provider[name] === 'function') return provider[name];
  }
  return null;
}

function neutralProbe() {
  return { dom: { rowFound: false, controls: [], rowCount: 0 }, resolution: null };
}

function createHook(state) {
  const hero = () => {
    const fn = pick(state, 'hero');
    return fn ? fn() : null;
  };
  const heroDom = () => {
    const fn = pick(state, 'heroDom');
    return fn ? fn() : neutralProbe().dom;
  };
  return {
    version: 'diagnostics-only',
    sessions: () => {
      const fn = pick(state, 'sessions');
      return fn ? fn() : null;
    },
    workspaces: () => {
      const fn = pick(state, 'workspaces');
      return fn ? fn() : null;
    },
    hero,
    probe: () => {
      const fn = pick(state, 'probe');
      return fn ? fn() : neutralProbe();
    },
    // The sidebar badge line is the other DOM injection, and its failure mode
    // is silence: an upstream row rename removes it without touching anything
    // else.
    badges: () => {
      const fn = pick(state, 'badges');
      return fn ? fn() : { rows: [], injected: [] };
    },
    describeOnScreen: () => {
      const fn = pick(state, 'describeOnScreen');
      return fn ? fn() : { rowFound: false, controlCount: 0 };
    },
    nearestLayoutAncestor,
    isHeroRow: (node) => {
      const fn = pick(state, 'isHeroRow');
      return fn ? fn(node) : false;
    },
    heroCwdFor: (...args) => {
      const fn = pick(state, 'heroCwdFor');
      return fn ? fn(...args) : null;
    },
    _heroDom: heroDom,
  };
}

/**
 * Install (or join) the page-global debug hook with one provider object.
 * @param provider - feature probes (`sessions`, `workspaces`, `hero`, `probe`,
 *   `badges`, `describeOnScreen`, `isHeroRow`, `heroCwdFor`, `heroDom`).
 * @returns the disposer that removes this provider.
 */
export function installDebugHook(provider) {
  if (typeof window === 'undefined') return () => {};
  const state = debugState();
  if (provider && typeof provider === 'object') state.providers.add(provider);
  if (state.refs === 0) {
    state.previous = window.__dshBwDebug;
    state.hook = createHook(state);
    window.__dshBwDebug = state.hook;
  }
  state.refs += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    state.providers.delete(provider);
    state.refs -= 1;
    if (state.refs > 0) return;
    if (state.hook && window.__dshBwDebug === state.hook) {
      if (state.previous === undefined) delete window.__dshBwDebug;
      else window.__dshBwDebug = state.previous;
    }
    delete window[STATE_KEY];
  };
}
