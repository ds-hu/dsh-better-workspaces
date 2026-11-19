/**
 * `@ds-hu/dsh-bw-worktree` browser bundle.
 *
 * Two surfaces of module III, gated by `surfacePrefs` and re-registered live:
 *   - the composer hero control (本地 / 新建 worktree) injected beside the shell's
 *     agent-preset row, and
 *   - the 新建 worktree right-sidebar page.
 * Plus the row's native config page, which is always on (it is how the two
 * surfaces above are switched).
 *
 * Data comes from the shared plane (`/detect`, `/snapshots`, `/events`) plus
 * this row's routes (`/branches`, `/pulls`, `/worktrees`).
 */
import { mountCss, BASE_CSS } from '@ds-hu/dsh-bw-core/client/css.js';
import { createGitFeed, clearDetectCache } from '@ds-hu/dsh-bw-core/client/feed.js';
import { registerLocale, mergeDictionaries } from '@ds-hu/dsh-bw-core/client/i18n.js';
import {
  beginLifecycle, fenceLifecycle, getAppCtx, getFeed, setAppCtx, setFeed,
} from '@ds-hu/dsh-bw-core/client/runtime.js';
import { clearTouchedCaches } from '@ds-hu/dsh-bw-core/client/draft.js';
import { clearWorkspaceCaches } from '@ds-hu/dsh-bw-core/client/workspace.js';
import { installDebugHook, projectSessionSnapshot, projectWorkspaceSnapshot } from '@ds-hu/dsh-bw-core/client/debug.js';
import { coreTestExports } from '@ds-hu/dsh-bw-core/client/test-hooks.js';
import { surfacePrefs } from './prefs.js';
import { zh, en } from './locale.js';
import * as surfaceLocale from './surface-locale.js';
import { WORKTREE_CSS } from './css.js';
import { HeroControl, HeroControlResource, registerHeroControl } from './hero.js';
import {
  heroDebugState, heroResolve, heroControlKey, heroCwdFor, heroWorkspacePathFor,
  liveDetect, isHeroRow, probeHeroDom, probeHeroResolution, createHeroInjector,
  nearestLayoutAncestor,
} from './hero-data.js';
import {
  WorktreeCreateForm, resolveWorktreeFormCwd,
} from './create-form.js';
import {
  heroCreateTransactions, heroCreateBlocks, HERO_TX_PREFIX,
  newCreationTxId, creationRequestKey, heroCreationRequest, settleHeroCreationTx,
  clearHeroCreationTx, releaseCreationTxOnFailure, stagedCreateRequest,
  branchNameProblem, heroNameProblem, draftReasonLabel, draftHandoffNoticeKey,
  createFailureText, heroModeItems, DRAFT_UNTRANSFERABLE,
} from './creation.js';
import {
  registerWorktreeSidebarPage, worktreeSidebarDefinition, WORKTREE_SIDEBAR_ID,
  WORKTREE_SIDEBAR_KIND, WORKTREE_GUIDE_ID, WORKTREE_SIDEBAR_CSS_ID, WorktreeGlyph,
} from './sidebar-page.js';
import { registerWorktreeConfigPage, WorktreeConfigPage } from './config-page.js';

export const inject = ['slots', 'locale', 'sessions', 'workspaces'];

/** This bundle's locale namespace. */
const NS = 'bw-worktree';
/** This bundle's own stylesheet id (data-plugin-css / eviction id). */
const PLUGIN_CSS_ID = '@ds-hu/dsh-bw-worktree/client.css';

