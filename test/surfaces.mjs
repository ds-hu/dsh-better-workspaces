/**
 * The two new right-sidebar pages and the two row config pages, tested against
 * the CI-built bundles.
 *
 * The suite loads all four client bundles through one fake
 * `window.__ModuleLoader__` (the shipping contract) and materializes the
 * worktree and forge ones. It then drives:
 *
 *   1. the page/config registrars directly, so the shipped definitions (page
 *      id, kind, guide id/order, slot keys, config keys) are pinned;
 *   2. the bundles' `apply()`, so switching a surface pref off/on is proven to
 *      unregister/re-register exactly the affected surfaces on a live context;
 *   3. real react-dom renders of the captured page bodies and config pages, so
 *      "renders without throwing" and the key affordances' copy are verified
 *      with the same React runtime the page uses.
 *
 * Builds and test runs happen in CI only: this file expects
 * `packages/<feature>/lib/client.js` to exist.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
  url: 'http://127.0.0.1:3080/',
  runScripts: 'outside-only',
  virtualConsole: new VirtualConsole(),
});
const { window } = dom;
const { document } = window;
for (const key of ['window', 'document', 'navigator', 'MutationObserver', 'HTMLElement', 'Node', 'Event', 'KeyboardEvent', 'MouseEvent', 'AbortController']) {
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const ReactModule = await import('react');
const React = ReactModule.default;
const { act } = ReactModule;
const { createRoot } = await import('react-dom/client');

/* ------------------------------------------------------------------ *
 * The shipping page identities this suite pins. The diff page's own
 * constants are part of the contract the two new pages must not collide
 * with (its guide entry is what 新建 worktree / Issue 与 PR sit beside).
 * ------------------------------------------------------------------ */
const DIFF_PAGE = Object.freeze({
  id: 'dsh-better-workspaces/diff',
  kind: 'bw-diff',
  guide: 'diff',
});
const WORKTREE_PAGE = Object.freeze({
  id: 'dsh-better-workspaces/worktree',
  kind: 'bw-worktree',
  guide: 'worktree',
  order: 30,
});
const FORGE_PAGE = Object.freeze({
  id: 'dsh-better-workspaces/forge',
  kind: 'bw-forge',
  guide: 'forge',
  order: 40,
});
const WORKTREE_CONFIG_KEY = '@ds-hu/dsh-better-workspaces#bw-worktree';
const FORGE_CONFIG_KEY = '@ds-hu/dsh-better-workspaces#bw-forge';
const WORKTREE_CSS_ID = '@ds-hu/dsh-bw-worktree/sidebar.css';
const FORGE_CSS_ID = '@ds-hu/dsh-bw-forge/sidebar.css';

/* ------------------------------------------------------------------ *
 * 1. load the four CI-built bundles through the real loader contract
 * ------------------------------------------------------------------ */
const BUNDLES = Object.freeze([
  { feature: 'diff', id: '@ds-hu/dsh-bw-diff' },
  { feature: 'worktree', id: '@ds-hu/dsh-bw-worktree' },
  { feature: 'status', id: '@ds-hu/dsh-bw-status' },
  { feature: 'forge', id: '@ds-hu/dsh-bw-forge' },
]);
const entries = new Map();
window.__ModuleLoader__ = {
  load(entry) {
    entries.set(entry.id, entry);
  },
};
for (const bundle of BUNDLES) {
  const source = readFileSync(new URL('../packages/' + bundle.feature + '/lib/client.js', import.meta.url), 'utf8');
  window.eval(source);
  assert.ok(entries.has(bundle.id), bundle.id + ' registers itself with the ModuleLoader');
}

const clientRequire = (specifier) => {
  if (specifier === 'react') return React;
  if (specifier === 'react-dom/client') return { createRoot };
  // The module table's primitives package is an external the bundles may
  // declare but none of these surfaces import; an empty namespace keeps the
  // loader total without pretending to provide UI primitives.
  if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return {};
  throw new Error('unexpected client dependency: ' + specifier);
};

const worktreeModule = entries.get('@ds-hu/dsh-bw-worktree').factory(clientRequire);
const forgeModule = entries.get('@ds-hu/dsh-bw-forge').factory(clientRequire);
for (const [name, mod] of [['worktree', worktreeModule], ['forge', forgeModule]]) {
  assert.equal(typeof mod.apply, 'function', name + ' bundle exports apply');
  assert.ok(mod.__bwTest && typeof mod.__bwTest === 'object', name + ' bundle exposes __bwTest');
}
for (const [name, mod, registrars] of [
  ['worktree', worktreeModule, ['registerWorktreeSidebarPage', 'registerWorktreeConfigPage']],
  ['forge', forgeModule, ['registerForgeSidebarPage', 'registerForgeConfigPage']],
]) {
  assert.equal(typeof mod.inject, 'object', name + ' bundle declares its official service inject list');
  assert.ok(mod.inject.includes('slots') && mod.inject.includes('locale'), name + ' bundle injects slots + locale');
  for (const exportName of registrars) {
    assert.equal(typeof mod.__bwTest[exportName], 'function', name + ' __bwTest.' + exportName + ' is callable');
  }
  for (const exportName of ['setTestRuntime', 'createPrefs']) {
    assert.equal(typeof mod.__bwTest[exportName], 'function', name + ' __bwTest.' + exportName + ' is callable');
  }
  assert.equal(typeof mod.__bwTest.surfacePrefs, 'object', name + ' __bwTest.surfacePrefs is the surface store');
  for (const method of ['get', 'set', 'subscribe', 'reset']) {
    assert.equal(typeof mod.__bwTest.surfacePrefs[method], 'function', name + ' surfacePrefs.' + method + ' is callable');
  }
}

