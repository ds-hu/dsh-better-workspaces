/**
 * bw-status — host half of the Workspace-row badge line and the composer diff
 * pill.
 *
 * Owns the `status` route group: the managed-worktree ownership proof the
 * sidebar row uses to decide which Workspace is one of ours. Every other read
 * it needs comes from the always-on data plane of the root runtime.
 */
import { acquireRuntime } from '@ds-hu/dsh-bw-core/engine.js';

export const name = 'bw-status';
export const inject = ['webServer', 'workspaceRegistry'];

export function apply(ctx, config = {}) {
  const runtime = acquireRuntime(ctx, config);
  ctx.effect(() => () => runtime.release(), 'bw-status: runtime lease');
  ctx.effect(() => runtime.claim(['status']), 'bw-status: routes');
}
