/**
 * bw-worktree — host half of the composer 新建 worktree strip and the
 * right-sidebar 新建 worktree page.
 *
 * Owns the `worktree` route group. It also owns the background maintenance
 * scheduler (boot recovery and the hourly abandoned sweep): the scheduler's
 * unit of work is a managed worktree, so it lives with the row that can create
 * them (docs/ARCHITECTURE-modules.md §3). Creation itself is crash-safe
 * without it (`createWorktree` replays its own journal), so no other row
 * depends on this scheduler.
 */
import { acquireRuntime } from '@ds-hu/dsh-bw-core/engine.js';
import { createCleanupScheduler } from '@ds-hu/dsh-bw-core/index.js';

export const name = 'bw-worktree';
export const inject = ['webServer', 'workspaceRegistry'];

export function apply(ctx, config = {}) {
  const runtime = acquireRuntime(ctx, config);
  // Registered first so its disposer runs last: effects dispose in reverse
  // registration order, which gives the scheduler below a live runtime to use.
  ctx.effect(() => () => runtime.release(), 'bw-worktree: runtime lease');
  ctx.effect(() => runtime.claim(['worktree']), 'bw-worktree: routes');
  // Disposer order requirement: the sweep stops before the runtime lease is
  // released. The scheduler gets its own abort controller (not the runtime's
  // lifecycle) so turning this one row off cannot abort cleanup for rows that
  // stay mounted, and remounting later starts from a fresh, un-aborted signal.
  ctx.effect(() => {
    const sweepLifecycle = new AbortController();
    const scheduler = createCleanupScheduler(runtime.cleanup, {
      signal: sweepLifecycle.signal,
      onStop: () => sweepLifecycle.abort(),
    });
    return () => scheduler.dispose();
  }, 'bw-worktree: abandoned sweep');
}