/* ------------------------------------------------------------------ *
 * a fake Cordis context: records every registration a surface makes, so
 * "registered", "unregistered" and "re-registered" are observable facts
 * ------------------------------------------------------------------ */
function makeDisposer(fn) {
  let done = false;
  const dispose = () => {
    if (done) return;
    done = true;
    fn();
  };
  dispose.dispose = dispose;
  return dispose;
}

function releaseValue(value) {
  if (!value) return;
  if (typeof value === 'function') {
    value();
    return;
  }
  if (typeof value.dispose === 'function') value.dispose();
}

function interpolateText(template, params) {
  if (typeof template !== 'string' || !params) return template;
  let out = template;
  for (const name of Object.keys(params)) out = out.split('{' + name + '}').join(String(params[name]));
  return out;
}

/** Mirror of dsh-client-ui-session's binding shape (ADR 0015). */
function stubUiSession(id) {
  let value = id === undefined
    ? { key: void 0, hooks: {}, keyedHooks: {}, props: {} }
    : { key: id, hooks: {}, keyedHooks: {}, props: {} };
  const listeners = new Set();
  return {
    current: {
      getSnapshot: () => value,
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    setKey(next) {
      value = next === undefined
        ? { key: void 0, hooks: {}, keyedHooks: {}, props: {} }
        : { key: next, hooks: {}, keyedHooks: {}, props: {} };
      for (const listener of listeners) listener();
    },
  };
}

function createFakeCtx(options = {}) {
  const record = {
    slots: [],
    tabs: [],
    sources: [],
    effects: [],
    locale: new Map(),
  };
  const sessionsSnapshot = options.sessionsSnapshot || {
    byId: { 'session-1': { cwd: '/repo', title: 'Repo' } },
    ids: ['session-1'],
    phase: 'ready',
  };
  const workspaceItems = options.workspaceItems || [];
  const workspaceSnapshot = { items: workspaceItems, archivedSessionIds: [], phase: 'ready' };
  const uiSession = options.uiSession || stubUiSession('session-1');
  const conversation = options.conversation || { input: { for: () => null } };

  const locale = {
    current: 'zh',
    register(ns, dictionaries) {
      record.locale.set(ns, dictionaries);
      return makeDisposer(() => {
        if (record.locale.get(ns) === dictionaries) record.locale.delete(ns);
      });
    },
    bind(ns) {
      return (key, params) => {
        const dictionaries = record.locale.get(ns);
        const template = dictionaries && dictionaries.zh && typeof dictionaries.zh[key] === 'string'
          ? dictionaries.zh[key]
          : key;
        return interpolateText(template, params);
      };
    },
  };

  const sidebarRightTabs = {
    register(definition) {
      record.tabs.push(definition);
      return makeDisposer(() => {
        const index = record.tabs.indexOf(definition);
        if (index >= 0) record.tabs.splice(index, 1);
      });
    },
  };

  const inputTriggers = {
    registerSource(source) {
      record.sources.push(source);
      return makeDisposer(() => {
        const index = record.sources.indexOf(source);
        if (index >= 0) record.sources.splice(index, 1);
      });
    },
  };

  const removeRecord = (list, entry) => {
    const index = list.indexOf(entry);
    if (index >= 0) list.splice(index, 1);
  };

  const slots = {
    register(definition = {}, component) {
      const entry = {
        name: definition.name,
        key: definition.key,
        id: definition.id,
        locale: definition.locale,
        definition,
        component,
      };
      record.slots.push(entry);
      return makeDisposer(() => removeRecord(record.slots, entry));
    },
    inject(name, callback) {
      const handle = callback();
      return makeDisposer(() => releaseValue(handle));
    },
  };

  const effect = (fn, label) => {
    const entry = { label: String(label || ''), active: true };
    record.effects.push(entry);
    const handle = fn();
    return makeDisposer(() => {
      entry.active = false;
      releaseValue(handle);
    });
  };

  const ctx = {
    record,
    locale,
    slots,
    sidebarRightTabs,
    inputTriggers,
    sessions: {
      list: {
        getSnapshot: () => sessionsSnapshot,
        subscribe: () => () => {},
      },
      scope: (id) => ({
        id,
        get: (name) => (name === 'conversation' ? conversation : undefined),
      }),
    },
    workspaces: {
      items: workspaceItems,
      list: {
        getSnapshot: () => workspaceSnapshot,
        subscribe: () => () => {},
      },
    },
    get(name) {
      if (name === 'uiSession') return uiSession;
      if (name === 'inputTriggers') return inputTriggers;
      if (name === 'sidebarRight') return { openTab() {} };
      if (name === 'conversation') return conversation;
      return undefined;
    },
    effect,
    inject(deps, callback) {
      const child = createScopedContext(ctx);
      const list = Array.isArray(deps) ? deps : [];
      if (list.includes('sidebarRightTabs')) child.sidebarRightTabs = sidebarRightTabs;
      if (list.includes('inputTriggers')) child.inputTriggers = inputTriggers;
      if (list.includes('sidebarRight')) child.sidebarRight = { openTab() {} };
      if (list.includes('slots')) child.slots = slots;
      if (list.includes('locale')) child.locale = locale;
      const handle = callback(child);
      return makeDisposer(() => {
        releaseValue(handle);
        child.releaseScope();
      });
    },
  };
  return ctx;
}

/**
 * One Cordis fibre: a child context whose registrations are owned by the
 * `inject` disposer that created it. This is what makes releasing
 * `ctx.inject(['inputTriggers'], …)` observable as "the composer surface went
 * away" instead of leaving orphaned slot/source/effect records behind.
 */
function createScopedContext(parent) {
  const owned = [];
  const child = Object.create(parent);
  const track = (handle) => {
    if (handle) owned.push(handle);
    return handle;
  };
  child.effect = (fn, label) => track(parent.effect(fn, label));
  child.slots = {
    register: (definition, component) => track(parent.slots.register(definition, component)),
    inject: (name, callback) => track(parent.slots.inject(name, callback)),
  };
  child.sidebarRightTabs = {
    register: (definition) => track(parent.sidebarRightTabs.register(definition)),
  };
  child.inputTriggers = {
    registerSource: (source) => track(parent.inputTriggers.registerSource(source)),
  };
  child.inject = (deps, callback) => track(parent.inject(deps, callback));
  child.releaseScope = () => {
    const handles = owned.splice(0).reverse();
    for (const handle of handles) releaseValue(handle);
  };
  return child;
}

/* ---- registration inventory / counts ---------------------------------- */
function inventory(ctx) {
  return {
    slots: ctx.record.slots
      .map((entry) => String(entry.name) + ':' + String(entry.key ?? entry.id ?? ''))
      .sort(),
    tabs: ctx.record.tabs
      .map((tab) => String(tab.id) + ':' + String(tab.kind))
      .sort(),
    effects: ctx.record.effects
      .filter((entry) => entry.active)
      .map((entry) => entry.label)
      .sort(),
    sources: ctx.record.sources
      .map((source) => String((source && source.name) || 'source'))
      .sort(),
  };
}

function signature(ctx) {
  return JSON.stringify(inventory(ctx));
}

function countSlot(ctx, name) {
  return ctx.record.slots.filter((entry) => entry.name === name).length;
}

function findSlot(ctx, name, key) {
  return ctx.record.slots.find((entry) => entry.name === name && (key === undefined || entry.key === key));
}

function findTab(ctx, id) {
  return ctx.record.tabs.find((tab) => tab.id === id);
}

function guidesOf(tab) {
  return Array.isArray(tab.guide) ? tab.guide : tab.guide ? [tab.guide] : [];
}

/* ------------------------------------------------------------------ *
 * 2. the shipped definitions and registrations (direct registrars)
 * ------------------------------------------------------------------ */
{
  const ctx = createFakeCtx();
  const disposePage = worktreeModule.__bwTest.registerWorktreeSidebarPage(ctx);

  const tab = findTab(ctx, WORKTREE_PAGE.id);
  assert.ok(tab, 'the worktree page type registers under its id');
  assert.equal(tab.kind, WORKTREE_PAGE.kind, 'the worktree tab type names its kind');
  assert.equal(tab.priority, 'extension', 'the worktree page is an extension page');
  const guides = guidesOf(tab);
  assert.equal(guides.length, 1, 'the worktree page declares exactly one guide entry');
  assert.equal(guides[0].id, WORKTREE_PAGE.guide, 'the worktree guide id');
  assert.equal(guides[0].order, WORKTREE_PAGE.order, 'the worktree guide order');
  assert.equal(typeof guides[0].title, 'function', 'the worktree guide title is lazy');
  assert.equal(typeof guides[0].description, 'function', 'the worktree guide description is lazy');
  assert.equal(typeof guides[0].icon, 'function', 'the worktree guide has its glyph');

  const bodyReg = findSlot(ctx, 'sidebar.right.pane.tab', WORKTREE_PAGE.id);
  const titleReg = findSlot(ctx, 'sidebar.right.pane.tab.title', WORKTREE_PAGE.id);
  assert.ok(bodyReg, 'the worktree page body registers into sidebar.right.pane.tab');
  assert.ok(titleReg, 'the worktree page chip title registers into sidebar.right.pane.tab.title');
  assert.equal(typeof bodyReg.component, 'function', 'the worktree page body is a component');
  assert.equal(typeof titleReg.component, 'function', 'the worktree page chip title is a component');
  assert.equal(typeof bodyReg.definition.inject, 'function', 'the body slot injects the Session id');
  assert.deepEqual(Object.keys(bodyReg.definition.inject('s-1')), ['sessionId'],
    'the body slot injects exactly { sessionId }');

  const style = document.querySelector('style[data-plugin-css="' + WORKTREE_CSS_ID + '"]');
  assert.ok(style, 'the worktree page mounts its own CSS under its own id');
  assert.match(String(style.textContent), /dsh-bw-sbw/, 'the worktree page CSS is present');

  disposePage();
  assert.equal(findTab(ctx, WORKTREE_PAGE.id), undefined, 'the worktree page type unregisters with its disposer');
  assert.equal(findSlot(ctx, 'sidebar.right.pane.tab', WORKTREE_PAGE.id), undefined);
  assert.equal(findSlot(ctx, 'sidebar.right.pane.tab.title', WORKTREE_PAGE.id), undefined);
  assert.equal(document.querySelector('style[data-plugin-css="' + WORKTREE_CSS_ID + '"]'), null,
    'the worktree page CSS tag is released with the page');
}
{
  const ctx = createFakeCtx();
  const disposePage = forgeModule.__bwTest.registerForgeSidebarPage(ctx);

  const tab = findTab(ctx, FORGE_PAGE.id);
  assert.ok(tab, 'the forge page type registers under its id');
  assert.equal(tab.kind, FORGE_PAGE.kind, 'the forge tab type names its kind');
  assert.equal(tab.priority, 'extension', 'the forge page is an extension page');
  const guides = guidesOf(tab);
  assert.equal(guides.length, 1, 'the forge page declares exactly one guide entry');
  assert.equal(guides[0].id, FORGE_PAGE.guide, 'the forge guide id');
  assert.equal(guides[0].order, FORGE_PAGE.order, 'the forge guide order');
  assert.equal(typeof guides[0].title, 'function', 'the forge guide title is lazy');
  assert.equal(typeof guides[0].description, 'function', 'the forge guide description is lazy');

  const bodyReg = findSlot(ctx, 'sidebar.right.pane.tab', FORGE_PAGE.id);
  const titleReg = findSlot(ctx, 'sidebar.right.pane.tab.title', FORGE_PAGE.id);
  assert.ok(bodyReg, 'the forge page body registers into sidebar.right.pane.tab');
  assert.ok(titleReg, 'the forge page chip title registers into sidebar.right.pane.tab.title');
  assert.equal(typeof bodyReg.component, 'function', 'the forge page body is a component');
  assert.equal(typeof titleReg.component, 'function', 'the forge page chip title is a component');

  const style = document.querySelector('style[data-plugin-css="' + FORGE_CSS_ID + '"]');
  assert.ok(style, 'the forge page mounts its own CSS under its own id');
  assert.match(String(style.textContent), /dsh-bw-sbf/, 'the forge page CSS is present');

  disposePage();
  assert.equal(findTab(ctx, FORGE_PAGE.id), undefined, 'the forge page type unregisters with its disposer');
  assert.equal(findSlot(ctx, 'sidebar.right.pane.tab', FORGE_PAGE.id), undefined);
  assert.equal(findSlot(ctx, 'sidebar.right.pane.tab.title', FORGE_PAGE.id), undefined);
  assert.equal(document.querySelector('style[data-plugin-css="' + FORGE_CSS_ID + '"]'), null,
    'the forge page CSS tag is released with the page');
}

// No guide/page identity may collide with 代码变更's, and the two new pages must
// not collide with each other: the sidebar de-duplicates guide entries by id.
assert.notEqual(WORKTREE_PAGE.id, DIFF_PAGE.id, 'the worktree page id differs from the diff page id');
assert.notEqual(FORGE_PAGE.id, DIFF_PAGE.id, 'the forge page id differs from the diff page id');
assert.notEqual(WORKTREE_PAGE.kind, DIFF_PAGE.kind, 'the worktree page kind differs from the diff page kind');
assert.notEqual(FORGE_PAGE.kind, DIFF_PAGE.kind, 'the forge page kind differs from the diff page kind');
assert.notEqual(WORKTREE_PAGE.guide, DIFF_PAGE.guide, 'the worktree guide id differs from the diff guide id');
assert.notEqual(FORGE_PAGE.guide, DIFF_PAGE.guide, 'the forge guide id differs from the diff guide id');
assert.notEqual(WORKTREE_PAGE.guide, FORGE_PAGE.guide, 'the two new guide ids differ from each other');
assert.notEqual(WORKTREE_PAGE.id, FORGE_PAGE.id, 'the two new page ids differ from each other');
assert.notEqual(WORKTREE_PAGE.kind, FORGE_PAGE.kind, 'the two new page kinds differ from each other');

// Row config pages register under the exact `<bundle>#<row>` keys.
{
  const ctx = createFakeCtx();
  const dispose = worktreeModule.__bwTest.registerWorktreeConfigPage(ctx);
  assert.equal(ctx.record.slots.length, 1, 'the worktree row registers exactly one config page');
  const entry = ctx.record.slots[0];
  assert.equal(entry.name, 'plugins.row.config');
  assert.equal(entry.key, WORKTREE_CONFIG_KEY, 'the worktree config key is <bundle>#bw-worktree');
  assert.equal(entry.locale, 'bw-worktree', 'the worktree config page binds the bw-worktree namespace');
  assert.equal(typeof entry.component, 'function', 'the worktree config page is a component');
  dispose();
  assert.equal(ctx.record.slots.length, 0, 'the worktree config page registers and disposes cleanly');
}
{
  const ctx = createFakeCtx();
  const dispose = forgeModule.__bwTest.registerForgeConfigPage(ctx);
  assert.equal(ctx.record.slots.length, 1, 'the forge row registers exactly one config page');
  const entry = ctx.record.slots[0];
  assert.equal(entry.name, 'plugins.row.config');
  assert.equal(entry.key, FORGE_CONFIG_KEY, 'the forge config key is <bundle>#bw-forge');
  assert.equal(entry.locale, 'bw-forge', 'the forge config page binds the bw-forge namespace');
  assert.equal(typeof entry.component, 'function', 'the forge config page is a component');
  dispose();
  assert.equal(ctx.record.slots.length, 0, 'the forge config page registers and disposes cleanly');
}

/* ------------------------------------------------------------------ *
 * 3. live surface switching: apply() on a fake ctx, then flip the prefs
 *    the row config page writes. Registration counts before/after pin
 *    "exactly the affected surfaces" — other surfaces are untouched.
 * ------------------------------------------------------------------ */
worktreeModule.__bwTest.surfacePrefs.reset();
forgeModule.__bwTest.surfacePrefs.reset();

const worktreeCtx = createFakeCtx();
const forgeCtx = createFakeCtx();
worktreeModule.apply(worktreeCtx);
forgeModule.apply(forgeCtx);

assert.equal(worktreeModule.__bwTest.surfacePrefs.get('hero'), true, 'worktree hero defaults on');
assert.equal(worktreeModule.__bwTest.surfacePrefs.get('sidebar'), true, 'worktree sidebar defaults on');
assert.equal(forgeModule.__bwTest.surfacePrefs.get('composer'), true, 'forge composer defaults on');
assert.equal(forgeModule.__bwTest.surfacePrefs.get('sidebar'), true, 'forge sidebar defaults on');

const worktreeBaseline = inventory(worktreeCtx);
const forgeBaseline = inventory(forgeCtx);

assert.equal(countSlot(worktreeCtx, 'plugins.row.config'), 1, 'the worktree config page is registered by apply');
assert.equal(countSlot(worktreeCtx, 'sidebar.right.pane.tab'), 1, 'the worktree page body is registered by apply');
assert.equal(countSlot(worktreeCtx, 'sidebar.right.pane.tab.title'), 1, 'the worktree page chip title is registered by apply');
assert.equal(findTab(worktreeCtx, WORKTREE_PAGE.id)?.kind, WORKTREE_PAGE.kind, 'the worktree page type is registered by apply');
assert.equal(countSlot(forgeCtx, 'plugins.row.config'), 1, 'the forge config page is registered by apply');
assert.equal(countSlot(forgeCtx, 'sidebar.right.pane.tab'), 1, 'the forge page body is registered by apply');
assert.equal(findTab(forgeCtx, FORGE_PAGE.id)?.kind, FORGE_PAGE.kind, 'the forge page type is registered by apply');

// Capture the live components while every surface is on; the render section
// below uses exactly the registrations apply() produced.
const worktreeBodyComponent = findSlot(worktreeCtx, 'sidebar.right.pane.tab', WORKTREE_PAGE.id).component;
const worktreeTitleComponent = findSlot(worktreeCtx, 'sidebar.right.pane.tab.title', WORKTREE_PAGE.id).component;
const worktreeConfigComponent = findSlot(worktreeCtx, 'plugins.row.config', WORKTREE_CONFIG_KEY).component;
const forgeBodyComponent = findSlot(forgeCtx, 'sidebar.right.pane.tab', FORGE_PAGE.id).component;
const forgeConfigComponent = findSlot(forgeCtx, 'plugins.row.config', FORGE_CONFIG_KEY).component;

// --- worktree: the sidebar page switch is exactly its three registrations ---
worktreeModule.__bwTest.surfacePrefs.set('sidebar', false);
assert.equal(countSlot(worktreeCtx, 'sidebar.right.pane.tab'), 0, 'switching the worktree page off releases its body slot');
assert.equal(countSlot(worktreeCtx, 'sidebar.right.pane.tab.title'), 0, 'switching the worktree page off releases its title slot');
assert.equal(findTab(worktreeCtx, WORKTREE_PAGE.id), undefined, 'switching the worktree page off releases its page type');
assert.equal(countSlot(worktreeCtx, 'plugins.row.config'), 1, 'the config page stays registered while a surface is off');
worktreeModule.__bwTest.surfacePrefs.set('sidebar', true);
assert.deepEqual(inventory(worktreeCtx), worktreeBaseline, 'switching the worktree page back restores exactly the same registrations');

// --- worktree: the hero switch only touches the hero surface ---
{
  const before = inventory(worktreeCtx);
  worktreeModule.__bwTest.surfacePrefs.set('hero', false);
  const off = inventory(worktreeCtx);
  assert.notDeepEqual(off, before, 'switching the hero control off releases its own registration(s)');
  assert.equal(countSlot(worktreeCtx, 'sidebar.right.pane.tab'), 1, 'the sidebar page is untouched by the hero switch');
  assert.equal(countSlot(worktreeCtx, 'plugins.row.config'), 1, 'the config page is untouched by the hero switch');
  worktreeModule.__bwTest.surfacePrefs.set('hero', true);
  assert.deepEqual(inventory(worktreeCtx), before, 'switching the hero control back restores exactly the same registrations');
}

// --- forge: the sidebar page switch is exactly its three registrations ---
forgeModule.__bwTest.surfacePrefs.set('sidebar', false);
assert.equal(countSlot(forgeCtx, 'sidebar.right.pane.tab'), 0, 'switching the forge page off releases its body slot');
assert.equal(countSlot(forgeCtx, 'sidebar.right.pane.tab.title'), 0, 'switching the forge page off releases its title slot');
assert.equal(findTab(forgeCtx, FORGE_PAGE.id), undefined, 'switching the forge page off releases its page type');
assert.equal(countSlot(forgeCtx, 'plugins.row.config'), 1, 'the forge config page survives its own page switch');
forgeModule.__bwTest.surfacePrefs.set('sidebar', true);
assert.deepEqual(inventory(forgeCtx), forgeBaseline, 'switching the forge page back restores exactly the same registrations');

// --- forge: the composer switch only touches the composer surface ---
{
  const before = inventory(forgeCtx);
  forgeModule.__bwTest.surfacePrefs.set('composer', false);
  const off = inventory(forgeCtx);
  assert.notDeepEqual(off, before, 'switching the composer control off releases its own registration(s)');
  assert.equal(countSlot(forgeCtx, 'sidebar.right.pane.tab'), 1, 'the forge page is untouched by the composer switch');
  assert.equal(countSlot(forgeCtx, 'plugins.row.config'), 1, 'the forge config page is untouched by the composer switch');
  forgeModule.__bwTest.surfacePrefs.set('composer', true);
  assert.deepEqual(inventory(forgeCtx), before, 'switching the composer control back restores exactly the same registrations');
}

// One row's surface switch never reaches the other row's context.
{
  const forgeBefore = signature(forgeCtx);
  worktreeModule.__bwTest.surfacePrefs.set('sidebar', false);
  assert.equal(signature(forgeCtx), forgeBefore, 'the worktree switch does not touch the forge surfaces');
  worktreeModule.__bwTest.surfacePrefs.set('sidebar', true);
  assert.deepEqual(inventory(worktreeCtx), worktreeBaseline, 'the worktree row is back to its baseline');
}

/* ------------------------------------------------------------------ *
 * 4. react-dom renders: the captured page bodies and config pages must
 *    render without throwing, and their user-facing copy must be real
 *    (the merged dictionaries, not bare keys).
 * ------------------------------------------------------------------ */
const API = '/better-workspaces/api';
const FORGE_ITEMS = [
  {
    kind: 'issue', number: 7, title: 'Fix something', state: 'OPEN',
    host: 'github.com', owner: 'acme', repo: 'widget',
    updatedAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
  },
  {
    kind: 'change_request', number: 9, title: 'Add a feature', state: 'OPEN', fork: false,
    host: 'github.com', owner: 'acme', repo: 'widget',
    updatedAt: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString(),
  },
];

const BASE_ROUTES = {
  ['GET ' + API + '/detect']: { ok: true, isGit: true, isLinkedWorktree: false, managed: false },
  ['GET ' + API + '/branches']: {
    ok: true, current: 'main', defaultBranch: 'main',
    branches: [{ name: 'main', hasLocal: true, hasRemote: false, current: true }],
  },
  ['GET ' + API + '/pulls']: { ok: true, authState: 'authenticated', items: FORGE_ITEMS },
  ['GET ' + API + '/worktrees']: { ok: true, items: [] },
  ['POST ' + API + '/snapshots']: { ok: true, byCwd: {} },
};

/** Install a fetch that answers the routes above; returns a restore function. */
function installFetch(overrides = {}) {
  const routes = { ...BASE_ROUTES, ...overrides };
  const previous = window.fetch;
  window.fetch = async (url, options = {}) => {
    const parsed = new URL(String(url), window.location.href);
    const key = String(options.method || 'GET') + ' ' + parsed.pathname;
    const route = routes[key] ?? routes[parsed.pathname];
    if (!route) throw new Error('unexpected request: ' + key + parsed.search);
    const payload = typeof route === 'function' ? route(parsed, options) : route;
    return { json: async () => payload };
  };
  globalThis.fetch = window.fetch;
  return () => {
    window.fetch = previous;
    globalThis.fetch = previous;
  };
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    await Promise.resolve();
  });
}

