/**
 * Per-row surface preferences (`dsh-bw:<module>:surfaces:v1`).
 *
 * A feature row owns a small set of browser surfaces that users switch from the
 * row's native config page. The store persists a JSON object in `localStorage`,
 * notifies local subscribers on every write, and mirrors writes from other tabs
 * through the `storage` event (no reload needed).
 */

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => { values.set(key, String(value)); },
    removeItem: (key) => { values.delete(key); },
  };
}

let fallbackStorage = null;

function storageFor() {
  try {
    if (typeof localStorage !== 'undefined' && localStorage) return localStorage;
  } catch { /* SecurityError: fall through to the in-memory copy */ }
  if (!fallbackStorage) fallbackStorage = memoryStorage();
  return fallbackStorage;
}

/**
 * Create one preference store.
 *
 * @param storageKey - the localStorage key (`dsh-bw:<module>:surfaces:v1`).
 * @param defaults - the default values; `get()` returns these merged with the
 *   persisted object, and `reset()` restores them.
 * @returns `{ get, set, subscribe, reset }`.
 */
export function createPrefs(storageKey, defaults) {
  const defaultsCopy = { ...defaults };
  let listeners = new Set();
  let storageBound = false;

  function readStored() {
    try {
      const raw = storageFor().getItem(storageKey);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function read() {
    return { ...defaultsCopy, ...readStored() };
  }

  function notify() {
    const value = read();
    for (const listener of [...listeners]) {
      try { listener(value); } catch { /* listener faults are isolated */ }
    }
  }

  function onStorage(event) {
    if (!event || event.key !== storageKey) return;
    notify();
  }

  function bindStorage() {
    if (storageBound) return;
    storageBound = true;
    try {
      if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        window.addEventListener('storage', onStorage);
      }
    } catch { /* no dom */ }
  }

  function unbindStorage() {
    if (!storageBound || listeners.size > 0) return;
    storageBound = false;
    try {
      if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
        window.removeEventListener('storage', onStorage);
      }
    } catch { /* no dom */ }
  }

  return {
    /** Whole merged object, or one value when a name is given. */
    get(name) {
      const value = read();
      return name === undefined ? value : value[name];
    },
    /**
     * `set({hero:false})` merges a patch; `set('hero', false)` writes one key.
     * Unknown keys are kept (a newer build may have written them).
     */
    set(patchOrName, value) {
      const patch = typeof patchOrName === 'string' ? { [patchOrName]: value } : patchOrName;
      if (!patch || typeof patch !== 'object') return;
      const next = { ...readStored(), ...patch };
      try { storageFor().setItem(storageKey, JSON.stringify(next)); } catch { /* quota/security */ }
      notify();
    },
    /** Subscribe to writes; `fn(mergedPreferences)` on every change. */
    subscribe(listener) {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      bindStorage();
      return () => {
        listeners.delete(listener);
        unbindStorage();
      };
    },
    /** Restore the defaults (and notify). */
    reset() {
      try { storageFor().removeItem(storageKey); } catch { /* quota/security */ }
      notify();
    },
    /** The defaults this store was created with. */
    defaults() {
      return { ...defaultsCopy };
    },
  };
}
