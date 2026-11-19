/**
 * The hero worktree control (`bw-worktree`).
 *
 * `HeroControl` resolves the on-screen Session's directory and hands it to
 * `HeroControlResource`, which owns the 本地 / 新建 worktree mode row. The row's
 * staging form is `WorktreeCreateForm`, shared with the sidebar page.
 */
import {
  h, react, useState, useEffect, useSyncExternalStore,
} from '@ds-hu/dsh-bw-core/client/react.js';
import {
  mainViewSessionFor, mainViewSessionId,
} from '@ds-hu/dsh-bw-core/client/session.js';
import { getAppCtx, getMainViewSessionSource } from '@ds-hu/dsh-bw-core/client/runtime.js';
import { detectPath } from '@ds-hu/dsh-bw-core/client/feed.js';
import { createRequestOwner } from '@ds-hu/dsh-bw-core/client/api.js';
import { basenameOf } from '@ds-hu/dsh-bw-core/client/util.js';
import { Popover, MenuList } from '@ds-hu/dsh-bw-core/client/ui.js';
import { BranchIcon } from '@ds-hu/dsh-bw-core/client/icons.js';
import { t } from '@ds-hu/dsh-bw-core/client/i18n.js';
import {
  workspaceItems as workspaceItemsNow, queueWorkspaceRename,
} from '@ds-hu/dsh-bw-core/client/workspace.js';
import {
  heroDebugState, heroResolve, heroControlKey, liveDetect,
  createHeroInjector,
} from './hero-data.js';
import { heroModeItems } from './creation.js';
import { WorktreeCreateForm } from './create-form.js';

/**
 * The seat's component: resolve the directory, then key the resource by it.
 *
 * No `listState.current` fallback: the sessions list never carried that field
 * (dsh-api-session-controller publishes ids/byId/phase/projectionsBySession
 * only), so uiSession's `binding.key` is the one answer, exactly as it is for
 * currentSessionId().
 */
export function HeroControl() {
  const appCtx = getAppCtx();
  const sessions = appCtx.sessions;
  const listState = useSyncExternalStore(
    (listener) => sessions.list.subscribe(listener),
    () => sessions.list.getSnapshot(),
    () => sessions.list.getSnapshot(),
  );
  // The authoritative source of the on-screen Session, subscribed
  // independently: it changes on navigation, not on store writes. The
  // apply-time capture is preferred; the app ctx is the fallback so a render
  // that precedes that effect still resolves.
  const mainViewSource = getMainViewSessionSource() ?? mainViewSessionFor(appCtx);
  const mainView = useSyncExternalStore(
    mainViewSource ? mainViewSource.subscribe : () => () => {},
    () => (mainViewSource ? mainViewSource.getSnapshot() : undefined),
    () => undefined,
  );
  const mainViewKey = mainViewSessionId(mainView);
  const currentId = mainViewKey;
  heroDebugState.mainViewKey = mainViewKey ?? null;
  heroDebugState.mainViewAvailable = Boolean(mainViewSource);
  const summary = currentId && listState.byId ? listState.byId[currentId] : undefined;
  // A second, independent subscription to the Workspace store: membership
  // decides the cwd for a Session that has none, and it can arrive after the
  // Session does. Each hook reads its own store's snapshot directly, because
  // `useSyncExternalStore` re-renders forever when `getSnapshot` returns a
  // freshly built object instead of the store's own.
  const workspacesList = appCtx.workspaces && appCtx.workspaces.list
    && typeof appCtx.workspaces.list.getSnapshot === 'function'
    ? appCtx.workspaces.list
    : null;
  const workspaceState = useSyncExternalStore(
    // MUST be called bound: `dsh-api-workspace-controller`'s
    // `WorkspaceListStore.subscribe` is a regular class method touching
    // `this.listeners`, so passing it detached made React call it with
    // `this === undefined` and throw during render.
    workspacesList && typeof workspacesList.subscribe === 'function'
      ? (listener) => workspacesList.subscribe(listener)
      : () => () => {},
    () => (workspacesList ? workspacesList.getSnapshot() : undefined),
    () => undefined,
  );
  const workspaceItems = workspaceState && Array.isArray(workspaceState.items) ? workspaceState.items : null;
  const resolved = heroResolve(summary, currentId, workspaceItems);
  heroDebugState.sessionSnapshot = listState;
  heroDebugState.workspaceSnapshot = workspaceState ?? null;
  heroDebugState.lastCwd = resolved.cwd;
  heroDebugState.lastSource = resolved.source;
  return h(HeroControlResource, {
    key: heroControlKey(currentId, resolved.cwd), sessions, currentId, summary, cwd: resolved.cwd,
  });
}

/**
 * The mode row: 本地 vs 新建 worktree (ADR 0002/0004 Phase A both entries; a
 * single-item menu stranded the user in the branch picker with no way back).
 * A linked worktree Session gets no hero control: it IS the pinned result.
 */
