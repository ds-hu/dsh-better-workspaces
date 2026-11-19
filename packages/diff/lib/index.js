/**
 * bw-diff — host half of the right-sidebar 代码变更 page.
 *
 * Owns the `diff`, `file`, `actions` and `archive` route groups: the diff view
 * and file editor, the action ladder (commit/pull/push/PR), and the deferred
 * archive saga the ladder drives (docs/ARCHITECTURE-modules.md §5). It never
 * imports another feature package: everything shared is leased from
 * `@ds-hu/dsh-bw-core`, which owns the always-on data plane.
 */
import { acquireRuntime } from '@ds-hu/dsh-bw-core/engine.js';

export const name = 'bw-diff';
export const inject = ['webServer', 'workspaceRegistry'];

export function apply(ctx, config = {}) {
  // Synchronous on purpose: the row adds a lease and route claims to the
  // already-running root runtime (or creates it — the first row to mount does),
  // and must not throw when the row carries no config.
  const runtime = acquireRuntime(ctx, config);
  // Registered before the claim so disposing the row releases the claim before
  // the lease (Cordis disposes effects in reverse registration order).
  ctx.effect(() => () => runtime.release(), 'bw-diff: runtime lease');
  ctx.effect(() => runtime.claim(['diff', 'file', 'actions', 'archive']), 'bw-diff: routes');
}