async function renderComponent(component, props) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(component, props));
    await Promise.resolve();
    await Promise.resolve();
  });
  return {
    container,
    async unmount() {
      await act(async () => { root.unmount(); });
      container.remove();
    },
  };
}

// --- the worktree page body ---
{
  const restore = installFetch();
  const view = await renderComponent(worktreeBodyComponent, {
    sessionId: 'session-1',
    useTabInfo: () => ({ tab: { visible: true, title: 'New worktree' } }),
  });
  await settle();
  const text = view.container.textContent || '';
  assert.match(text, /新建 worktree/, 'the worktree page body renders its title copy');
  assert.match(text, /隔离的 worktree/, 'the worktree page body renders its one-line description');
  assert.ok(view.container.querySelector('.dsh-bw-sbw'), 'the worktree page uses the sidebar-page panel class');
  assert.ok(view.container.querySelector('.dsh-bw-sbw-head'), 'the worktree page has a native panel header');
  assert.ok(view.container.querySelector('.dsh-bw-sbw-body'), 'the worktree page has a scrollable body');
  assert.equal(view.container.querySelector('.dsh-bw-pop-panel'), null, 'the page body has no popover chrome');
  await view.unmount();
  restore();
}

// --- the worktree config page: rows, labels and a live switch ---
{
  const view = await renderComponent(worktreeConfigComponent);
  await settle();
  const text = view.container.textContent || '';
  assert.match(text, /新建 worktree/, 'the worktree config page renders its title');
  assert.match(text, /输入框上方的「新建 worktree」/, 'the worktree config page labels the hero switch');
  assert.match(text, /右侧栏的「新建 worktree」页面/, 'the worktree config page labels the sidebar switch');
  const switches = view.container.querySelectorAll('[role="switch"]');
  assert.equal(switches.length, 2, 'the worktree config page renders two switches');
  assert.equal(switches[0].getAttribute('aria-checked'), 'true', 'the hero switch reflects the default on');
  assert.equal(switches[1].getAttribute('aria-checked'), 'true', 'the sidebar switch reflects the default on');

  const before = inventory(worktreeCtx);
  await act(async () => {
    switches[0].click();
    await Promise.resolve();
  });
  assert.equal(worktreeModule.__bwTest.surfacePrefs.get('hero'), false, 'clicking the switch writes the pref store');
  assert.equal(view.container.querySelectorAll('[role="switch"]')[0].getAttribute('aria-checked'), 'false',
    'the switch repaints from the pref store');
  assert.notDeepEqual(inventory(worktreeCtx), before, 'the hero surface is unregistered live, without a reload');
  await act(async () => {
    view.container.querySelectorAll('[role="switch"]')[0].click();
    await Promise.resolve();
  });
  assert.equal(worktreeModule.__bwTest.surfacePrefs.get('hero'), true, 'clicking again restores the pref');
  assert.deepEqual(inventory(worktreeCtx), before, 'the hero surface is re-registered live');

  // The sidebar switch uses the same live path and releases exactly its page.
  await act(async () => {
    view.container.querySelectorAll('[role="switch"]')[1].click();
    await Promise.resolve();
  });
  assert.equal(worktreeModule.__bwTest.surfacePrefs.get('sidebar'), false, 'the sidebar switch writes the pref store');
  assert.equal(countSlot(worktreeCtx, 'sidebar.right.pane.tab'), 0, 'the sidebar page body is unregistered live');
  assert.equal(findTab(worktreeCtx, WORKTREE_PAGE.id), undefined, 'the sidebar page type is released live');
  assert.equal(countSlot(worktreeCtx, 'plugins.row.config'), 1, 'the config page stays while its page is off');
  await act(async () => {
    view.container.querySelectorAll('[role="switch"]')[1].click();
    await Promise.resolve();
  });
  assert.equal(worktreeModule.__bwTest.surfacePrefs.get('sidebar'), true, 'clicking the sidebar switch back restores the pref');
  assert.deepEqual(inventory(worktreeCtx), before, 'the sidebar page is re-registered live');
  await view.unmount();
}

