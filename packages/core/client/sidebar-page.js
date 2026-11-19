/**
 * The shared right-sidebar page registrar.
 *
 * A page type is more than one registration: the tab registry needs the
 * definition (id/kind/title/guide), the pane body slot needs the component, and
 * the chip title slot needs its title renderer. The legacy diff page registered
 * all three inline; the two 0.4.0 pages and the diff page share this helper so
 * they cannot drift.
 *
 * The helper does the service-gated `ctx.inject(['sidebarRightTabs'], …)`
 * itself: a dsh without a right sidebar then keeps the rest of the bundle
 * alive, exactly like the legacy page did.
 */

function asFunction(value) {
  return typeof value === 'function' ? value : () => value;
}

/**
 * Normalize one page definition.
 * @param definition - `{ id, kind, title, guide, Body, Title, priority? }`.
 * @returns the shape `sidebarRightTabs.register` consumes.
 */
export function normalizeSidebarDefinition(definition) {
  const def = definition || {};
  const guide = def.guide === undefined ? [] : Array.isArray(def.guide) ? def.guide : [def.guide];
  return {
    id: def.id,
    kind: def.kind,
    priority: def.priority || 'extension',
    title: asFunction(def.title),
    guide: guide.map((entry) => ({
      ...entry,
      title: asFunction(entry.title),
      description: asFunction(entry.description),
    })),
  };
}

function release(value) {
  if (!value) return;
  try {
    if (typeof value === 'function') { value(); return; }
    if (typeof value.dispose === 'function') { value.dispose(); return; }
    if (typeof value[Symbol.dispose] === 'function') value[Symbol.dispose]();
  } catch { /* teardown must not throw */ }
}

/**
 * Register one sidebar page (tab type + body slot + title slot).
 *
 * @param ctx - the feature's ROOT context (the helper performs the gate).
 * @param definition - `{ id, kind, title, guide, Body, Title }`.
 * @returns an idempotent disposer releasing all three registrations.
 */
export function registerSidebarPage(ctx, definition) {
  const def = normalizeSidebarDefinition(definition);
  const label = String(def.id || 'sidebar page');
  let released = false;
  let fiber = null;

  const registerIn = (sidebarCtx) => {
    if (!sidebarCtx || typeof sidebarCtx.effect !== 'function') return () => {};
    const releases = [];
    releases.push(sidebarCtx.effect(
      () => sidebarCtx.sidebarRightTabs.register(def),
      label + ': tab type',
    ));
    if (sidebarCtx.slots && typeof sidebarCtx.slots.inject === 'function') {
      releases.push(sidebarCtx.slots.inject('sidebar.right.pane.tab', () => sidebarCtx.slots.register({
        name: 'sidebar.right.pane.tab',
        key: def.id,
        inject: (sessionId) => ({ sessionId }),
      }, definition.Body)));
      releases.push(sidebarCtx.slots.inject('sidebar.right.pane.tab.title', () => sidebarCtx.slots.register({
        name: 'sidebar.right.pane.tab.title',
        key: def.id,
      }, definition.Title)));
    }
    return () => {
      for (let i = releases.length - 1; i >= 0; i -= 1) release(releases[i]);
    };
  };

  if (ctx && typeof ctx.inject === 'function') {
    fiber = ctx.inject(['sidebarRightTabs'], registerIn);
  } else if (ctx && ctx.sidebarRightTabs) {
    release(registerIn(ctx));
  }

  return () => {
    if (released) return;
    released = true;
    release(fiber);
  };
}
