import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
  url: 'http://127.0.0.1:3080/',
  runScripts: 'outside-only',
  virtualConsole: new VirtualConsole(),
});
const { window } = dom;
for (const key of ['window', 'document', 'navigator', 'MutationObserver', 'HTMLElement', 'Node', 'Event', 'KeyboardEvent', 'MouseEvent', 'AbortController']) {
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const ReactModule = await import('react');
const React = ReactModule.default;
const { act } = ReactModule;
const { createRoot } = await import('react-dom/client');

let loadedEntry = null;
window.__ModuleLoader__ = { load(entry) { loadedEntry = entry; } };
const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
window.eval(source);
assert.ok(loadedEntry, 'the browser bundle registers with ModuleLoader');
const mod = loadedEntry.factory((specifier) => {
  if (specifier === 'react') return React;
  if (specifier === 'react-dom/client') return { createRoot };
  throw new Error(`unexpected client dependency: ${specifier}`);
});

const secondMod = loadedEntry.factory((specifier) => {
  if (specifier === 'react') return React;
  if (specifier === 'react-dom/client') return { createRoot };
  throw new Error(`unexpected client dependency: ${specifier}`);
});

// Two independently materialized client packages model an HMR overlap. Both
// must share one adopted style tag, and releasing the older package must not
// remove CSS still owned by the newer one.
const legacyStyle = document.createElement('style');
legacyStyle.dataset.pluginCss = 'dsh-better-workspaces/client.css';
legacyStyle.textContent = 'legacy';
document.head.appendChild(legacyStyle);
const releaseFirstCss = mod.__bwTest.mountCss();
const releaseSecondCss = secondMod.__bwTest.mountCss();
let styles = document.querySelectorAll('style[data-plugin-css="dsh-better-workspaces/client.css"]');
assert.equal(styles.length, 1, 'overlapping packages adopt one shared style element');
assert.notEqual(styles[0].textContent, 'legacy', 'the adopted style receives current CSS');
releaseFirstCss();
releaseFirstCss();
styles = document.querySelectorAll('style[data-plugin-css="dsh-better-workspaces/client.css"]');
assert.equal(styles.length, 1, 'releasing an older package retains CSS for the live package');

// Keyed Hero resources must abort and ignore the old cwd when the session store
// switches before detection settles.
//
// `uiSession` is the service that actually owns the on-screen Session: the
// provider behind the injected `sessions` service publishes only
// { ids, byId, phase, projectionsBySession }, so a fixture that puts `current`
// on the sessions snapshot tests a shape production never produces. Build the
// binding source the way dsh-client-ui-session does.
function stubUiSession(id) {
  let value = id === undefined ? { key: void 0, hooks: {}, keyedHooks: {}, props: {} } : { key: id, hooks: {}, keyedHooks: {}, props: {} };
  const listeners = new Set();
  return {
    current: {
      getSnapshot: () => value,
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    },
    setKey(next) {
      value = next === undefined ? { key: void 0, hooks: {}, keyedHooks: {}, props: {} } : { key: next, hooks: {}, keyedHooks: {}, props: {} };
      for (const listener of listeners) listener();
    },
  };
}

let sessionSnapshot = {
  byId: { a: { cwd: '/repo-a', title: 'A' } }, ids: ['a'], phase: 'ready',
};
const sessionListeners = new Set();
const mainUiSession = stubUiSession('a');
const restoreRuntime = mod.__bwTest.setTestRuntime({
  get: (name) => (name === 'uiSession' ? mainUiSession : undefined),
  sessions: {
    list: {
      getSnapshot: () => sessionSnapshot,
      subscribe(listener) { sessionListeners.add(listener); return () => sessionListeners.delete(listener); },
    },
  },
  workspaces: { items: [] },
});
let resolveDetectA;
let detectASignal = null;
window.fetch = (url, options = {}) => {
  const parsed = new URL(String(url), window.location.href);
  if (parsed.pathname.endsWith('/detect') && parsed.searchParams.get('path') === '/repo-a') {
    detectASignal = options.signal;
    return new Promise((resolve) => { resolveDetectA = () => resolve({ json: async () => ({ ok: true, isGit: true, isLinkedWorktree: true, managed: true }) }); });
  }
  if (parsed.pathname.endsWith('/detect') && parsed.searchParams.get('path') === '/repo-b') {
    return Promise.resolve({ json: async () => ({ ok: true, isGit: true, isLinkedWorktree: false, managed: false }) });
  }
  throw new Error(`unexpected Hero request: ${parsed.pathname}${parsed.search}`);
};
globalThis.fetch = window.fetch;
const heroContainer = document.createElement('div');
document.body.appendChild(heroContainer);
const heroRoot = createRoot(heroContainer);
await act(async () => { heroRoot.render(React.createElement(mod.__bwTest.HeroControl)); });
assert.equal(typeof resolveDetectA, 'function', 'session A starts detection');
sessionSnapshot = {
  byId: { b: { cwd: '/repo-b', title: 'B' } }, ids: ['b'], phase: 'ready',
};
await act(async () => {
  // a navigation moves the on-screen Session: that is uiSession's snapshot,
  // not a field on the sessions list
  mainUiSession.setKey('b');
  for (const listener of sessionListeners) listener();
  await Promise.resolve();
  await Promise.resolve();
});
assert.equal(detectASignal?.aborted, true, 'switching cwd aborts session A detection');
assert.equal(heroContainer.querySelector('.dsh-bw-hero-label')?.textContent, 'hero.modeLocal', 'session B renders its local Git mode');
await act(async () => {
  resolveDetectA();
  await Promise.resolve();
  await Promise.resolve();
});
assert.equal(heroContainer.querySelector('.dsh-bw-hero-label')?.textContent, 'hero.modeLocal', 'late session A detection cannot hide session B');
await act(async () => { heroRoot.unmount(); });
heroContainer.remove();
restoreRuntime();

/* ------------------------------------------------------------------ *
 * hero cwd resolution when the Session has none yet (ADR 0001/0002)
 *
 * A blank Session can belong to a Workspace while its own `cwd` is still
 * undefined, and that is precisely the state the hero control exists for.
 * Reading the path off the owning Workspace is what the official picker does;
 * with no fallback the control rendered nothing at all.
 * ------------------------------------------------------------------ */
const { heroCwdFor, heroControlKey } = mod.__bwTest;
{
  const items = [{ workspaceId: 'w1', path: '/repo-w1', title: 'W1', sessionIds: ['s1', 's2'] }];
  assert.equal(heroCwdFor({ cwd: '/repo-bound' }, 's1', items), '/repo-bound',
    'a Session-carried cwd wins over membership');
  assert.equal(heroCwdFor({}, 's1', items), '/repo-w1',
    'a Session with no cwd resolves through its owning Workspace');
  assert.equal(heroCwdFor(undefined, 's1', items), '/repo-w1',
    'membership is still enough when the summary is missing');
  assert.equal(heroCwdFor({}, 's9', items), null,
    'a Session owned by no Workspace resolves to nothing rather than guessing');
  assert.equal(heroCwdFor({}, undefined, items), null, 'no current Session resolves to nothing');
  assert.equal(heroCwdFor({}, 's1', null), null, 'an absent Workspace store resolves to nothing');
  assert.equal(heroCwdFor({ cwd: '' }, 's1', items), '/repo-w1', 'an empty cwd falls through to membership');
  assert.equal(heroCwdFor({ cwd: '/repo-original', projectionValues: { workingDirectory: '/repo-worktree' } }, 's1', items),
    '/repo-worktree', 'DSH 0.2.1 workingDirectory outranks the immutable header cwd');
  assert.equal(heroCwdFor({ cwd: '/repo-original', projectionValues: { workingDirectory: null } }, 's1', items),
    '/repo-original', 'a null workingDirectory projection falls back to the header');
  assert.equal(heroCwdFor({ cwd: '/repo-original', projectionValues: { workingDirectory: '' } }, 's1', items),
    '/repo-original', 'an empty workingDirectory projection falls back to the header');

  // The projection is the effective directory; header cwd is the original
  // project and must stay observable in diagnostics beside it.
  const { effectiveSessionCwd } = mod.__bwTest;
  assert.equal(effectiveSessionCwd({ cwd: '/original', projectionValues: { workingDirectory: '/entered' } }), '/entered');
  assert.equal(effectiveSessionCwd({ cwd: '/original', projectionValues: {} }), '/original');
  assert.equal(effectiveSessionCwd({ projectionValues: { workingDirectory: '/entered' } }), '/entered');
  assert.equal(effectiveSessionCwd({ cwd: '/original' }), '/original');
  assert.equal(effectiveSessionCwd({ cwd: '' }), null);
  assert.equal(effectiveSessionCwd(undefined), null);

  // the Workspace row shapes that must be skipped, not crashed on
  const odd = [
    { workspaceId: 'x', path: '', sessionIds: ['s1'] },
    { workspaceId: 'y', sessionIds: ['s1'] },
    { workspaceId: 'z', path: '/repo-z' },
    { workspaceId: 'w', path: '/repo-w', sessionIds: 's1' },
  ];
  assert.equal(heroCwdFor({}, 's1', odd), null, 'malformed Workspace rows are skipped');

  assert.notEqual(heroControlKey('s1', '/a'), heroControlKey('s1', '/b'),
    'the control key moves when the resolved cwd moves');
  assert.equal(heroControlKey('s1', '/a'), heroControlKey('s1', '/a'), 'the key is stable otherwise');

  // The source is what makes a report legible: "hidden although the session
  // carries this cwd" and "hidden because nothing resolved" are different bugs.
  const { heroResolve } = mod.__bwTest;
  const resolveCases = [
    [{ cwd: '/repo-bound' }, 's1', { cwd: '/repo-bound', source: 'session' }, 'a session cwd reports itself as the source'],
    [{}, 's1', { cwd: '/repo-w1', source: 'workspace' }, 'a workspace-derived cwd reports the workspace as the source'],
    [{}, 's9', { cwd: null, source: null }, 'an unresolved cwd names no source'],
    [{ cwd: '/elsewhere' }, 's1', { cwd: '/elsewhere', source: 'session' }, 'a bound session cwd outranks workspace membership'],
    [{ cwd: '/original', projectionValues: { workingDirectory: '/entered' } }, 's1', { cwd: '/entered', source: 'session' }, 'the working-directory projection is the session source'],
  ];
  for (const [summary, id, expected, label] of resolveCases) {
    const actual = heroResolve(summary, id, items);
    assert.equal(actual.cwd, expected.cwd, `${label} (cwd)`);
    assert.equal(actual.source, expected.source, `${label} (source)`);
  }

  // projection must be total and must not leak the stores' own objects
  const { projectSessionSnapshot, projectWorkspaceSnapshot } = mod.__bwTest;
  assert.equal(projectSessionSnapshot(null), null, 'a missing session snapshot projects to null');
  assert.equal(projectSessionSnapshot(undefined), null, 'an undefined session snapshot projects to null');
  const projected = projectSessionSnapshot({ current: 's1', ids: ['s1'], phase: 'ready', byId: { s1: { title: 'T' } } });
  assert.equal(projected.current, 's1');
  assert.equal(projected.ids.length, 1, 'ids project through');
  assert.equal(projected.ids[0], 's1');
  assert.equal(projected.phase, 'ready');
  assert.equal(projected.byId.s1.cwd, null,
    'a session without cwd projects an explicit null rather than dropping the field');
  assert.equal(projected.byId.s1.headerCwd, null,
    'a session without a header cwd projects an explicit null');
  assert.equal(projected.byId.s1.workingDirectory, null,
    'a session without a working-directory projection projects an explicit null');
  const projectedMove = projectSessionSnapshot({
    current: 's1',
    ids: ['s1'],
    phase: 'ready',
    byId: { s1: { cwd: '/original', projectionValues: { workingDirectory: '/worktree' }, title: 'T' } },
  });
  assert.equal(projectedMove.byId.s1.cwd, '/worktree',
    'the diagnostic cwd is the effective working directory');
  assert.equal(projectedMove.byId.s1.headerCwd, '/original',
    'the immutable header cwd stays visible beside the effective directory');
  assert.equal(projected.byId.s1.title, 'T');
  assert.equal(projectWorkspaceSnapshot(null), null, 'a missing Workspace snapshot projects to null');
  const oddWorkspace = projectWorkspaceSnapshot({ items: [{ workspaceId: 'w' }] }).items[0];
  assert.equal(oddWorkspace.workspaceId, 'w');
  assert.equal(oddWorkspace.sessionIds.length, 0,
    'malformed Workspace rows project safely instead of throwing');
  assert.equal(projectWorkspaceSnapshot({ items: [{ workspaceId: 'w', sessionIds: ['a'] }] }).items[0].sessionIds[0], 'a',
    'Workspace session membership projects through');
}

/* ------------------------------------------------------------------ *
 * the create path, which was UNREACHABLE for as long as
 * `currentSessionId()` read a `current` field the sessions list never
 * carried (dsh-api-session-controller publishes ids/byId/phase only)
 * ------------------------------------------------------------------ */
{
  // The predicate that nine create/ownership/archive guards compare against.
  {
    const emptyList = { byId: {}, ids: [], phase: 'ready' };
    const probeSession = stubUiSession('probe-1');
    const restoreProbe = mod.__bwTest.setTestRuntime({
      get: (name) => (name === 'uiSession' ? probeSession : undefined),
      sessions: { list: { getSnapshot: () => emptyList, subscribe: () => () => {} } },
    });
    assert.equal(mod.__bwTest.currentSessionId(), 'probe-1', 'the on-screen id comes from uiSession, not the list');
    probeSession.setKey('probe-2');
    assert.equal(mod.__bwTest.currentSessionId(), 'probe-2', 'and it follows a navigation');
    // A keyless binding answers undefined, and the list's (non-existent)
    // `current` field must not be consulted to fill the gap.
    const keyless = stubUiSession(undefined);
    mod.__bwTest.setTestRuntime({
      get: (name) => (name === 'uiSession' ? keyless : undefined),
      sessions: { list: { getSnapshot: () => ({ ...emptyList, current: 'stale-id' }), subscribe: () => () => {} } },
    });
    assert.equal(mod.__bwTest.currentSessionId(), undefined,
      'a keyless binding resolves to nothing rather than the legacy list field');
    restoreProbe();
  }

  // End to end: clicking create must actually send the request. With the old
  // predicate it never did — the guard returned before apiPost, so the click
  // produced no request, no busy state and no error at all.
  const createSessionId = 'create-1';
  let postedBody = null;
  const createStore = {
    snapshot: { items: [], archivedSessionIds: [], pinnedSessionIds: [], state: 'ready', phase: 'ready', error: null },
    listeners: new Set(),
    subscribe(listener) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; },
    getSnapshot() { return this.snapshot; },
  };
  const createUiSession = stubUiSession(createSessionId);
  // The source Session needs a READABLE COMPOSER: the create path captures the
  // source draft before it POSTs (the handoff moves that draft into the new
  // Session), and without one it refuses with "source composer is unavailable".
  // Same shape the smoke suite uses for draft transfer.
  let sourceDraftState = { draft: 'carry me', draftRev: 1, phase: 'plain', attachmentIds: [], occurrences: [] };
  const createInput = {
    state: { getSnapshot: () => sourceDraftState },
    setDraft(text) { sourceDraftState = { ...sourceDraftState, draft: text, draftRev: sourceDraftState.draftRev + 1 }; },
    addAttachments() { return false; },
    removeAttachment() { return false; },
  };
  const createConversation = { input: { for: () => createInput } };
  const createScope = { get: (name) => (name === 'conversation' ? createConversation : undefined) };
  // ONE snapshot object, never a rebuild per read: useSyncExternalStore treats a
  // fresh object as a change and re-renders forever otherwise (the rule this
  // change's own comment in heroDebugState keeps warning about).
  const createSessions = { byId: { [createSessionId]: { cwd: '/repo-create', title: 'C' } }, ids: [createSessionId], phase: 'ready' };
  // Third argument echoes interpolation params: with the default key-returning
  // stub a `hero.failed` message renders as the bare key and hides its cause.
  const restoreCreate = mod.__bwTest.setTestRuntime({
    get: (name) => (name === 'uiSession' ? createUiSession : undefined),
    sessions: { list: { getSnapshot: () => createSessions, subscribe: () => () => {} }, scope: () => createScope },
    workspaces: { list: createStore },
  }, null, (key, params) => (params && params.message ? key + ':' + params.message : key));
  const previousCreateFetch = window.fetch;
  const createRequests = [];
  window.fetch = async (url, options = {}) => {
    const parsed = new URL(String(url), window.location.href);
    createRequests.push((options.method || 'GET') + ' ' + parsed.pathname + parsed.search);
    if (parsed.pathname.endsWith('/detect')) {
      return { json: async () => ({ ok: true, isGit: true, isLinkedWorktree: false, managed: false }) };
    }
    if (parsed.pathname.endsWith('/branches')) {
      return { json: async () => ({ ok: true, current: 'main', branches: [{ name: 'main', hasLocal: true, hasRemote: false, current: true }] }) };
    }
    if (parsed.pathname.endsWith('/pulls')) return { json: async () => ({ ok: true, items: [] }) };
    if (parsed.pathname.endsWith('/worktrees') && options.method === 'POST') {
      postedBody = JSON.parse(String(options.body || '{}'));
      return { json: async () => ({ ok: false, error: 'boom', message: 'boom' }) };
    }
    throw new Error(`unexpected create request: ${parsed.pathname}${parsed.search}`);
  };
  globalThis.fetch = window.fetch;

  const createContainer = document.createElement('div');
  document.body.appendChild(createContainer);
  const createRoot2 = createRoot(createContainer);
  await act(async () => { createRoot2.render(React.createElement(mod.__bwTest.HeroControl)); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  await act(async () => { createContainer.querySelector('.dsh-bw-hero-btn').click(); });
  // the popover is state: it needs its own commit before its items exist
  await act(async () => { await Promise.resolve(); });
  const newItem = [...createContainer.querySelectorAll('.dsh-bw-menu-item')].find((i) => i.textContent.includes('hero.modeWorktree'));
  assert.ok(newItem, 'the mode menu offers 新建 worktree');
  await act(async () => { newItem.click(); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });

  const armedName = createContainer.querySelector('.dsh-bw-hero-input').value;
  assert.ok(armedName.length > 0, 'the form arms itself with a usable branch name');
  const submit = createContainer.querySelector('button.dsh-bw-btn-primary');
  assert.equal(submit.disabled, false, 'create is enabled as soon as the form opens');
  await act(async () => { submit.click(); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

  assert.ok(postedBody, 'clicking create POSTs /worktrees — saw: ' + createRequests.join(' | '));
  assert.equal(postedBody.branchName, armedName, 'the request carries the staged branch name');
  assert.equal(postedBody.sourceSessionId, createSessionId, 'and the source Session');
  assert.equal(typeof postedBody.txId, 'string', 'and its idempotency txId');
  assert.equal(postedBody.intent, 'branch-off', 'a branch-off intent, not a PR checkout');
  assert.match(createContainer.querySelector('.dsh-bw-hero-error[role="alert"]')?.textContent || '', /boom/,
    'a rejected creation surfaces the host message inline instead of failing silently');

  await act(async () => { createRoot2.unmount(); });
  createContainer.remove();
  window.fetch = previousCreateFetch;
  globalThis.fetch = window.fetch;
  restoreCreate();
}

/* ------------------------------------------------------------------ *
 * the two staged-create failures ADR 0016 fixes:
 *   1. a composer in a command state refused the draft handoff forever —
 *      the phase was read from the click-time snapshot, so the retry loop
 *      kept re-reading a frozen value while the worktree was already made;
 *   2. a handoff that failed AFTER the worktree, Workspace and Session
 *      existed was reported as a failed creation, in the Host's English.
 * ------------------------------------------------------------------ */
{
  // Interpolation-aware like the real dictionaries would be: a bare key hides
  // exactly the cause the copy exists to name.
  const translateKey = (key, params) => (params && params.reason ? key + ':' + params.reason
    : params && params.message ? key + ':' + params.message : key);

  async function heroCreateScenario({ draft = 'carry me', phase = 'plain', occurrences = [],
    targetReadable = true, postResponse } = {}) {
    const sessionId = 'hero-' + Math.random().toString(36).slice(2, 10);
    let sessionSnapshot = { byId: { [sessionId]: { cwd: '/repo-hero', title: 'Hero' } }, ids: [sessionId], phase: 'ready' };
    let sourceState = { draft, draftRev: 1, phase, attachmentIds: [], occurrences };
    const sourceInput = {
      state: { getSnapshot: () => sourceState },
      setDraft(text) { sourceState = { ...sourceState, draft: text, draftRev: sourceState.draftRev + 1 }; },
      addAttachments() { return false; },
      removeAttachment() { return false; },
    };
    let targetState = { draft: '', draftRev: 1, phase: 'plain', attachmentIds: [], occurrences: [] };
    const targetInput = {
      state: { getSnapshot: () => targetState },
      setDraft(text) { targetState = { ...targetState, draft: text, draftRev: targetState.draftRev + 1 }; },
      addAttachments() { return false; },
      removeAttachment() { return false; },
    };
    const calls = { posts: [], reveals: [], archived: [], retained: [], released: [], created: [], targetScopes: [] };
    const conversation = {
      input: {
        for(scope) {
          if (scope.id === sessionId) return sourceInput;
          calls.targetScopes.push(scope.id);
          return targetReadable ? targetInput : undefined;
        },
      },
      blocks: { set() {} },
    };
    // One stable snapshot object: useSyncExternalStore re-renders forever on a
    // fresh object per read.
    const workspaceStore = {
      snapshot: { items: [], archivedSessionIds: [], pinnedSessionIds: [], state: 'ready', phase: 'ready', error: null },
      subscribe() { return () => {}; },
      getSnapshot() { return this.snapshot; },
    };
    const uiSession = stubUiSession(sessionId);
    const restore = mod.__bwTest.setTestRuntime({
      get: (name) => {
        if (name === 'uiSession') return uiSession;
        if (name === 'uiWorkspace') return { openSession: (id) => calls.reveals.push(id) };
        if (name === 'conversation') return conversation;
        return undefined;
      },
      sessions: {
        list: { getSnapshot: () => sessionSnapshot, subscribe: () => () => {} },
        scope: (id) => ({ id, get: (name) => (name === 'conversation' ? conversation : undefined) }),
        // The real controller publishes the new Session into its catalog before
        // resolving, and refuses a second create of the same preallocated id —
        // which is exactly what a replayed txId converges on.
        create: async (opts) => {
          if (sessionSnapshot.byId[opts.sessionId]) throw new Error('session already exists: ' + opts.sessionId);
          sessionSnapshot = {
            ...sessionSnapshot,
            byId: { ...sessionSnapshot.byId, [opts.sessionId]: { cwd: '/wt/hero-branch', title: 'target' } },
            ids: [...sessionSnapshot.ids, opts.sessionId],
          };
          calls.created.push(opts.sessionId);
          return opts.sessionId;
        },
        retain: (id) => {
          calls.retained.push(id);
          return { ready: Promise.resolve(), release() { calls.released.push(id); } };
        },
      },
      workspaces: {
        list: workspaceStore,
        // The receipt's Workspace is looked up by path+id after the create.
        create: async (opts) => ({ workspaceId: 'ws-hero', path: opts.path }),
        rename: async () => {},
        archiveSession: async (id) => { calls.archived.push(id); },
      },
    }, null, translateKey);
    const previousFetch = window.fetch;
    window.fetch = async (url, options = {}) => {
      const parsed = new URL(String(url), window.location.href);
      if (parsed.pathname.endsWith('/detect')) {
        return { json: async () => ({ ok: true, isGit: true, isLinkedWorktree: false, managed: false }) };
      }
      if (parsed.pathname.endsWith('/branches')) {
        return { json: async () => ({ ok: true, current: 'main', branches: [{ name: 'main', hasLocal: true, hasRemote: false, current: true }] }) };
      }
      if (parsed.pathname.endsWith('/pulls')) return { json: async () => ({ ok: true, items: [] }) };
      if (parsed.pathname.endsWith('/worktrees') && options.method === 'POST') {
        calls.posts.push(JSON.parse(String(options.body || '{}')));
        return { json: async () => postResponse };
      }
      throw new Error(`unexpected hero create request: ${parsed.pathname}${parsed.search}`);
    };
    globalThis.fetch = window.fetch;
    const settle = async (ms = 0) => {
      await act(async () => {
        await new Promise((resolve) => { setTimeout(resolve, ms); });
        await Promise.resolve();
        await Promise.resolve();
      });
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => { root.render(React.createElement(mod.__bwTest.HeroControl)); });
    await settle();
    await act(async () => { container.querySelector('.dsh-bw-hero-btn').click(); });
    await settle();
    const newItem = [...container.querySelectorAll('.dsh-bw-menu-item')]
      .find((i) => i.textContent.includes('hero.modeWorktree'));
    await act(async () => { newItem.click(); });
    await settle();
    const clickCreate = async () => {
      await act(async () => { container.querySelector('button.dsh-bw-btn-primary').click(); });
    };
    await clickCreate();
    return {
      calls,
      container,
      sessionId,
      settle,
      clickCreate,
      setSourcePhase(next) { sourceState = { ...sourceState, phase: next }; },
      sourceDraft: () => sourceState.draft,
      targetDraft: () => targetState.draft,
      errorText: () => container.querySelector('.dsh-bw-hero-error[role="alert"]')?.textContent || '',
      record() {
        try { return JSON.parse(window.localStorage.getItem('dsh.better-workspaces.create.' + sessionId) || 'null'); } catch { return null; }
      },
      async cleanup() {
        await act(async () => { root.unmount(); });
        container.remove();
        window.fetch = previousFetch;
        globalThis.fetch = window.fetch;
        window.localStorage.removeItem('dsh.better-workspaces.create.' + sessionId);
        restore();
      },
    };
  }

  const receipt = { ok: true, path: '/wt/hero-branch', branch: 'hero-branch', workspaceId: 'ws-hero' };

  // A `claimed` composer is writable, so the draft follows the new Session —
  // the state that used to answer `source-not-plain` forever.
  {
    const scenario = await heroCreateScenario({ draft: '/plan carry me', phase: 'claimed', postResponse: receipt });
    await scenario.settle(80);
    assert.equal(scenario.calls.posts.length, 1, 'a claimed composer still creates');
    assert.equal(scenario.targetDraft(), '/plan carry me', 'and its draft is handed off');
    assert.equal(scenario.sourceDraft(), '', 'the source is cleared only after the target write');
    assert.deepEqual(scenario.calls.archived, [scenario.sessionId], 'a completed handoff retires the launcher');
    assert.deepEqual(scenario.calls.reveals, ['session-' + scenario.calls.posts[0].txId], 'and reveals the target');
    assert.equal(scenario.record(), null, 'a completed handoff drops the tx record');
    await scenario.cleanup();
  }

  // A submission still in flight is waited out BEFORE the request: the create
  // arrives once the composer settles instead of arriving with a draft that can
  // never follow it.
  {
    const scenario = await heroCreateScenario({ draft: 'mid submit', phase: 'submitting', postResponse: receipt });
    await scenario.settle(120);
    assert.equal(scenario.calls.posts.length, 0, 'the create waits for the composer instead of racing it');
    scenario.setSourcePhase('plain');
    await scenario.settle(400);
    assert.equal(scenario.calls.posts.length, 1, 'a settled composer lets the create proceed');
    assert.equal(scenario.targetDraft(), 'mid submit', 'and the draft still moves');
    await scenario.cleanup();
  }

  // A composer that never settles creates NOTHING: the refusal is before the
  // request, so there is no half-created worktree to explain afterwards.
  {
    const scenario = await heroCreateScenario({ draft: 'stuck', phase: 'submitting', postResponse: receipt });
    await scenario.settle(1800);
    assert.equal(scenario.calls.posts.length, 0, 'a composer that never settles never reaches the Host');
    assert.equal(scenario.errorText(), 'hero.sourceBusy', 'and the reason is the translated key, not a code');
    assert.equal(scenario.record(), null, 'nothing was minted for a request that was never sent');
    assert.equal(scenario.sourceDraft(), 'stuck', 'the draft stays exactly where the user left it');
    await scenario.cleanup();
  }

  // Committed creation, stranded draft: the worktree/Workspace/Session are real,
  // so this is NOT a failed creation. The source keeps the draft (and is not
  // archived), the notice names the reason, and Create again replays the SAME
  // txId to retry only the handoff.
  {
    const scenario = await heroCreateScenario({
      draft: 'see @issue',
      occurrences: [{ source: 'forge', ref: 'issue:1' }],
      postResponse: receipt,
    });
    await scenario.settle(120);
    assert.equal(scenario.calls.posts.length, 1, 'the creation itself is sent');
    assert.deepEqual(scenario.calls.archived, [], 'a stranded draft is never archived away');
    assert.deepEqual(scenario.calls.reveals, [], 'and the user stays where their draft is');
    assert.equal(scenario.errorText(), 'hero.draftStranded:hero.reasonSourceChips', 'the reason is named in the copy');
    assert.equal(scenario.record()?.txId, scenario.calls.posts[0].txId, 'the settled record is kept for the retry');
    await scenario.clickCreate();
    await scenario.settle(150);
    assert.equal(scenario.calls.posts.length, 2, 'the retry is a real request');
    assert.equal(scenario.calls.posts[1].txId, scenario.calls.posts[0].txId, 'and it replays the same transaction');
    assert.equal(scenario.calls.posts[1].branchName, scenario.calls.posts[0].branchName);
    assert.equal(scenario.calls.created.length, 1,
      'the target Session of the replayed txId converges instead of failing on "already exists"');
    assert.equal(scenario.errorText(), 'hero.draftStranded:hero.reasonSourceChips',
      'and the retry reports the same, still-true reason');
    await scenario.cleanup();
  }

  // The Host's admission refusal has a typed code: the English internal string
  // must never be what a user reads.
  {
    const scenario = await heroCreateScenario({
      postResponse: {
        ok: false,
        error: 'source_conflict',
        message: 'worktree: source session already owns another creation transaction',
      },
    });
    await scenario.settle(60);
    assert.equal(scenario.errorText(), 'hero.sourceConflict', 'a typed refusal renders its own copy');
    assert.ok(!scenario.errorText().includes('worktree:'), 'and never the Host sentence');
    assert.equal(scenario.calls.posts.length, 1, 'the record survives an unidentified outcome for the next retry');
    assert.ok(scenario.record(), 'so the same txId can be replayed');
    await scenario.cleanup();
  }

  // A CONFLICT is the one refusal the Host will answer identically forever: it
  // keeps the original transaction of that txId, so replaying it reproduces the
  // 409 and the branch name in the form never travels. Keeping the record made
  // Create a control that could only ever repeat this error; dropping it lets
  // the next click submit what is now selected.
  {
    const scenario = await heroCreateScenario({
      postResponse: { ok: false, error: 'transaction_conflict', txId: 'tx-conflict-0000000001' },
    });
    await scenario.settle(60);
    assert.equal(scenario.errorText(), 'hero.txConflict', 'the refusal is still reported, once');
    assert.equal(scenario.record(), null, 'the refused transaction is dropped, not kept for replay');
    await scenario.clickCreate();
    await scenario.settle(150);
    assert.equal(scenario.calls.posts.length, 2, 'the next Create reaches the Host');
    assert.notEqual(scenario.calls.posts[1].txId, scenario.calls.posts[0].txId,
      'and it is a NEW transaction: the refused txId is never resubmitted');
    await scenario.cleanup();
  }
}

/* The real component, in the state that matters: a blank Session whose cwd
   comes only from its Workspace membership. */
{
  // The Session is on screen (uiSession carries it) while its own cwd is still
  // absent — the state this control exists for. Membership is then the only way
  // it can find a directory. No fabricated `current`: the real list store never
  // carries that field and the control no longer reads it.
  const blankSnapshot = { byId: { s1: { title: 'blank' } }, ids: ['s1'], phase: 'ready' };
  const blankUiSession = stubUiSession('s1');
  const workspaceListeners = new Set();
  // `useSyncExternalStore` requires a stable snapshot identity: a store that
  // builds a fresh object per read would re-render forever, so this stand-in
  // owns one object exactly as the real controller does.
  let workspaceSnapshot = { items: [], phase: 'ready' };
  const setWorkspaces = (items) => {
    workspaceSnapshot = { items, phase: 'ready' };
    for (const listener of workspaceListeners) listener();
  };
  const restoreBlank = mod.__bwTest.setTestRuntime({
    get: (name) => (name === 'uiSession' ? blankUiSession : undefined),
    sessions: { list: { getSnapshot: () => blankSnapshot, subscribe: () => () => {} } },
    workspaces: {
      list: {
        getSnapshot: () => workspaceSnapshot,
        subscribe(listener) { workspaceListeners.add(listener); return () => workspaceListeners.delete(listener); },
      },
    },
  });
  const previousFetch = window.fetch;
  window.fetch = async (url) => {
    const parsed = new URL(String(url), window.location.href);
    if (parsed.pathname.endsWith('/detect') && parsed.searchParams.get('path') === '/repo-w1') {
      return { json: async () => ({ ok: true, isGit: true, isLinkedWorktree: false, managed: false }) };
    }
    throw new Error(`unexpected blank-hero request: ${parsed.pathname}${parsed.search}`);
  };
  globalThis.fetch = window.fetch;

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  // no membership yet → nothing, and no guess
  await act(async () => { root.render(React.createElement(mod.__bwTest.HeroControl)); });
  assert.equal(container.querySelector('.dsh-bw-hero-label'), null,
    'no Workspace membership and no cwd keeps the control hidden');

  // membership arrives, cwd is still absent from the Session
  await act(async () => {
    setWorkspaces([{ workspaceId: 'w1', path: '/repo-w1', title: 'W1', sessionIds: ['s1'] }]);
    await Promise.resolve();
    await Promise.resolve();
  });
  assert.equal(container.querySelector('.dsh-bw-hero-label')?.textContent, 'hero.modeLocal',
    'the control appears for a blank Session once its Workspace is known');

  // a linked worktree Workspace must stay hidden even though it resolves
  window.fetch = async (url) => {
    const parsed = new URL(String(url), window.location.href);
    if (parsed.pathname.endsWith('/detect') && parsed.searchParams.get('path') === '/repo-w2') {
      return { json: async () => ({ ok: true, isGit: true, isLinkedWorktree: true, managed: true }) };
    }
    throw new Error(`unexpected blank-hero request: ${parsed.pathname}${parsed.search}`);
  };
  globalThis.fetch = window.fetch;
  await act(async () => {
    setWorkspaces([{ workspaceId: 'w2', path: '/repo-w2', title: 'W2', sessionIds: ['s1'] }]);
    await Promise.resolve();
    await Promise.resolve();
  });
  assert.equal(container.querySelector('.dsh-bw-hero-label'), null,
    'a linked-worktree Workspace keeps hiding the control (staging inside one is not offered)');

  await act(async () => { root.unmount(); });
  container.remove();
  window.fetch = previousFetch;
  globalThis.fetch = window.fetch;
  restoreBlank();
}

/* `uiSession` is the one answer for the on-screen Session (ADR 0015). The legacy
   `sessions.list.current` field is not published by dsh-api-session-controller
   and must never be the reason a control appears — these cases pin that the
   binding alone decides, in both directions. */
{
  // Stable snapshot identities: `useSyncExternalStore` re-renders forever when a
  // reader builds a fresh object per call. The real stores own their objects.
  const noWorkspaces = { items: [], phase: 'ready' };
  const mkSnapshot = (extra) => ({ byId: { s1: { cwd: '/repo-x', title: 'X' } }, ids: ['s1'], ...extra, phase: 'ready' });
  const withLegacyCurrent = mkSnapshot({ current: 's1' });
  const withoutLegacyCurrent = mkSnapshot({});
  const cases = [
    {
      label: 'uiSession binding supplies the on-screen Session',
      uiSession: stubUiSession('s1'),
      snapshot: withoutLegacyCurrent,
      expect: 's1',
    },
    {
      label: 'a legacy sessions.list.current id is ignored when uiSession is absent',
      uiSession: undefined,
      snapshot: withLegacyCurrent,
      expect: undefined,
    },
    {
      label: 'a keyless uiSession binding resolves to nothing rather than a stale legacy id',
      uiSession: stubUiSession(undefined),
      snapshot: withLegacyCurrent,
      expect: undefined,
    },
  ];
  for (const { label, uiSession, snapshot, expect: expected } of cases) {
    const restore = mod.__bwTest.setTestRuntime({
      get: (name) => (name === 'uiSession' ? uiSession : undefined),
      sessions: { list: { getSnapshot: () => snapshot, subscribe: () => () => {} } },
      workspaces: {
        list: { getSnapshot: () => noWorkspaces, subscribe: () => () => {} },
      },
    });
    const previousFetch = window.fetch;
    window.fetch = async (url) => {
      const parsed = new URL(String(url), window.location.href);
      if (parsed.pathname.endsWith('/detect')) {
        return { json: async () => ({ ok: true, isGit: true, isLinkedWorktree: false, managed: false }) };
      }
      throw new Error(`unexpected request: ${parsed.pathname}${parsed.search}`);
    };
    globalThis.fetch = window.fetch;

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => { root.render(React.createElement(mod.__bwTest.HeroControl)); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    const source = mod.__bwTest.heroDebugState;
    // the observable it settled on is the assertion: a visible control for the
    // wrong Session would be worse than none
    if (expected === undefined) {
      assert.equal(source.mainViewKey, null, `${label}: no main-view key`);
      assert.equal(container.querySelector('.dsh-bw-hero-label'), null, `${label}: nothing renders`);
    } else {
      // uiSession's binding.key is the only authority (ADR 0015): there is no
      // second source to fall back to, so this equality is the whole assertion.
      assert.equal(source.mainViewKey, expected, `${label}: resolved Session id`);
    }

    await act(async () => { root.unmount(); });
    container.remove();
    window.fetch = previousFetch;
    globalThis.fetch = window.fetch;
    restore();
  }
}

// Mount a real hook-using component. This covers effect setup/cleanup, request
// cancellation, modal semantics, focus trapping and focus restoration with the
// same React runtime used by package consumers.
const prior = document.createElement('button');
prior.textContent = 'before picker';
document.body.appendChild(prior);
prior.focus();
let requestSignal = null;
window.fetch = async (_url, options = {}) => {
  requestSignal = options.signal;
  return {
    json: async () => ({
      ok: true,
      authState: 'authenticated',
      items: [{
        host: 'github.com', owner: 'acme', repo: 'widget', kind: 'change_request',
        number: 7, title: 'Fix focus', state: 'OPEN', fork: false,
      }],
    }),
  };
};
globalThis.fetch = window.fetch;
const attached = mod.__bwTest.encodeForgeRef({
  host: 'github.com', owner: 'acme', repo: 'widget', kind: 'change_request', number: 7,
});
let closeCount = 0;
const container = document.createElement('div');
document.body.appendChild(container);
const root = createRoot(container);
await act(async () => {
  root.render(React.createElement(mod.__bwTest.ForgePicker, {
    cwd: '/repo',
    attached: [attached],
    onClose: () => { closeCount += 1; },
    onPick: () => assert.fail('an attached row must not be selectable'),
  }));
  await Promise.resolve();
  await Promise.resolve();
});
const dialog = container.querySelector('[role="dialog"]');
assert.ok(dialog, 'the picker renders a dialog');
assert.equal(dialog.getAttribute('aria-modal'), 'true');
const search = dialog.querySelector('input');
const close = dialog.querySelector('.dsh-bw-forge-close');
const row = dialog.querySelector('.dsh-bw-forge-row');
assert.equal(document.activeElement, search, 'opening moves focus into the search field');
assert.equal(row.disabled, true, 'an attached forge row is disabled');
close.focus();
close.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
assert.equal(document.activeElement, search, 'Tab wraps from the last enabled control to the first');
document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
assert.equal(closeCount, 1, 'Escape requests picker closure');
await act(async () => { root.unmount(); });
assert.equal(requestSignal?.aborted, true, 'unmount aborts the picker request owner');
assert.equal(document.activeElement, prior, 'unmount restores the previously focused element');
container.remove();

/* ---------------- sidebar badge line: one per Workspace, under its title ---------------- *
 * Git state is a fact about the checkout, so the line belongs to the Workspace
 * row and is drawn once there instead of on every Session row inside it. The
 * injector appends a real React root into the shipped title column
 * (`_projectText`), which is a flex column: the line stacks under the title in
 * flow, and React's own trailing cells (row actions) stay outside that column,
 * which is why the old `order: 1` / late-mounted-time-cell dance is gone.
 *
 * This drives the real apply() wiring against the production row shape:
 *   div._projectRow[data-row-key="workspace:<id>"]
 *     span._slot._folder · span._slot._chevron
 *     span._projectText > span._title
 *     span._rowActions
 * --------------------------------------------------------------------------------------- */
const rowHost = document.createElement('div');
document.body.appendChild(rowHost);
function WorkspaceRow({ node, round }) {
  return React.createElement('div', {
    className: 'Rows_projectRow__t bw-ws-row',
    'data-row-key': `workspace:${node.workspaceId}`,
  },
    React.createElement('span', { className: 'Rows_slot__t Rows_folder__t' }),
    React.createElement('span', { className: 'Rows_slot__t Rows_chevron__t' }),
    // a changing key makes React replace the column node, which is the shape a
    // re-render can actually produce
    React.createElement('span', { className: 'Rows_projectText__t', key: `col-${round}` },
      React.createElement('span', { className: 'Rows_title__t' }, node.title)),
    React.createElement('span', { className: 'Rows_rowActions__t' }),
  );
}
function TitlelessRow() {
  return React.createElement('div', { className: 'Rows_projectRow__t bw-anchorless-row', 'data-row-key': 'workspace:ws-unknown' },
    React.createElement('span', { className: 'Rows_slot__t Rows_folder__t' }),
  );
}
function UntaggedRow({ title }) {
  // pre-`data-row-key` shells: only the title text identifies the row
  return React.createElement('div', { className: 'Rows_projectRow__t bw-untagged-row' },
    React.createElement('span', { className: 'Rows_slot__t Rows_folder__t' }),
    React.createElement('span', { className: 'Rows_projectText__t' },
      React.createElement('span', { className: 'Rows_title__t' }, title)),
  );
}
function UngroupedRow({ title }) {
  // the host's "Ungrouped" bucket is a project-shaped row with no Workspace id;
  // its display text is localized and can collide with a Workspace title
  return React.createElement('div', { className: 'Rows_projectRow__t bw-ungrouped-row', 'data-row-key': 'workspace:' },
    React.createElement('span', { className: 'Rows_slot__t Rows_folder__t' }),
    React.createElement('span', { className: 'Rows_projectText__t' },
      React.createElement('span', { className: 'Rows_title__t' }, title)),
  );
}
function SessionRow() {
  return React.createElement('div', { className: 'Rows_sessionRow__t bw-session-row' },
    React.createElement('span', { className: 'Rows_slot__t' }),
    React.createElement('span', { className: 'Rows_title__t' }, 'scratch'),
  );
}

const appliedEffects = [];
const sidebarSessions = {
  byId: { 'bw-regression-sess': { title: 'scratch' } },
  ids: ['bw-regression-sess'], current: 'bw-regression-sess', phase: 'ready',
};
/* Two Workspaces share the title `dupe`: a title-only row is ambiguous and must
   stay empty rather than show another repository's branch. `ws-ungrouped-name`
   exists so the ungrouped bucket's localized title collides with a real
   Workspace title — the row key, not the text, must decide. */
const rowWorkspaces = {
  items: [
    { workspaceId: 'ws-repo', title: 'repo', path: '/repo', sessionIds: ['bw-regression-sess'] },
    { workspaceId: 'ws-plain', title: 'plain', path: '/plain', sessionIds: [] },
    { workspaceId: 'ws-dupe-a', title: 'dupe', path: '/dupe-a', sessionIds: [] },
    { workspaceId: 'ws-dupe-b', title: 'dupe', path: '/dupe-b', sessionIds: [] },
    { workspaceId: 'ws-ungrouped-name', title: 'Ungrouped', path: '/ungrouped-name', sessionIds: [] },
  ],
};
const rowSidebarRightTabs = { register: () => () => {} };
const mockCtx = {
  sidebarRightTabs: rowSidebarRightTabs,
  effect(fn, label) {
    const dispose = fn(mockCtx);
    appliedEffects.push({ label, dispose });
    return dispose;
  },
  get(name) {
    if (name === 'sidebarRightTabs') return rowSidebarRightTabs;
    if (name === 'sidebarRight') return { openTab() {} };
    return undefined;
  },
  inject(deps, callback) {
    if (deps.includes('inputTriggers')) callback({ ...mockCtx, inputTriggers: { registerSource: () => () => {} } });
    else callback(mockCtx);
    return { dispose() {} };
  },
  locale: { register: () => () => {}, bind: () => (key) => key },
  slots: { inject(_name, registerFn) { registerFn(); return () => {}; }, register: () => () => {} },
  sessions: { list: { getSnapshot: () => sidebarSessions, subscribe: () => () => {} } },
  workspaces: { items: rowWorkspaces.items, list: { subscribe: () => () => {} } },
};

const ROW_BRANCH = 'feat/workspace-badge-line';
const CACHED_BRANCH = 'cached/from-last-visit';
/* The persistent snapshot cache (ADR 0018, amendment 1): the previous visit's
   answer must paint the line before this batch is answered, and the batch must
   then replace it. Seeding it here is exactly what a reload does. */
const SNAPSHOT_CACHE_KEY = mod.__bwTest.SNAPSHOT_CACHE_KEY;
window.localStorage.setItem(SNAPSHOT_CACHE_KEY, JSON.stringify({
  version: 1,
  savedAt: Date.now() - 60000,
  snapshots: {
    '/repo': { cwd: '/repo', at: Date.now() - 60000, isGit: true, branch: CACHED_BRANCH, diffStat: { additions: 7, deletions: 2 } },
    '/plain': { cwd: '/plain', at: Date.now() - 60000, isGit: false },
  },
  aliases: {},
}));
const previousFetch = window.fetch;
window.fetch = async (url) => {
  if (String(url).indexOf('/snapshots') !== -1) {
    // A cold host answers the first batch only after a compute wave; the delay
    // makes "painted from cache" observable instead of a race (the hydrate
    // deadline must stay well below this).
    await new Promise((resolve) => { setTimeout(resolve, 1200); });
    return {
      json: async () => ({
        ok: true,
        byCwd: {
          '/repo': {
            cwd: '/repo', at: Date.now(), isGit: true, mainRepoRoot: '/repo', branch: ROW_BRANCH,
            diffStat: { additions: 3, deletions: 1 }, upstream: { ahead: 2, behind: 0 },
          },
        },
      }),
    };
  }
  throw new Error('offline: the row scenario has no host');
};
globalThis.fetch = window.fetch;
const rowRoot = createRoot(rowHost);
let rowRound = 0;
const renderRows = () => rowRoot.render(React.createElement(React.Fragment, null,
  React.createElement(WorkspaceRow, { node: { workspaceId: 'ws-repo', title: 'repo' }, round: rowRound }),
  React.createElement(WorkspaceRow, { node: { workspaceId: 'ws-plain', title: 'plain' }, round: rowRound }),
  React.createElement(UntaggedRow, { title: 'dupe' }),
  React.createElement(TitlelessRow),
  React.createElement(UngroupedRow, { title: 'Ungrouped' }),
  React.createElement(SessionRow),
));
await act(async () => { renderRows(); });
await act(async () => { mod.apply(mockCtx); });

/* The diagnostic surface must exist while the plugin is mounted: it is the
   only way to separate "never injected" from "injected but hidden" in a bug
   report, so its presence and shape are part of the contract. */
{
  const hook = window.__dshBwDebug;
  assert.ok(hook, 'apply installs window.__dshBwDebug');
  for (const name of ['sessions', 'workspaces', 'hero', 'probe', 'describeOnScreen', 'badges']) {
    assert.equal(typeof hook[name], 'function', `__dshBwDebug.${name} is callable`);
  }
  // every reader must be total: a diagnostic that throws is worse than none
  assert.doesNotThrow(() => hook.sessions(), 'sessions() is safe before any session is seen');
  assert.doesNotThrow(() => hook.workspaces(), 'workspaces() is safe before any Workspace is seen');
  assert.doesNotThrow(() => hook.hero(), 'hero() is safe');
  assert.doesNotThrow(() => hook.probe(), 'probe() is safe');
  assert.doesNotThrow(() => hook.badges(), 'badges() is safe');
  const onScreen = hook.describeOnScreen();
  assert.equal(typeof onScreen.rowFound, 'boolean', 'describeOnScreen reports the DOM verdict');
  assert.ok(Object.hasOwn(onScreen, 'source'), 'the resolution source is reported');
  assert.ok(Object.hasOwn(onScreen, 'resolvedCwd'), 'the resolved cwd is reported');
}

const workspaceRow = rowHost.querySelector('[data-row-key="workspace:ws-repo"]');
const plainRow = rowHost.querySelector('[data-row-key="workspace:ws-plain"]');
const untaggedRow = rowHost.querySelector('.bw-untagged-row');
const titlelessRow = rowHost.querySelector('.bw-anchorless-row');
const ungroupedRow = rowHost.querySelector('.bw-ungrouped-row');
const sessionRow = rowHost.querySelector('.bw-session-row');
assert.ok(workspaceRow && plainRow && untaggedRow && titlelessRow && ungroupedRow && sessionRow,
  'every sidebar row shape rendered');

/* DOM nodes are compared through cheap strings: assert.equal on two jsdom
   elements deep-inspects both on failure, which is what makes a failing run
   explode instead of reporting. */
const columnOf = (row) => row.querySelector('[class*="_projectText"]');
const linesOf = (root) => root.querySelectorAll('.dsh-bw-badges');

assert.equal(linesOf(workspaceRow).length, 1, 'the Workspace row carries exactly one badge line');
assert.equal(linesOf(workspaceRow)[0].parentElement, columnOf(workspaceRow),
  'the line lives inside the shipped title column, so it stacks under the title');
assert.equal(linesOf(workspaceRow)[0].previousElementSibling, workspaceRow.querySelector('[class*="_title"]'),
  'the line sits directly below the title, not behind the row actions');
assert.equal(linesOf(sessionRow).length, 0,
  'Session rows carry no badge line any more — the Workspace row owns it');
assert.equal(linesOf(plainRow).length, 1, 'a non-git Workspace still gets its (empty) line holder');
assert.equal(linesOf(plainRow)[0].childNodes.length, 0,
  'a non-git Workspace leaves the holder empty, so the `:empty` rule keeps the row 34 px');
assert.equal(linesOf(untaggedRow).length, 0,
  'an ambiguous title (two Workspaces named "dupe") injects nothing rather than guessing');
assert.equal(linesOf(titlelessRow).length, 0,
  'a row without the title column degrades without injecting');
assert.equal(linesOf(ungroupedRow).length, 0,
  'the ungrouped bucket carries no row id, so a Workspace titled like it is never painted there');

/* Before the first batch is answered (the mock sleeps 1200 ms), the line must
   already show what the previous visit knew. This is the whole point of the
   cache: a cold host no longer means a blank row. */
await act(async () => {
  const hydrateDeadline = Date.now() + 700;
  while (!String(linesOf(workspaceRow)[0]?.textContent || '').includes(CACHED_BRANCH) && Date.now() < hydrateDeadline) {
    await new Promise((resolve) => { setTimeout(resolve, 10); });
  }
});
assert.ok(String(linesOf(workspaceRow)[0].textContent).includes(CACHED_BRANCH),
  'the badge line paints the cached snapshot before the batch answers');
assert.ok(String(linesOf(workspaceRow)[0].textContent).includes('+7'),
  'the cached diff stat is painted too');

/* The badge content itself comes from the git feed. The scheduler coalesces for
   250 ms before its first batch, and the mock host adds 1200 ms, so poll
   instead of assuming timing. */
await act(async () => {
  const contentDeadline = Date.now() + 5000;
  while (!String(linesOf(workspaceRow)[0]?.textContent || '').includes(ROW_BRANCH) && Date.now() < contentDeadline) {
    await new Promise((resolve) => { setTimeout(resolve, 25); });
  }
});
const line = linesOf(workspaceRow)[0];
assert.ok(String(line.textContent).includes(ROW_BRANCH), 'the line renders the workspace checkout branch');
assert.ok(String(line.textContent).includes('+3'), 'the line renders the diff stat');
assert.ok(String(line.textContent).includes('↑2'), 'the line renders the sync delta');
assert.ok(!String(line.textContent).includes(CACHED_BRANCH), 'the batch replaced the cached answer');
/* The debug surface must say where the line landed: "no row matched" and
   "injected into the wrong node" are otherwise indistinguishable from a blank
   paint when diagnosing a report. */
{
  const badgeProbe = window.__dshBwDebug.badges();
  const repoProbe = badgeProbe.rows.find((entry) => entry.rowKey === 'workspace:ws-repo');
  assert.ok(repoProbe, 'the probe reports the rendered Workspace row');
  assert.equal(repoProbe.hasTitleColumn, true, 'the probe reports the title column anchor');
  assert.equal(repoProbe.lineInTitleColumn, true, 'the probe reports the line inside the title column');
  const titlelessProbe = badgeProbe.rows.find((entry) => entry.rowKey === 'workspace:ws-unknown');
  assert.equal(titlelessProbe.hasTitleColumn, false, 'the probe reports a missing anchor instead of a blank row');
  assert.equal(titlelessProbe.lineText, null, 'a row without an anchor has no line to report');
  const ungroupedProbe = badgeProbe.rows.find((entry) => entry.rowKey === 'workspace:');
  assert.equal(ungroupedProbe.lineText, null, 'the ungrouped bucket is reported as having no line');
}

/* ...and the fresh answer is written back for the next visit. */
await act(async () => {
  const persistDeadline = Date.now() + 5000;
  const persisted = () => {
    try { return window.localStorage.getItem(SNAPSHOT_CACHE_KEY) || ''; } catch { return ''; }
  };
  while (!persisted().includes(ROW_BRANCH) && Date.now() < persistDeadline) {
    await new Promise((resolve) => { setTimeout(resolve, 25); });
  }
});
const persistedPayload = JSON.parse(window.localStorage.getItem(SNAPSHOT_CACHE_KEY));
assert.equal(persistedPayload.version, 1, 'the persisted payload is versioned');
assert.equal(persistedPayload.snapshots['/repo'].branch, ROW_BRANCH, 'the fresh branch is persisted for the next visit');
assert.equal(persistedPayload.snapshots['/plain'].isGit, false, 'non-git answers are persisted too, so they never re-probe');

/* A re-render can replace the title column; pass() must re-home/re-inject the
   line under the NEW column instead of leaving it behind or duplicating it. */
rowRound += 1;
await act(async () => { renderRows(); });
await act(async () => {
  const healDeadline = Date.now() + 3000;
  while (Date.now() < healDeadline) {
    const current = linesOf(workspaceRow);
    if (current.length === 1 && current[0].parentElement === columnOf(workspaceRow)) break;
    await new Promise((resolve) => { setTimeout(resolve, 25); });
  }
});
assert.equal(linesOf(workspaceRow).length, 1, 'a re-created title column still has exactly one line');
assert.equal(linesOf(workspaceRow)[0].parentElement, columnOf(workspaceRow),
  'the line followed the re-created title column');
assert.equal(linesOf(sessionRow).length, 0, 'the Session row still stays untouched after a re-render');

/* ------------------------------------------------------------------ *
 * hero injection anchors (ADR 0001 Amendment 1)
 *
 * Every slot is wrapped by the slot framework in an anchor div carrying
 * `data-slot` and `style="display: contents"`, so that wrapper — not the
 * layout row — is the slot's parentElement. Reading the row off
 * `parentElement` silently degraded the worktree control while every guard
 * still looked satisfied. This case renders the REAL production nesting
 * inside the live `apply` window.
 * ------------------------------------------------------------------ */
{
  const { isHeroRow, nearestLayoutAncestor } = mod.__bwTest;
  const row = document.createElement('div');
  row.className = 'wSkVaW_heroWorkspaceRow';
  const chip = document.createElement('button');
  chip.className = 'wSkVaW_chip';
  row.appendChild(chip);
  const outlet = document.createElement('div');
  outlet.setAttribute('data-slot', 'conversation.hero.agentPreset');
  outlet.style.display = 'contents';
  row.appendChild(outlet);
  document.body.appendChild(row);

  assert.equal(isHeroRow(nearestLayoutAncestor(outlet)), true,
    'climbing from the preset slot past the display:contents outlet reaches the hero row');

  // pass() runs on a 300 ms debounce behind the MutationObserver; poll so the
  // assertion is about the anchor logic, not about timing.
  await act(async () => {
    const heroDeadline = Date.now() + 2000;
    while (!row.querySelector(':scope > .dsh-bw-hero') && Date.now() < heroDeadline) {
      await new Promise((resolve) => { setTimeout(resolve, 25); });
    }
  });
  const injected = row.querySelector(':scope > .dsh-bw-hero');
  assert.ok(injected, 'the worktree control is injected into the hero row despite the slot outlet wrapper');
  assert.equal(row.querySelectorAll('.dsh-bw-hero').length, 1, 'exactly one control instance');
  assert.equal(injected.parentElement, row,
    'the control is a direct child of the layout row, not of the display:contents wrapper');

  const before = injected;
  await act(async () => {
    const settleDeadline = Date.now() + 1200;
    while (Date.now() < settleDeadline) await new Promise((resolve) => { setTimeout(resolve, 50); });
  });
  assert.equal(row.querySelector('.dsh-bw-hero'), before,
    'later passes reuse the same control element instead of remounting it');

  row.remove();
  assert.equal(document.querySelectorAll('.dsh-bw-hero').length, 0, 'removing the row drops the control');
}

const pluginStyle = document.querySelector('style[data-plugin-css="dsh-better-workspaces/client.css"]');
assert.ok(pluginStyle, 'the plugin stylesheet is mounted');
assert.equal(pluginStyle.dataset.plugin, '@ds-hu/dsh-better-workspaces',
  'the stylesheet carries the scoped module id DSH uses to evict this bundle\'s styles');
const badgesRule = /\.dsh-bw-badges\s*\{([^{}]*)\}/.exec(pluginStyle.textContent);
assert.ok(badgesRule, 'the badge line rule is present');
assert.ok(!/(^|[;\s])order:/.test(badgesRule[1]),
  'the badge line sits in flow inside the title column, so it no longer needs an order declaration');
const projectRowRule = /\[class\*="_projectRow"\]\s*\{([^{}]*)\}/.exec(pluginStyle.textContent);
assert.ok(projectRowRule, 'the Workspace row rule is present');
assert.ok(/height:\s*auto/.test(projectRowRule[1]),
  'the Workspace row stretches to fit the badge line under its title');
assert.ok(pluginStyle.textContent.indexOf('[class*="_sessionRow"]') === -1,
  'Session rows are left exactly as the shell renders them');
const emptyRule = /\.dsh-bw-badges:empty\s*\{([^{}]*)\}/.exec(pluginStyle.textContent);
assert.ok(emptyRule, 'an empty badge line is hidden');
assert.ok(/display:\s*none/.test(emptyRule[1]),
  'the empty line contributes no gap or padding to a non-git Workspace row');

const domEffect = appliedEffects.find((entry) => entry.label === 'better-workspaces: dom injection');
assert.ok(domEffect, 'the DOM injection effect is registered');
await act(async () => { domEffect.dispose(); });
assert.equal(document.querySelectorAll('.dsh-bw-badges').length, 0,
  'dispose removes every injected badge line (ADR 0001)');
for (const entry of [...appliedEffects].reverse()) {
  if (entry === domEffect) continue;
  if (entry.dispose) entry.dispose();
}
/* Cordis disposes effects LIFO: the injector unmounts every badge root (and
   calls untrack) before the feed's dispose flushes the cache. A teardown that
   dropped `byCwd` entries on untrack would store an empty payload here — the
   exact opposite of what the cache is for. */
{
  const survived = JSON.parse(window.localStorage.getItem(SNAPSHOT_CACHE_KEY) || 'null');
  assert.ok(survived && survived.snapshots && survived.snapshots['/repo'],
    'plugin teardown keeps the last known answers after every row untracked');
  assert.equal(survived.snapshots['/repo'].branch, ROW_BRANCH,
    'the last known branch survives teardown for the next visit');
}
assert.equal(window.__dshBwDebug, undefined,
  'disposing every effect removes the diagnostic global (no residue on window)');
assert.equal(document.querySelectorAll('style[data-plugin-css="dsh-better-workspaces/client.css"]').length, 1,
  'releasing the applied package keeps the surviving stylesheet reference');
await act(async () => { rowRoot.unmount(); });
rowHost.remove();
window.fetch = previousFetch;
globalThis.fetch = window.fetch;

releaseSecondCss();
assert.equal(document.querySelectorAll('style[data-plugin-css="dsh-better-workspaces/client.css"]').length, 0,
  'the final package cleanup removes the shared style');

/* ------------------------------------------------------------------ *
 * persistent snapshot cache, off the live window (ADR 0018 amendment 1)
 *
 * The cache is what makes a page load paint immediately; these cases pin the
 * rules that keep a stale or foreign payload from painting *wrong* data: only
 * version 1, only shaped snapshots, only within the age window, and bounded on
 * both count and bytes.
 * ------------------------------------------------------------------ */
{
  const {
    readSnapshotCache, writeSnapshotCache, snapshotCacheSignature,
    SNAPSHOT_CACHE_MAX, SNAPSHOT_CACHE_MAX_AGE_MS, SNAPSHOT_CACHE_MAX_BYTES,
  } = mod.__bwTest;
  const storage = window.localStorage;
  storage.removeItem(SNAPSHOT_CACHE_KEY);
  // cross-realm: the bundle's objects come from the jsdom realm, so compare JSON
  assert.equal(JSON.stringify(readSnapshotCache()), '{"byCwd":{},"aliases":{}}',
    'no cache means an empty store, not a throw');

  const now = Date.now();
  const state = {
    byCwd: {
      '/repo': { cwd: '/repo', isGit: true, at: now - 1000, branch: 'main', diffStat: { additions: 1, deletions: 2 } },
      '/plain': { cwd: '/plain', isGit: false, at: now - 500 },
      '/ancient': { cwd: '/ancient', isGit: true, at: now - SNAPSHOT_CACHE_MAX_AGE_MS - 1, branch: 'old' },
      '/future': { cwd: '/future', isGit: true, at: now + 120000, branch: 'future' },
      '/broken': { cwd: '/broken', at: now },
    },
    aliases: {
      '/sub': { root: '/repo', at: now - 1000 },
      '/old-sub': { root: '/repo', at: now - SNAPSHOT_CACHE_MAX_AGE_MS - 1 },
      '/bad': { root: '', at: now },
    },
  };
  assert.equal(writeSnapshotCache(state), true, 'the cache is written');
  const hydrated = readSnapshotCache();
  assert.deepEqual(Object.keys(hydrated.byCwd).sort(), ['/plain', '/repo'],
    'expired, future-dated and unshaped entries are dropped, the rest hydrate');
  assert.equal(hydrated.byCwd['/repo'].branch, 'main', 'the snapshot is hydrated intact');
  assert.equal(JSON.stringify(hydrated.aliases), JSON.stringify({ '/sub': { root: '/repo', at: now - 1000 } }),
    'aliases hydrate within the age window; a self/empty or an expired alias does not');

  storage.setItem(SNAPSHOT_CACHE_KEY, '{not json');
  assert.equal(JSON.stringify(readSnapshotCache()), '{"byCwd":{},"aliases":{}}', 'a corrupt payload is ignored');
  storage.setItem(SNAPSHOT_CACHE_KEY, JSON.stringify({ version: 999, snapshots: { '/x': { isGit: true, at: now } } }));
  assert.equal(JSON.stringify(readSnapshotCache().byCwd), '{}', 'a foreign version is ignored');

  const many = { byCwd: {}, aliases: {} };
  for (let i = 0; i < SNAPSHOT_CACHE_MAX + 10; i += 1) {
    many.byCwd['/w' + i] = { cwd: '/w' + i, isGit: true, at: now - i };
  }
  writeSnapshotCache(many);
  const bounded = readSnapshotCache().byCwd;
  assert.equal(Object.keys(bounded).length, SNAPSHOT_CACHE_MAX,
    'the cache is bounded by count');
  assert.ok(Object.hasOwn(bounded, '/w0') && !Object.hasOwn(bounded, '/w' + SNAPSHOT_CACHE_MAX),
    'the kept set is the newest one, not an arbitrary set of the right size');

  // One oversized entry (a huge PR projection) must be dropped, not force the
  // whole cache down to nothing or fail the write.
  const heavy = {
    byCwd: {
      '/keep': { cwd: '/keep', isGit: true, at: now, branch: 'keep' },
      '/huge': { cwd: '/huge', isGit: true, at: now - 1, branch: 'x'.repeat(SNAPSHOT_CACHE_MAX_BYTES) },
    },
    aliases: {},
  };
  assert.equal(writeSnapshotCache(heavy), true, 'the write still succeeds');
  const afterHeavy = readSnapshotCache().byCwd;
  assert.ok(Object.hasOwn(afterHeavy, '/keep') && !Object.hasOwn(afterHeavy, '/huge'),
    'the byte bound evicts the oversized entry and keeps the small one');
  assert.equal(snapshotCacheSignature({ byCwd: { a: { at: 1 } }, aliases: {} }), 'a@1#',
    'the signature changes with the answers, not with unrelated store fields');
  storage.removeItem(SNAPSHOT_CACHE_KEY);
}

/* ------------------------------------------------------------------ *
 * hero anchor helpers, off the live window (no app runtime needed —
 * these exercise the climb and the degrade path, not HeroControl).
 * ------------------------------------------------------------------ */
const { createHeroInjector, nearestLayoutAncestor: climb, isHeroRow: heroRowish } = mod.__bwTest;
// a display:contents outlet is skipped; the layout row behind it is returned
{
  const row = document.createElement('div');
  row.className = 'wSkVaW_heroWorkspaceRow';
  const outlet = document.createElement('div');
  outlet.style.display = 'contents';
  row.appendChild(outlet);
  document.body.appendChild(row);
  assert.equal(climb(outlet), row, 'the climb skips a display:contents wrapper');
  assert.equal(heroRowish(climb(outlet)), true, 'the climb lands on the hero row');

  // a wrapper that renders nothing owns no box either
  const empty = document.createElement('div');
  outlet.appendChild(empty);
  assert.equal(climb(empty), row, 'an empty emission wrapper is skipped too');

  // the depth cap stops a pathological tree instead of walking to document.body
  let deep = outlet;
  for (let i = 0; i < 12; i += 1) {
    const wrap = document.createElement('div');
    wrap.style.display = 'contents';
    deep.appendChild(wrap);
    deep = wrap;
  }
  assert.equal(climb(deep), null, 'the climb gives up past the depth cap rather than returning a wrong node');
  row.remove();
}

// negative: a hero row that is structurally unrecognizable must not receive a control
{
  const stray = document.createElement('div');
  stray.setAttribute('data-slot', 'conversation.hero.agentPreset');
  document.body.appendChild(stray);
  const injector = createHeroInjector();
  assert.doesNotThrow(() => injector.start(), 'a missing hero row degrades silently');
  await act(async () => { await new Promise((r) => setTimeout(r, 400)); });
  assert.equal(document.querySelectorAll('.dsh-bw-hero').length, 0, 'nothing is injected without a hero row');
  await act(async () => { injector.dispose(); });
  stray.remove();
}

dom.window.close();
console.log('CLIENT REACT: ALL PASS');
