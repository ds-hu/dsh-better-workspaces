/**
 * `@ds-hu/dsh-bw-status` browser bundle.
 *
 * Always-on surfaces of module III (no sub-toggles):
 *   - the Workspace-row badge line injected into the shell sidebar, and
 *   - the composer diff pill (the one-click door to the 代码变更 page).
 *
 * It reads the shared data plane (`/snapshots`, `/events`, `/detect`) plus
 * `GET /worktree-workspaces`; it never calls another feature bundle.
 */
import { mountCss, BASE_CSS } from '@ds-hu/dsh-bw-core/client/css.js';
import { createGitFeed } from '@ds-hu/dsh-bw-core/client/feed.js';
import { registerLocale } from '@ds-hu/dsh-bw-core/client/i18n.js';
import {
  beginLifecycle, fenceLifecycle, getAppCtx, getFeed, setAppCtx, setFeed,
} from '@ds-hu/dsh-bw-core/client/runtime.js';
import { installDebugHook } from '@ds-hu/dsh-bw-core/client/debug.js';
import { coreTestExports } from '@ds-hu/dsh-bw-core/client/test-hooks.js';
import { STATUS_CSS } from './css.js';
import { zh, en } from './locale.js';
import { GitDiffPill, pillLabel, snapshotMutationKnown } from './pill.js';
import { createSidebarInjector, probeBadgeDom } from './sidebar-injector.js';

export const inject = ['slots', 'locale', 'sessions', 'workspaces'];

/** This bundle's locale namespace. */
const NS = 'bw-status';
/** This bundle's own stylesheet id (data-plugin-css / eviction id). */
const PLUGIN_CSS_ID = '@ds-hu/dsh-bw-status/client.css';

export function apply(ctx) {
  setAppCtx(ctx);
  const lifecycle = beginLifecycle();
  ctx.effect(() => mountCss(BASE_CSS + STATUS_CSS, PLUGIN_CSS_ID), 'bw-status: client styles');
  ctx.effect(() => () => fenceLifecycle(lifecycle), 'bw-status: client lifecycle fence');
  // Test-only read hook (see __bwTest): the offline suite has no real
  // conversation service, so it drives the pick path by handing the app ctx a
  // stand-in for it.
  ctx.__bwAppCtx = ctx;
  ctx.effect(() => () => { if (ctx.__bwAppCtx === ctx) delete ctx.__bwAppCtx; }, 'bw-status: test hook');
  ctx.effect(() => installDebugHook({ badges: probeBadgeDom }), 'bw-status: debug hook');
  const currentFeed = createGitFeed();
  setFeed(currentFeed);
  ctx.effect(() => () => {
    currentFeed.dispose();
    if (getFeed() === currentFeed) setFeed(null);
    if (getAppCtx() === ctx) setAppCtx(null);
  }, 'bw-status: feed');
  registerLocale(ctx, NS, { zh, en });

  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'git-diff-pill',
    order: -100,
    locale: NS,
    inject: (sessionId) => ({ sessionId }),
  }, GitDiffPill));

  const sidebar = createSidebarInjector(ctx);
  ctx.effect(() => {
    sidebar.start();
    return () => sidebar.dispose();
  }, 'bw-status: dom injection');
}

export const __bwTest = {
  ...coreTestExports(),
  mountCss: () => mountCss(BASE_CSS + STATUS_CSS, PLUGIN_CSS_ID),
  GitDiffPill,
  pillLabel,
  snapshotMutationKnown,
  probeBadgeDom,
};
