/**
 * Draft reading, transfer and per-Session touched paths.
 *
 * A draft hand-off moves the composer payload (text + attachments) from the
 * launching Session to the freshly created one atomically; the create flow
 * depends on it, and the forge reference chip lives in the same input machine.
 */
import { getAppCtx } from './runtime.js';
import { setBoundedClientCache } from './util.js';
import {
  resolveSessionInput,
  inputSnapshot,
  setInputDraft,
  sameAttachmentIds,
  openSessionInMainView,
} from './session.js';

/* per-session attribution: the session log is the only per-session signal in a
 * shared workspace (git state is per-cwd). We page the official session log and
 * collect paths written by file-writing tools */
const WRITE_TOOL_NAMES = new Set(['edit', 'write', 'multiedit', 'notebookedit', 'str_replace_editor', 'str_replace_based_edit_tool']);

export function collectTouched(node, out, depth) {
  if (!node || depth > 8 || out.size > 500) return;
  if (Array.isArray(node)) {
    for (const item of node) collectTouched(item, out, depth + 1);
    return;
  }
  if (typeof node !== 'object') return;
  const name = typeof node.name === 'string' ? node.name : typeof node.toolName === 'string' ? node.toolName : null;
  if (name && WRITE_TOOL_NAMES.has(name.toLowerCase()) && node.input && typeof node.input === 'object') {
    for (const key of ['file_path', 'path', 'filePath']) {
      const v = node.input[key];
      if (typeof v === 'string' && v !== '') out.add(v);
    }
  }
  for (const key of Object.keys(node)) collectTouched(node[key], out, depth + 1);
}

