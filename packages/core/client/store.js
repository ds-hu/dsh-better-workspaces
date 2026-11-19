/**
 * Tiny observable store used by the git feed and by feature-lifecycle state.
 *
 * `useStore` is a thin `useSyncExternalStore` wrapper; React never sees a
 * stale snapshot because `get` is the same function passed to every hook.
 */
import { useSyncExternalStore } from './react.js';

export function createStore(initial) {
  let state = initial;
  const listeners = new Set();
  return {
    get: () => state,
    set: (next) => {
      state = typeof next === 'function' ? next(state) : next;
      for (const listener of listeners) {
        try { listener(); } catch { /* listener faults are isolated */ }
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function useStore(store, selector) {
  const state = useSyncExternalStore(store.subscribe, store.get, store.get);
  return selector(state);
}