// --- the forge page body: a full-panel list, keyboard-reachable rows ---
{
  const restore = installFetch();
  const view = await renderComponent(forgeBodyComponent, {
    sessionId: 'session-1',
    useTabInfo: () => ({ tab: { visible: true, title: 'Issues & PRs' } }),
  });
  await settle();
  const text = view.container.textContent || '';
  assert.match(text, /Issue 与 PR/, 'the forge page body renders its title copy');
  assert.ok(view.container.querySelector('.dsh-bw-sbf'), 'the forge page uses the sidebar-page panel class');
  assert.ok(view.container.querySelector('.dsh-bw-sbf-head'), 'the forge page has a native panel header');
  const filter = view.container.querySelector('.dsh-bw-sbf-filter');
  assert.ok(filter, 'the forge page has its local filter input');
  assert.equal(filter.getAttribute('placeholder'), '筛选编号或标题', 'the filter input is localized');
  const refresh = view.container.querySelector('.dsh-bw-sbf-refresh');
  assert.ok(refresh, 'the forge page has a refresh button');
  assert.match(refresh.textContent || '', /刷新/, 'the refresh button is localized');

  await settle();
  const rows = [...view.container.querySelectorAll('button.dsh-bw-forge-row')];
  assert.equal(rows.length, 2, 'both issues/PRs render as real buttons');
  const kinds = [...view.container.querySelectorAll('.dsh-bw-sbf-kind')].map((node) => node.textContent);
  assert.deepEqual(kinds.sort(), ['Issue', 'PR'], 'every row carries its kind badge');
  assert.equal(view.container.querySelectorAll('.dsh-bw-sbf-time').length, 2, 'every row carries its updated time');
  assert.ok(view.container.textContent.includes('#7'), 'the issue number is on screen');
  assert.ok(view.container.textContent.includes('Fix something'), 'the issue title is on screen');
  await view.unmount();
  restore();
}

