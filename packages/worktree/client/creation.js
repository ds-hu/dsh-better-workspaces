/**
 * Worktree-creation bookkeeping owned by the `bw-worktree` bundle.
 *
 * The write itself is the host's `POST /worktrees`; this module holds the
 * idempotency receipt (survives a lost response and a reload), the draft-handoff
 * vocabulary and the pure validators the form and the tests share.
 */
import { failureMessage } from '@ds-hu/dsh-bw-core/client/util.js';

export const heroCreateTransactions = new Map();
export const heroCreateBlocks = new Map();
export const HERO_TX_PREFIX = 'dsh.better-workspaces.create.';

export function newCreationTxId() {
  try {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
  } catch { /* fallback below */ }
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

export function creationRequestKey(selection) {
  return JSON.stringify(selection);
}

export function heroCreationRequest(sourceId, selection, makeBody) {
  const requestKey = creationRequestKey(selection);
  let record = heroCreateTransactions.get(sourceId) || null;
  if (!record) {
    try { record = JSON.parse(localStorage.getItem(HERO_TX_PREFIX + sourceId) || 'null'); } catch { record = null; }
  }
  if (!record || typeof record.txId !== 'string' || !/^[A-Za-z0-9_-]{16,100}$/.test(record.txId)
    || !record.body || typeof record.body !== 'object' || Array.isArray(record.body)) {
    const txId = newCreationTxId();
    record = { requestKey, txId, targetSessionId: 'session-' + txId, body: makeBody() };
  } else if (record.requestKey !== requestKey && !record.settled) {
    /* Convergence, not staleness (ADR 0011): an UNSETTLED receipt must replay
     * as its ORIGINAL txId + body, so a changed selection deliberately keeps
     * submitting the stored request instead of minting a second worktree for
     * the same launcher.
     *
     * The escape hatch is the host, not this branch: when the original
     * transaction is gone the reply carries txState 'retired'/'absent', and
     * when it names a transaction the Host will never accept from this request
     * it answers `transaction_conflict`. Both are refusals no replay can
     * satisfy, so the caller releases the record (see
     * `releaseCreationTxOnFailure`) and the next attempt mints a fresh txId with
     * whatever is now selected.
     *
     * A SETTLED record (see `settleHeroCreationTx`) is a different animal: that
     * creation already committed, so a changed selection means "another
     * worktree", not "the same unknown transaction" — converging there would
     * silently create the OLD branch name. Re-submitting the SAME selection
     * keeps the txId, which is exactly the idempotent replay a retried draft
     * handoff needs.
     *
     * `selectionConflict` is kept purely as an inspection marker for
     * __dshBwDebug; nothing branches on it. */
    if (record.settled) {
      const txId = newCreationTxId();
      record = { requestKey, txId, targetSessionId: 'session-' + txId, body: makeBody() };
    } else {
      record = { ...record, selectionConflict: true };
    }
  }
  if (record.targetSessionId !== 'session-' + record.txId) {
    record = { ...record, targetSessionId: 'session-' + record.txId };
  }
  heroCreateTransactions.set(sourceId, record);
  try { localStorage.setItem(HERO_TX_PREFIX + sourceId, JSON.stringify(record)); } catch { /* memory fallback */ }
  return record;
}

/**
 * Remember that one transaction COMMITTED, while keeping its txId + body.
 *
 * The draft handoff can fail after the worktree, Workspace and Session already
 * exist. That is not a failed creation, so the record must survive a retry: the
 * same txId replays the same committed receipt, and only the handoff is
 * attempted again. `settled` is what keeps "retry this one" apart from "I now
 * want a different branch".
 */
export function settleHeroCreationTx(sourceId, txId, result) {
  const record = heroCreateTransactions.get(sourceId);
  if (!record || record.txId !== txId) return null;
  const settled = {
    ...record,
    settled: {
      at: Date.now(),
      path: typeof result?.path === 'string' ? result.path : null,
      branch: typeof result?.branch === 'string' ? result.branch : null,
      workspaceId: typeof result?.workspaceId === 'string' ? result.workspaceId : null,
    },
  };
  heroCreateTransactions.set(sourceId, settled);
  try { localStorage.setItem(HERO_TX_PREFIX + sourceId, JSON.stringify(settled)); } catch { /* memory fallback */ }
  return settled;
}

export function clearHeroCreationTx(sourceId, txId) {
  const record = heroCreateTransactions.get(sourceId);
  if (record && record.txId !== txId) return;
  heroCreateTransactions.delete(sourceId);
  try { localStorage.removeItem(HERO_TX_PREFIX + sourceId); } catch { /* memory-only */ }
}

/**
 * Drop the stored transaction after a refusal it can never satisfy.
 *
 * `retired` and `absent` say the Host has no such transaction at all.
 * `transaction_conflict` is the other dead end: the Host KEEPS the original
 * request of that txId — a receipt whose fingerprint is not this request's, a
 * checkout whose creation metadata names another transaction, a txId another
 * request already claimed — so this request can never be accepted, and every
 * replay answers the same 409 with the same sentence.
 *
 * Keeping the record there is a permanent lock: the convergence rule resubmits
 * this txId on every Create, so NO branch name the user types ever reaches the
 * Host and the control silently stops creating anything. Releasing it means the
 * next Create mints a fresh transaction from what is now selected, which is
 * exactly what the click asked for.
 *
 * `transaction_pending` is deliberately absent from this set: that transaction
 * is still in flight, and its own replay is what resolves it.
 */
export function releaseCreationTxOnFailure(sourceId, txId, result) {
  if (!result || typeof result !== 'object') return false;
  const spent = result.txState === 'retired' || result.txState === 'absent'
    || result.error === 'transaction_conflict';
  if (!spent) return false;
  clearHeroCreationTx(sourceId, txId);
  return true;
}

/**
 * The exact request one staged form submits (ADR 0014): the name is required
 * for a branch-off and the picked base travels WITH it. `slug` is gone: the
 * directory leaf derives from `<repo>-<branch>` on the host.
 * The `selection` half is the idempotency key; `body` is what is retried
 * verbatim after a lost response.
 */
export function stagedCreateRequest({ cwd, sourceId, sourceTitle, pull, name, baseRef }) {
  const selection = {
    cwd,
    intent: pull ? 'pr-checkout' : 'branch-off',
    branchName: pull ? null : String(name == null ? '' : name).trim(),
    base: pull ? null : baseRef || null,
    pull: pull ? {
      host: pull.host,
      owner: pull.owner,
      repo: pull.repo,
      number: pull.number,
      headRef: pull.headRefName,
      baseRef: pull.baseRefName || null,
      forkOwner: pull.fork && pull.headOwnerLogin ? pull.headOwnerLogin : null,
    } : null,
  };
  const body = {
    cwd,
    sourceSessionId: sourceId,
    intent: pull ? 'checkout' : 'branch-off',
    sourceTitle,
  };
  if (selection.pull) body.pull = selection.pull;
  else {
    body.branchName = selection.branchName;
    if (selection.base) body.base = selection.base;
  }
  return { selection, body };
}

/**
 * Why the staged branch name cannot be used, or null when it can: mirrors the
 * host's `isValidBranchName` (git check-ref-format) so the Create button
 * refuses before a round trip; the host stays the authority (a 422 still lands
 * in the form's error line).
 */
export function branchNameProblem(name) {
  const value = String(name == null ? '' : name).trim();
  if (value === '') return 'empty';
  if (value === '@' || value.length > 255) return 'invalid';
  if (/^[-/.]/.test(value) || /[/.]$/.test(value)) return 'invalid';
  if (value.includes('..') || value.includes('//') || value.includes('@{')) return 'invalid';
  if (value.split('/').some((part) => part === '' || part.startsWith('.') || part.endsWith('.lock'))) return 'invalid';
  // eslint-disable-next-line no-control-regex -- git forbids these bytes in refs
  if (/[\s~^:?*[\]\\\u0000-\u001f\u007f]/.test(value)) return 'invalid';
  return null;
}

/**
 * The single judge of whether the staged form may be submitted, and of which
 * reason to show when it may not: disabling the Create button and explaining
 * why MUST come from the same call.
 * @returns a dictionary key for the reason, or null when the name is usable.
 */
export function heroNameProblem(busy, pullPick, name) {
  if (busy) return null; // the button is disabled for the operation, not the name
  if (pullPick) return null; // a PR checkout supplies its own branch name
  const problem = branchNameProblem(name);
  if (problem === null) return null;
  return problem === 'empty' ? 'hero.nameRequired' : 'hero.nameInvalid';
}

/* One refusal reason from `lastDraftTransferReason` → the phrase a person
 * reads. The raw code stays available through __dshBwDebug and the tests; this
 * table is never the source of truth for behaviour. */
const DRAFT_REASON_KEYS = {
  'source-not-plain': 'hero.reasonSourceBusy',
  'source-changed-during-handoff': 'hero.reasonSourceChanged',
  'source-input-replaced': 'hero.reasonSourceReplaced',
  'source-input-unavailable': 'hero.reasonSourceUnreadable',
  'source-draft-unavailable': 'hero.reasonSourceUnreadable',
  'source-composer-unavailable': 'hero.reasonSourceUnreadable',
  'target-input-unavailable': 'hero.reasonTargetUnavailable',
  'target-not-plain': 'hero.reasonTargetBusy',
  'target-draft-not-empty': 'hero.reasonTargetNotEmpty',
  'target-has-attachments': 'hero.reasonTargetNotEmpty',
  'source-has-occurrences': 'hero.reasonSourceChips',
  'attachment-capability-missing': 'hero.reasonAttachmentsUnsupported',
  'target-attach-failed': 'hero.reasonAttachmentsFailed',
  'target-draft-write-failed': 'hero.reasonTargetWriteFailed',
  'source-clear-failed': 'hero.reasonSourceClearFailed',
  'source-detach-failed': 'hero.reasonSourceDetachFailed',
  'source-not-cleared': 'hero.reasonSourceNotCleared',
  'same-session': 'hero.reasonSameSession',
  unknown: 'hero.reasonUnknown',
};

export function draftReasonLabel(reason, translate) {
  return translate(DRAFT_REASON_KEYS[reason] || 'hero.reasonUnknown');
}

/* Reasons no retry can fix: the draft carries something the public
 * conversation API cannot rebuild (reference chips) or move (attachments with
 * no rebind capability), so the notice asks the user to carry the text over by
 * hand instead of inviting another attempt. */
export const DRAFT_UNTRANSFERABLE = new Set(['source-has-occurrences', 'attachment-capability-missing']);

export function draftHandoffNoticeKey(reason) {
  return DRAFT_UNTRANSFERABLE.has(reason) ? 'hero.draftStranded' : 'hero.draftStayed';
}

/* Typed Host refusals → the form's error line. The Host's `message` is an
 * English internal string; known codes win, the raw message stays the fallback
 * for anything this build does not know. */
const CREATE_FAILURE_KEYS = {
  source_conflict: 'hero.sourceConflict',
  transaction_pending: 'hero.txPending',
  transaction_conflict: 'hero.txConflict',
  creation_source_changed: 'hero.sourceChanged',
  transaction_retired: 'hero.txRetired',
};

export function createFailureText(result, translate) {
  const code = result && typeof result.error === 'string' ? result.error : '';
  const key = CREATE_FAILURE_KEYS[code];
  if (key) return translate(key);
  return translate('hero.failed', { message: failureMessage(result) || code || '?' });
}

/* form mode menu: two items, one active — 本地 (the workspace root IS the
 * repository checkout) vs 新建 worktree (staging). */
export function heroModeItems(staging, translate) {
  return [
    { id: 'local', label: translate('hero.modeLocal'), active: !staging },
    { id: 'new', label: translate('hero.modeWorktree'), active: staging },
  ];
}