export function normalizeTouchedPaths(found, cwd) {
  const out = new Set();
  const root = cwd.endsWith('/') ? cwd : cwd + '/';
  for (const candidate of found) {
    if (candidate.startsWith(root)) out.add(candidate.slice(root.length));
    else if (!candidate.startsWith('/')) out.add(candidate.replace(/^\.\//, ''));
  }
  return out;
}

const touchedCache = new Map();
const touchedSeq = new Map();

/** Recently written paths attributable to one Session (null when unreadable). */
export async function sessionTouchedPaths(sessionId, cwd, force) {
  const appCtx = getAppCtx();
  const key = String(sessionId || '') + '\u0000' + String(cwd || '');
  const seq = (touchedSeq.get(key) || 0) + 1;
  setBoundedClientCache(touchedSeq, key, seq);
  const cached = touchedCache.get(key);
  if (!force && cached && Date.now() - cached.at < 20000) return cached.paths;
  let paths = null;
  try {
    const binding = appCtx.sessions.binding ? appCtx.sessions.binding(sessionId) : null;
    const session = binding && binding.session;
    if (session && typeof session.readPage === 'function') {
      const found = new Set();
      let through;
      for (let pageIdx = 0; pageIdx < 4; pageIdx += 1) {
        const page = await session.readPage({ maxMessages: 300 }, through);
        const records = page && page.records;
        if (!records) break;
        collectTouched(records, found, 0);
        if (!page.hasMore || records.length === 0) break;
        const seqs = records
          .map((r) => (r && typeof r.seq === 'number' ? r.seq : null))
          .filter((v) => v !== null);
        if (seqs.length === 0) break;
        through = Math.min.apply(null, seqs) - 1;
        if (through < 0) break;
      }
      paths = normalizeTouchedPaths(found, cwd);
    }
  } catch { paths = null; }
  if (touchedSeq.get(key) === seq) setBoundedClientCache(touchedCache, key, { at: Date.now(), paths });
  return paths;
}

/** Drop the touched-path caches (apply teardown). */
export function clearTouchedCaches() {
  touchedCache.clear();
  touchedSeq.clear();
}

/** The readable draft state of one Session, or null. */
export function readSessionDraft(sessions, sessionId) {
  const input = resolveSessionInput(sessions, sessionId);
  const snapshot = inputSnapshot(input);
  if (!input || !snapshot || typeof snapshot.draft !== 'string') return null;
  return {
    input,
    draft: snapshot.draft,
    draftRev: typeof snapshot.draftRev === 'number' ? snapshot.draftRev : null,
    attachmentIds: Array.isArray(snapshot.attachmentIds) ? snapshot.attachmentIds.slice() : [],
    occurrenceCount: Array.isArray(snapshot.occurrences) ? snapshot.occurrences.length : 0,
    phase: snapshot.phase || 'plain',
  };
}

/**
 * Which tiers of the conversation input machine accept a writer.
 * `plain | claimed` are writable; anything else is frozen.
 */
export function inputTier(snapshot) {
  if (!snapshot) return 'unavailable';
  return snapshot.phase === 'plain' || snapshot.phase === 'claimed' ? 'writable' : 'frozen';
}

/** Whether every listed Session has an empty, plain composer. */
export function sessionsHaveEmptyDrafts(sessions, sessionIds) {
  if (!Array.isArray(sessionIds)) return false;
  return sessionIds.every((sessionId) => {
    const current = readSessionDraft(sessions, sessionId);
    return Boolean(current && current.phase === 'plain' && current.draft === ''
      && current.attachmentIds.length === 0 && current.occurrenceCount === 0);
  });
}

/**
 * Why the last `transferSessionDraft` — or the pre-request capture that
 * precedes it — refused, for diagnostics only.
 */
let lastDraftTransferReason = null;

/** Record a refusal the pre-request capture decided (not transferSessionDraft). */
export function setLastDraftTransferReason(reason) {
  lastDraftTransferReason = reason;
}

/** The stable reason code of the last refused draft hand-off. */
export function getLastDraftTransferReason() {
  return lastDraftTransferReason;
}

/** Move the launcher's draft to the target Session atomically. */
export function transferSessionDraft(sessions, sourceId, targetId, captured, conversation) {
  lastDraftTransferReason = null;
  const refuse = (reason) => { lastDraftTransferReason = reason; return false; };
  const source = captured && captured.input ? captured : readSessionDraft(sessions, sourceId);
  const liveSource = readSessionDraft(sessions, sourceId);
  if (!source) return refuse('source-draft-unavailable');
  if (!liveSource) return refuse('source-input-unavailable');
  if (liveSource.input !== source.input) return refuse('source-input-replaced');
  if (sourceId === targetId) return refuse('same-session');
  /* The gate judges the LIVE tier, never the click-time snapshot's phase. */
  if (inputTier(liveSource) === 'frozen') return refuse('source-not-plain');
  if (source.occurrenceCount > 0) return refuse('source-has-occurrences');
  /* Nothing to move: the target's scope is irrelevant, so an empty launcher can
   * never fail on a target whose input has not materialized. */
  if (source.draft === '' && source.attachmentIds.length === 0 && source.occurrenceCount === 0
    && liveSource.draft === '' && liveSource.attachmentIds.length === 0 && liveSource.occurrenceCount === 0) {
    openSessionInMainView(targetId);
    return true;
  }
  const target = readSessionDraft(sessions, targetId);
  /* `target === null` is the COMMON case: sessions.create resolves
   * optimistically, so the freshly created target often has no readable input
   * yet. The caller waits for it. */
  if (!target) return refuse('target-input-unavailable');
  if (inputTier(target) === 'frozen') return refuse('target-not-plain');
  if (target.draft !== '') return refuse('target-draft-not-empty');
  if (target.attachmentIds.length > 0) return refuse('target-has-attachments');
  if (source.attachmentIds.length > 0
    && (!conversation || typeof conversation.rebindDraftFiles !== 'function'
      || typeof target.input.addAttachments !== 'function'
      || typeof target.input.removeAttachment !== 'function'
      || typeof source.input.addAttachments !== 'function'
      || typeof source.input.removeAttachment !== 'function')) return refuse('attachment-capability-missing');
  const sourceStillMatches = () => {
    const current = inputSnapshot(source.input);
    return Boolean(current && inputTier(current) === 'writable' && current.draft === source.draft
      && (source.draftRev === null || current.draftRev === source.draftRev)
      && sameAttachmentIds(current.attachmentIds || [], source.attachmentIds));
  };
  if (!sourceStillMatches()) return refuse('source-changed-during-handoff');
  let attachmentsAdded = false;
  let sourceClearRev = null;
  const rollbackTarget = () => {
    const targetNow = inputSnapshot(target.input);
    if (targetNow && targetNow.draft === source.draft) setInputDraft(target.input, '');
    if (attachmentsAdded) {
      const sourceNow = inputSnapshot(source.input);
      const sourceIds = Array.isArray(sourceNow?.attachmentIds) ? sourceNow.attachmentIds : [];
      if (!source.attachmentIds.every((id) => sourceIds.includes(id))) return;
      try { conversation.rebindDraftFiles(sourceId, source.attachmentIds); } catch { return; }
      for (const id of source.attachmentIds) {
        try { target.input.removeAttachment(id); } catch { /* a duplicate is safer than loss */ }
      }
    }
  };
  const restoreSourceIfOwned = () => {
    let current = inputSnapshot(source.input);
    if (!current) return;
    const currentIds = Array.isArray(current.attachmentIds) ? current.attachmentIds : [];
    const missing = source.attachmentIds.filter((id) => !currentIds.includes(id));
    try { if (missing.length > 0) source.input.addAttachments(missing); } catch { /* target retains a duplicate */ }
    current = inputSnapshot(source.input);
    const restoredIds = Array.isArray(current?.attachmentIds) ? current.attachmentIds : [];
    if (attachmentsAdded && source.attachmentIds.every((id) => restoredIds.includes(id))) {
      try { conversation.rebindDraftFiles(sourceId, source.attachmentIds); } catch { /* target remains bound */ }
    }
    if (current && inputTier(current) === 'writable' && current.draft === ''
      && (sourceClearRev === null || current.draftRev === sourceClearRev)) {
      setInputDraft(source.input, source.draft);
    }
  };
  try {
    if (source.attachmentIds.length > 0) {
      if (!target.input.addAttachments(source.attachmentIds)) return refuse('target-attach-failed');
      attachmentsAdded = true;
      conversation.rebindDraftFiles(targetId, source.attachmentIds);
    }
    if (!setInputDraft(target.input, source.draft) || !sourceStillMatches()) {
      rollbackTarget();
      return refuse('target-draft-write-failed');
    }
    if (!setInputDraft(source.input, '')) {
      rollbackTarget();
      return refuse('source-clear-failed');
    }
    sourceClearRev = inputSnapshot(source.input)?.draftRev ?? null;
    for (const id of source.attachmentIds) {
      if (!source.input.removeAttachment(id)) {
        restoreSourceIfOwned();
        rollbackTarget();
        return refuse('source-detach-failed');
      }
    }
    const cleared = inputSnapshot(source.input);
    if (!cleared || inputTier(cleared) !== 'writable' || cleared.draft !== '' || (cleared.attachmentIds || []).length !== 0) {
      restoreSourceIfOwned();
      rollbackTarget();
      return refuse('source-not-cleared');
    }
    openSessionInMainView(targetId);
    return true;
  } catch (error) {
    restoreSourceIfOwned();
    rollbackTarget();
    throw error;
  }
}
