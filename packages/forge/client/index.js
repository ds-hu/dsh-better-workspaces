/**
 * `@ds-hu/dsh-bw-forge` browser bundle.
 *
 * Two surfaces of module III, gated by `surfacePrefs` and re-registered live:
 *   - the composer GitHub control (`conversation.input.left`) + its reference
 *     source, and
 *   - the Issue 与 PR right-sidebar page.
 * Plus the row's native config page, which is always on (it is how the two
 * surfaces above are switched).
 *
 * Data comes from this row's route (`GET /pulls`); the reference codec keeps
 * the chips submittable for as long as the row is mounted.
 */
import { mountCss, BASE_CSS } from '@ds-hu/dsh-bw-core/client/css.js';
import { createGitFeed } from '@ds-hu/dsh-bw-core/client/feed.js';
import { registerLocale, mergeDictionaries } from '@ds-hu/dsh-bw-core/client/i18n.js';
import {
  beginLifecycle, fenceLifecycle, getAppCtx, getFeed, setAppCtx, setFeed,
} from '@ds-hu/dsh-bw-core/client/runtime.js';
import { installDebugHook } from '@ds-hu/dsh-bw-core/client/debug.js';
import { coreTestExports } from '@ds-hu/dsh-bw-core/client/test-hooks.js';
import { surfacePrefs } from './prefs.js';
import { zh, en } from './locale.js';
import * as surfaceLocale from './surface-locale.js';
import { FORGE_CSS } from './css.js';
import {
  FORGE_SOURCE, forgeItems, forgeAttached, forgeDraftRehydration, forgeDraftBlocks,
  encodeForgeRef, decodeForgeRef, forgeClipboardText, embeddedForgeDraft,
  readForgeDraftSidecar, writeForgeDraftSidecar, settleForgeDraftSidecar,
  setForgeDraftBlock, forgeItemKey, cacheForgeItem, rememberForgeItem,
  forgeItemLabel, resolveForgeSessionInput, referenceDetectEnd, forgeInsertSpan,
  attachForgeReference, renderForgeReferenceText, fetchForgeItem, loadForgeItemDetail,
  forgeTrace, forgeDebugOn,
} from './forge-data.js';
import { ForgePicker } from './picker.js';
import { ForgeAttachControl, createForgeSource, registerForgeComposer } from './composer.js';
import {
  useForgeItems, ForgeItemRow,
} from './picker-parts.js';
import {
  registerForgeSidebarPage, forgeSidebarDefinition, FORGE_SIDEBAR_ID,
  FORGE_SIDEBAR_KIND, FORGE_GUIDE_ID, FORGE_SIDEBAR_CSS_ID, ForgeGlyph,
} from './sidebar-page.js';
import { registerForgeConfigPage, ForgeConfigPage } from './config-page.js';

export const inject = ['slots', 'locale', 'sessions', 'workspaces'];

/** This bundle's locale namespace. */
const NS = 'bw-forge';
/** This bundle's own stylesheet id (data-plugin-css / eviction id). */
const PLUGIN_CSS_ID = '@ds-hu/dsh-bw-forge/client.css';

export function apply(ctx) {
  setAppCtx(ctx);
  const lifecycle = beginLifecycle();
  ctx.effect(() => mountCss(BASE_CSS + FORGE_CSS, PLUGIN_CSS_ID), 'bw-forge: client styles');
  ctx.effect(() => () => {
    fenceLifecycle(lifecycle);
    forgeItems.clear();
    forgeAttached.clear();
    forgeDraftRehydration.clear();
    for (const sessionId of [...forgeDraftBlocks.keys()]) setForgeDraftBlock(sessionId, false);
    forgeDraftBlocks.clear();
  }, 'bw-forge: client lifecycle fence');
  // Test-only read hook (see __bwTest): the offline suite has no real
  // conversation service, so it drives the attach path by handing the app ctx a
  // stand-in for it.
  ctx.__bwAppCtx = ctx;
  ctx.effect(() => () => { if (ctx.__bwAppCtx === ctx) delete ctx.__bwAppCtx; }, 'bw-forge: test hook');
  // The forge surface has no page-global probes of its own; the hook is still
  // joined so a bundle order without the worktree/status rows keeps the join.
  ctx.effect(() => installDebugHook({}), 'bw-forge: debug hook');
  const currentFeed = createGitFeed();
  setFeed(currentFeed);
  ctx.effect(() => () => {
    currentFeed.dispose();
    if (getFeed() === currentFeed) setFeed(null);
    if (getAppCtx() === ctx) setAppCtx(null);
  }, 'bw-forge: feed');
  registerLocale(ctx, NS, mergeDictionaries({ zh, en }, surfaceLocale));

  // The row's native config page: always on, exactly once.
  ctx.effect(() => registerForgeConfigPage(ctx), 'bw-forge: config page');

  /* The two module-level surfaces are switched live from the config page. */
  const releases = new Map();
  const surfaces = ['composer', 'sidebar'];
  const release = (name) => {
    const dispose = releases.get(name);
    if (!dispose) return;
    releases.delete(name);
    try { dispose(); } catch { /* row teardown */ }
  };
  const mountSurface = (name) => {
    release(name);
    if (!surfacePrefs.get(name)) return;
    releases.set(name, name === 'composer'
      ? registerForgeComposer(ctx)
      : registerForgeSidebarPage(ctx));
  };
  ctx.effect(() => {
    surfaces.forEach(mountSurface);
    let previous = surfacePrefs.get();
    const unsubscribe = surfacePrefs.subscribe(() => {
      const current = surfacePrefs.get();
      for (const name of surfaces) {
        if (current[name] === previous[name]) continue;
        mountSurface(name);
      }
      previous = current;
    });
    return () => {
      try { unsubscribe && unsubscribe(); } catch { /* ignore */ }
      for (const name of surfaces) release(name);
    };
  }, 'bw-forge: surfaces');
}

export const __bwTest = {
  ...coreTestExports(),
  mountCss: () => mountCss(BASE_CSS + FORGE_CSS, PLUGIN_CSS_ID),
  surfacePrefs,
  registerForgeComposer,
  registerForgeSidebarPage,
  forgeSidebarDefinition,
  registerForgeConfigPage,
  ForgeConfigPage,
  FORGE_SIDEBAR_ID,
  FORGE_SIDEBAR_KIND,
  FORGE_GUIDE_ID,
  FORGE_SIDEBAR_CSS_ID,
  ForgeGlyph,
  FORGE_SOURCE,
  forgeItems,
  forgeAttached,
  forgeDraftRehydration,
  forgeDraftBlocks,
  encodeForgeRef,
  decodeForgeRef,
  forgeClipboardText,
  embeddedForgeDraft,
  readForgeDraftSidecar,
  writeForgeDraftSidecar,
  settleForgeDraftSidecar,
  setForgeDraftBlock,
  forgeItemKey,
  cacheForgeItem,
  rememberForgeItem,
  forgeItemLabel,
  resolveForgeSessionInput,
  referenceDetectEnd,
  forgeInsertSpan,
  attachForgeReference,
  renderForgeReferenceText,
  fetchForgeItem,
  loadForgeItemDetail,
  forgeTrace,
  forgeDebugOn,
  ForgePicker,
  ForgeAttachControl,
  createForgeSource,
  useForgeItems,
  ForgeItemRow,
};
