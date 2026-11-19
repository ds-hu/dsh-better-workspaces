/**
 * bw-forge — host half of the composer GitHub control and the right-sidebar
 * Issue 与 PR page.
 *
 * Owns no route group of its own: the picker and the page read the core data
 * plane (`/pull(s)` are read-only forge reads shared with worktree creation,
 * docs/ARCHITECTURE-modules.md §5). It still leases the runtime, so mounting
 * this row alone brings up the always-on data plane it needs — a row with no
 * routes is not a row without a runtime.
 */
import { acquireRuntime } from '@ds-hu/dsh-bw-core/engine.js';

export const name = 'bw-forge';
export const inject = ['webServer', 'workspaceRegistry'];

export function apply(ctx, config = {}) {
  const runtime = acquireRuntime(ctx, config);
  ctx.effect(() => () => runtime.release(), 'bw-forge: runtime lease');
  ctx.effect(() => runtime.claim([]), 'bw-forge: routes');
}
