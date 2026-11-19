/**
 * The archive saga's cross-page block registry.
 *
 * While an archive transaction is in flight every Session it would retire is
 * blocked in the conversation service, so no other page can lose an unsent
 * draft to the deletion. The map is keyed by Session id and stores the request
 * token that owns the block; only that token may clear it.
 */
import { getAppCtx } from '@ds-hu/dsh-bw-core/client/runtime.js';

export const workspaceArchiveBlocks = new Map();

/** Clear the blocks this token still owns, restoring the composer. */
export function clearArchiveBlocks(sessionIds, token) {
  let conversation = null;
  const appCtx = getAppCtx();
  try { conversation = appCtx.get('conversation'); } catch { /* unavailable */ }
  for (const sessionId of sessionIds || []) {
    if (workspaceArchiveBlocks.get(sessionId) !== token) continue;
    workspaceArchiveBlocks.delete(sessionId);
    try { if (conversation && conversation.blocks) conversation.blocks.set(sessionId, undefined); } catch { /* teardown */ }
  }
}

/** Release every archive block (apply teardown). */
export function clearAllArchiveBlocks() {
  let conversation = null;
  const appCtx = getAppCtx();
  try { conversation = appCtx && appCtx.get('conversation'); } catch { /* unavailable */ }
  for (const sessionId of workspaceArchiveBlocks.keys()) {
    try { if (conversation && conversation.blocks) conversation.blocks.set(sessionId, undefined); } catch { /* teardown */ }
  }
  workspaceArchiveBlocks.clear();
}