export function apply(ctx) {
  setAppCtx(ctx);
  const lifecycle = beginLifecycle();
  ctx.effect(() => mountCss(BASE_CSS + WORKTREE_CSS, PLUGIN_CSS_ID), 'bw-worktree: client styles');
  ctx.effect(() => () => {
    fenceLifecycle(lifecycle);
    clearTouchedCaches();
    clearWorkspaceCaches();
    clearDetectCache();
  }, 'bw-worktree: client lifecycle fence');
  // Test-only read hook (see __bwTest): the offline suite has no real
  // conversation service, so it drives the creation path by handing the app
  // ctx a stand-in for it.
  ctx.__bwAppCtx = ctx;
  ctx.effect(() => () => { if (ctx.__bwAppCtx === ctx) delete ctx.__bwAppCtx; }, 'bw-worktree: test hook');
  ctx.effect(() => installDebugHook({
    sessions: () => projectSessionSnapshot(heroDebugState.sessionSnapshot),
    workspaces: () => projectWorkspaceSnapshot(heroDebugState.workspaceSnapshot),
    hero: () => probeHeroResolution(),
    heroDom: () => probeHeroDom(),
    probe: () => ({ dom: probeHeroDom(), resolution: probeHeroResolution() }),
    describeOnScreen: () => ({
      ...probeHeroResolution(),
      rowFound: probeHeroDom().rowFound,
      controlCount: probeHeroDom().controls.length,
    }),
    isHeroRow,
    heroCwdFor,
  }), 'bw-worktree: debug hook');
  const currentFeed = createGitFeed();
  setFeed(currentFeed);
  ctx.effect(() => () => {
    currentFeed.dispose();
    if (getFeed() === currentFeed) setFeed(null);
    if (getAppCtx() === ctx) setAppCtx(null);
  }, 'bw-worktree: feed');
  registerLocale(ctx, NS, mergeDictionaries({ zh, en }, surfaceLocale));

  // The row's native config page: always on, exactly once (it is how the two
  // surfaces below are switched).
  ctx.effect(() => registerWorktreeConfigPage(ctx), 'bw-worktree: config page');

  /* The two module-level surfaces are switched live from the config page. */
  const releases = new Map();
  const surfaces = ['hero', 'sidebar'];
  const release = (name) => {
    const dispose = releases.get(name);
    if (!dispose) return;
    releases.delete(name);
    try { dispose(); } catch { /* row teardown */ }
  };
  const mountSurface = (name) => {
    release(name);
    if (!surfacePrefs.get(name)) return;
    if (name === 'hero') releases.set(name, registerHeroControl(ctx));
    else releases.set(name, registerWorktreeSidebarPage(ctx));
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
  }, 'bw-worktree: surfaces');
}

export const __bwTest = {
  ...coreTestExports(),
  mountCss: () => mountCss(BASE_CSS + WORKTREE_CSS, PLUGIN_CSS_ID),
  surfacePrefs,
  HeroControl,
  HeroControlResource,
  registerHeroControl,
  createHeroInjector,
  WorktreeCreateForm,
  resolveWorktreeFormCwd,
  registerWorktreeSidebarPage,
  worktreeSidebarDefinition,
  registerWorktreeConfigPage,
  WorktreeConfigPage,
  WORKTREE_SIDEBAR_ID,
  WORKTREE_SIDEBAR_KIND,
  WORKTREE_GUIDE_ID,
  WORKTREE_SIDEBAR_CSS_ID,
  WorktreeGlyph,
  heroDebugState,
  heroResolve,
  heroControlKey,
  heroCwdFor,
  heroWorkspacePathFor,
  liveDetect,
  isHeroRow,
  probeHeroDom,
  probeHeroResolution,
  nearestLayoutAncestor,
  heroCreateTransactions,
  heroCreateBlocks,
  HERO_TX_PREFIX,
  newCreationTxId,
  creationRequestKey,
  heroCreationRequest,
  settleHeroCreationTx,
  clearHeroCreationTx,
  releaseCreationTxOnFailure,
  stagedCreateRequest,
  branchNameProblem,
  heroNameProblem,
  draftReasonLabel,
  draftHandoffNoticeKey,
  createFailureText,
  heroModeItems,
  DRAFT_UNTRANSFERABLE,
};
