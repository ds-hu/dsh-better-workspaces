/**
 * `@ds-hu/dsh-bw-diff` browser bundle.
 *
 * The right-sidebar 代码变更 page (diff view + CAS file editor + action ladder +
 * archive saga) and the deferred-Workspace-recovery loop. Data comes from the
 * shared plane (`/snapshots`, `/events`, `/detect`) plus this row's routes
 * (`/diff`, `/commits`, `/file`, `/actions`, `/action`, `/worktrees/deferred`,
 * `/worktrees/finalize-delete`).
 */
import { mountCss, BASE_CSS } from '@ds-hu/dsh-bw-core/client/css.js';
import { createGitFeed } from '@ds-hu/dsh-bw-core/client/feed.js';
import { registerLocale } from '@ds-hu/dsh-bw-core/client/i18n.js';
import {
  beginLifecycle, fenceLifecycle, getAppCtx, getFeed, setAppCtx, setFeed,
} from '@ds-hu/dsh-bw-core/client/runtime.js';
import { clearTouchedCaches } from '@ds-hu/dsh-bw-core/client/draft.js';
import { clearWorkspaceCaches } from '@ds-hu/dsh-bw-core/client/workspace.js';
import { clearDetectCache } from '@ds-hu/dsh-bw-core/client/feed.js';
import { installDebugHook } from '@ds-hu/dsh-bw-core/client/debug.js';
import { coreTestExports } from '@ds-hu/dsh-bw-core/client/test-hooks.js';
import { DIFF_CSS } from './css.js';
import { zh, en } from './locale.js';
import { DiffView } from './view.js';
import { FileEditor } from './editor.js';
import { registerDiffPage, sidebarDiffDefinition, SIDEBAR_DIFF_ID, SIDEBAR_DIFF_KIND } from './sidebar-page.js';
import { registerDeferredRecovery } from './deferred.js';
import { clearAllArchiveBlocks } from './archive.js';

export const inject = ['slots', 'locale', 'sessions', 'workspaces'];

/** This bundle's locale namespace. */
const NS = 'bw-diff';
/** This bundle's own stylesheet id (data-plugin-css / eviction id). */
const PLUGIN_CSS_ID = '@ds-hu/dsh-bw-diff/client.css';

export function apply(ctx) {
  setAppCtx(ctx);
  const lifecycle = beginLifecycle();
  ctx.effect(() => mountCss(BASE_CSS + DIFF_CSS, PLUGIN_CSS_ID), 'bw-diff: client styles');
  ctx.effect(() => () => {
    fenceLifecycle(lifecycle);
    clearWorkspaceCaches();
    clearTouchedCaches();
    clearDetectCache();
    clearAllArchiveBlocks();
  }, 'bw-diff: client lifecycle fence');
  // Test-only read hook (see __bwTest): the offline suite has no real
  // conversation service, so it drives the action ladder by handing the app
  // ctx a stand-in for it.
  ctx.__bwAppCtx = ctx;
  ctx.effect(() => () => { if (ctx.__bwAppCtx === ctx) delete ctx.__bwAppCtx; }, 'bw-diff: test hook');
  ctx.effect(() => installDebugHook({
    sessions: () => {
      try { return getAppCtx().sessions.list.getSnapshot(); } catch { return null; }
    },
    workspaces: () => {
      try {
        const workspaces = getAppCtx().workspaces;
        return workspaces.list && workspaces.list.getSnapshot ? workspaces.list.getSnapshot() : { items: workspaces.items || [] };
      } catch { return null; }
    },
  }), 'bw-diff: debug hook');
  const currentFeed = createGitFeed();
  setFeed(currentFeed);
  ctx.effect(() => () => {
    currentFeed.dispose();
    if (getFeed() === currentFeed) setFeed(null);
    if (getAppCtx() === ctx) setAppCtx(null);
  }, 'bw-diff: feed');
  registerLocale(ctx, NS, { zh, en });

  registerDeferredRecovery(ctx);
  /* The diff view is an official right-Sidebar page type, not a conversation
     view. The registration waits for the sidebar's tab registry instead of
     declaring it in `inject`, so a dsh without a right sidebar keeps every
     other surface alive. */
  ctx.effect(() => registerDiffPage(ctx), 'bw-diff: sidebar page');
}

export const __bwTest = {
  ...coreTestExports(),
  mountCss: () => mountCss(BASE_CSS + DIFF_CSS, PLUGIN_CSS_ID),
  DiffView,
  FileEditor,
  sidebarDiffDefinition,
  SIDEBAR_DIFF_ID,
  SIDEBAR_DIFF_KIND,
};
