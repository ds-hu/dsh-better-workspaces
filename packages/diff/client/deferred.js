/**
 * Deferred Workspace deletion recovery.
 *
 * A crash between "host deleted the worktree" and "browser archived the
 * Workspace/session" leaves a durable tombstone. This loop replays those
 * tombstones, then backs off: an idle host pays nothing, a host with an
 * outstanding record is retried on the fast cadence.
 */
import {
  recoverDeferredWorkspaceDeletions,
  deferredRecoveryDelay,
} from '@ds-hu/dsh-bw-core/client/workspace.js';
import { DEFERRED_RECOVERY_IDLE_MS } from '@ds-hu/dsh-bw-core/client/feed.js';

/**
 * Start the recovery loop on the bundle's context.
 * @param ctx - the bundle's root context.
 */
export function registerDeferredRecovery(ctx) {
  ctx.effect(() => {
    const controller = new AbortController();
    let timer = null;
    let repeat = null;
    const run = () => {
      if (controller.signal.aborted) return;
      recoverDeferredWorkspaceDeletions(controller.signal)
        .then((pass) => {
          if (pass === null || controller.signal.aborted) return;
          // A host with no tombstones should not keep asking every 30 s: each
          // pass costs one authorized read per main checkout. A feed that has
          // not answered for every workspace yet is not that host.
          const delay = deferredRecoveryDelay(pass);
          if (repeat !== null) clearTimeout(repeat);
          repeat = setTimeout(() => { repeat = null; run(); }, delay);
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          if (repeat !== null) clearTimeout(repeat);
          repeat = setTimeout(() => { repeat = null; run(); }, DEFERRED_RECOVERY_IDLE_MS);
        });
    };
    const schedule = () => {
      if (controller.signal.aborted || timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        run();
      }, 0);
    };
    let unsubscribe = () => {};
    try {
      if (ctx.workspaces.list && typeof ctx.workspaces.list.subscribe === 'function') {
        unsubscribe = ctx.workspaces.list.subscribe(schedule) || unsubscribe;
      }
    } catch { /* one boot attempt still runs */ }
    schedule();
    return () => {
      controller.abort();
      if (repeat !== null) clearTimeout(repeat);
      if (timer !== null) clearTimeout(timer);
      try { unsubscribe(); } catch { /* ignore */ }
    };
  }, 'bw-diff: deferred Workspace recovery');
}