export function HeroControlResource(props) {
  const { currentId, summary, cwd } = props;
  // cwd-tagged detection: {cwd, value} — see liveDetect above
  const [detect, setDetect] = useState(null);
  const [staging, setStaging] = useState(false);
  const requestOwner = react.useRef(null);
  if (!requestOwner.current) requestOwner.current = createRequestOwner();

  useEffect(() => {
    requestOwner.current.reset();
    if (!cwd) {
      setDetect(null);
      return undefined;
    }
    const token = requestOwner.current.begin('detect');
    setDetect(null);
    detectPath(cwd, token.controller.signal)
      .then((value) => { if (requestOwner.current.owns(token)) setDetect({ cwd, sessionId: currentId, value }); })
      .catch(() => {})
      .finally(() => requestOwner.current.end(token));
    return () => requestOwner.current.abort(token);
  }, [cwd, currentId]);

  // never read a detection resolved for another cwd
  const det = liveDetect(detect, cwd, currentId);

  /* worktree-session workspace title follows EVERY session title, not just the
   * first one: dsh publishes a throwaway fallback title derived from the prompt
   * text immediately and the model's title about a second later, so a one-shot
   * latch froze sidebar rows on the fallback forever (ADR 0004 Amendment 6.B).
   * A title this plugin did not compose is a human's rename: left alone.
   * EVERY hook must run before the non-git early return below — hooks after a
   * conditional return crash the component with a hook-count mismatch. */
  const lastSyncedTitle = react.useRef(null);
  const summaryTitle = summary && typeof summary.title === 'string' ? summary.title : null;
  useEffect(() => {
    if (!cwd || !det || !det.isLinkedWorktree || !det.managed) return;
    const ws = workspaceItemsNow().find((w) => w.path === cwd);
    if (!ws) return;
    const prefix = det.sourceWorkspaceTitle || basenameOf(det.mainRepoRoot || det.repoRoot || cwd);
    const current = typeof ws.title === 'string' ? ws.title : '';
    const composed = prefix ? prefix + ' · ' : '';
    // self-heal rows created before provenance titles existed: a bare basename
    // title on a managed worktree gets its prefix back
    const healed = !summaryTitle && prefix && det.branch && current === basenameOf(cwd)
      ? composed + det.branch
      : null;
    const title = summaryTitle ? composed + summaryTitle : healed;
    if (!title || current === title) return;
    // only rewrite a title this plugin composed (or the untouched default row
    // title); a hand-picked workspace title is not ours to overwrite
    const ours = composed ? current.indexOf(composed) === 0 : current === basenameOf(cwd);
    if (!ours && !healed) return;
    const attempt = { workspaceId: ws.workspaceId, title };
    if (lastSyncedTitle.current
      && lastSyncedTitle.current.workspaceId === attempt.workspaceId
      && lastSyncedTitle.current.title === attempt.title) return;
    lastSyncedTitle.current = attempt;
    (async () => {
      try {
        const renamed = await queueWorkspaceRename(ws.workspaceId, title);
        if (!renamed && lastSyncedTitle.current === attempt) lastSyncedTitle.current = null;
      } catch {
        if (lastSyncedTitle.current === attempt) lastSyncedTitle.current = null;
      }
    })();
  }, [cwd, det, summaryTitle]);

  // worktree workspaces get no hero control: they ARE the pinned result —
  // staging another worktree from inside one is not a flow we offer. `cwd` may
  // come from the owning Workspace when the Session has none yet (see
  // heroCwdFor); `det` still decides whether that directory is an ordinary git
  // checkout worth offering worktrees for.
  heroDebugState.lastDetect = det;
  const visible = Boolean(cwd) && Boolean(det) && det.isGit === true && det.isLinkedWorktree !== true;
  heroDebugState.lastGuard = {
    visible,
    noCwd: !cwd,
    noDetect: !det,
    notGit: Boolean(det) && det.isGit !== true,
    linkedWorktree: Boolean(det) && det.isLinkedWorktree === true,
  };
  if (!visible) return null;

  if (!staging) {
    return h(Popover, {
      align: 'left',
      trigger: ({ open, toggle }) =>
        h('button', {
          type: 'button', className: 'dsh-bw-hero-btn', onClick: toggle,
          'aria-expanded': open, 'aria-label': t('hero.modeLocal'),
        },
        h(BranchIcon),
        h('span', { className: 'dsh-bw-hero-label' }, t('hero.modeLocal')),
        h('span', { className: 'dsh-bw-hero-chevron' }, '▾')),
      children: (close) =>
        h(MenuList, {
          items: heroModeItems(false, t),
          onSelect: (id) => {
            close();
            if (id === 'new') setStaging(true);
          },
        }),
    });
  }

  return h(react.Fragment, null,
    h(Popover, {
      align: 'left',
      trigger: ({ open, toggle }) =>
        h('button', {
          type: 'button', className: 'dsh-bw-hero-btn', onClick: toggle, 'aria-expanded': open,
          'aria-label': t('hero.modeWorktree'),
        },
        h(BranchIcon),
        h('span', { className: 'dsh-bw-hero-label' }, t('hero.modeWorktree')),
        h('span', { className: 'dsh-bw-hero-chevron' }, '▾')),
      children: (close) =>
        h(MenuList, {
          items: heroModeItems(true, t),
          onSelect: (id) => {
            close();
            if (id === 'local') setStaging(false);
          },
        }),
    }),
    // No onCreated: a committed creation reveals the target Session, which
    // re-keys this control; a stranded draft must keep the form (and its
    // notice) on screen exactly where the user's text still is.
    h(WorktreeCreateForm, {
      variant: 'hero',
      sessionId: currentId,
      cwd,
      visible: true,
      onClose: () => setStaging(false),
    }));
}

/**
 * Install the hero seat on the page.
 * @param ctx - the bundle's root context (the seat's effect is owned by it).
 * @returns a disposer releasing the injector.
 */
export function registerHeroControl(ctx) {
  const injector = createHeroInjector(HeroControl);
  const dispose = ctx.effect(() => {
    injector.start();
    return () => injector.dispose();
  }, 'bw-worktree: hero injection');
  return () => {
    try {
      if (typeof dispose === 'function') dispose();
      else if (dispose && typeof dispose.dispose === 'function') dispose.dispose();
    } catch { /* row teardown */ }
  };
}