// --- the forge page body: a non-authenticated host renders its own copy ---
{
  const restore = installFetch({
    ['GET ' + API + '/pulls']: { ok: true, authState: 'unauthenticated', items: [] },
  });
  const view = await renderComponent(forgeBodyComponent, {
    sessionId: 'session-1',
    useTabInfo: () => ({ tab: { visible: true, title: 'Issues & PRs' } }),
  });
  await settle();
  assert.match(view.container.textContent || '', /gh 未登录/, 'an unauthenticated host renders its typed empty state');
  await view.unmount();
  restore();
}

// --- the forge config page: rows, labels and two switches ---
{
  const view = await renderComponent(forgeConfigComponent);
  await settle();
  const text = view.container.textContent || '';
  assert.match(text, /Issue 与 PR/, 'the forge config page renders its title');
  assert.match(text, /输入框里的 GitHub 图标/, 'the forge config page labels the composer switch');
  assert.match(text, /右侧栏的「Issue 与 PR」页面/, 'the forge config page labels the sidebar switch');
  const switches = view.container.querySelectorAll('[role="switch"]');
  assert.equal(switches.length, 2, 'the forge config page renders two switches');
  assert.equal(switches[0].getAttribute('aria-checked'), 'true', 'the composer switch reflects the default on');
  assert.equal(switches[1].getAttribute('aria-checked'), 'true', 'the sidebar switch reflects the default on');

  const before = inventory(forgeCtx);
  await act(async () => {
    switches[0].click();
    await Promise.resolve();
  });
  assert.equal(forgeModule.__bwTest.surfacePrefs.get('composer'), false, 'the composer switch writes the pref store');
  assert.equal(countSlot(forgeCtx, 'conversation.input.left'), 0, 'the composer control is unregistered live');
  assert.notDeepEqual(inventory(forgeCtx), before, 'the composer surface is unregistered live, without a reload');
  await act(async () => {
    view.container.querySelectorAll('[role="switch"]')[0].click();
    await Promise.resolve();
  });
  assert.deepEqual(inventory(forgeCtx), before, 'the composer surface is re-registered live');

  await act(async () => {
    view.container.querySelectorAll('[role="switch"]')[1].click();
    await Promise.resolve();
  });
  assert.equal(forgeModule.__bwTest.surfacePrefs.get('sidebar'), false, 'the sidebar switch writes the pref store');
  assert.equal(countSlot(forgeCtx, 'sidebar.right.pane.tab'), 0, 'the forge page body is unregistered live');
  assert.equal(findTab(forgeCtx, FORGE_PAGE.id), undefined, 'the forge page type is released live');
  assert.equal(countSlot(forgeCtx, 'plugins.row.config'), 1, 'the config page stays while its page is off');
  await act(async () => {
    view.container.querySelectorAll('[role="switch"]')[1].click();
    await Promise.resolve();
  });
  assert.equal(forgeModule.__bwTest.surfacePrefs.get('sidebar'), true, 'clicking the sidebar switch back restores the pref');
  assert.deepEqual(inventory(forgeCtx), before, 'the forge page is re-registered live');
  await view.unmount();
}

// The page chip titles render the glyph before the tab's captured title.
{
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(worktreeTitleComponent, { useTabInfo: () => ({ tab: { title: 'New worktree' } }) }));
    await Promise.resolve();
  });
  assert.ok(container.querySelector('svg'), 'the worktree chip title renders its glyph');
  assert.match(container.textContent || '', /New worktree/, 'the worktree chip title keeps the tab title');
  await act(async () => { root.unmount(); });
  container.remove();
}

// Leave no pref written for whatever suite runs after this file (the stores
// share one jsdom localStorage) and assert the defaults are back.
worktreeModule.__bwTest.surfacePrefs.reset();
forgeModule.__bwTest.surfacePrefs.reset();
assert.deepEqual(worktreeModule.__bwTest.surfacePrefs.get(), { hero: true, sidebar: true }, 'worktree prefs end at their defaults');
assert.deepEqual(forgeModule.__bwTest.surfacePrefs.get(), { composer: true, sidebar: true }, 'forge prefs end at their defaults');

process.stdout.write('surfaces: 2 new pages and 2 row config pages pass\n');
