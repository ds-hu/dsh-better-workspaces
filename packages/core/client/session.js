/**
 * Session helpers shared by every feature bundle.
 *
 * The on-screen Session is NOT in the `sessions` store: `uiSession.current`
 * (dsh-client-ui-session) owns it and `binding.key` is the Session id. The
 * `sessions` list from dsh-api-session-controller publishes
 * `{ ids, byId, phase, projectionsBySession }` and has never carried
 * `current`. Everything here reads the authoritative shape.
 */
import { getAppCtx, getMainViewSessionSource } from './runtime.js';

/** DSH 0.2.1 moved the effective directory into the projection. */
export function effectiveSessionCwd(summary) {
  const projected = summary && summary.projectionValues
    ? summary.projectionValues.workingDirectory
    : undefined;
  if (typeof projected === 'string' && projected !== '') return projected;
  return summary && typeof summary.cwd === 'string' && summary.cwd !== '' ? summary.cwd : null;
}

/** The `uiSession.current` store for the main view, or null. */
export function mainViewSessionFor(ctx) {
  const service = ctx && typeof ctx.get === 'function' ? ctx.get('uiSession') : undefined;
  const source = service && service.current;
  return source && typeof source.getSnapshot === 'function' && typeof source.subscribe === 'function'
    ? source
    : null;
}

/** `binding.key` is the Session id; tolerate any other shape by ignoring it. */
export function mainViewSessionId(snapshot) {
  const key = snapshot && snapshot.key;
  return typeof key === 'string' && key !== '' ? key : undefined;
}

/** The id of the Session on screen, or undefined when nothing is open. */
export function currentSessionId() {
  try {
    const source = getMainViewSessionSource() ?? mainViewSessionFor(getAppCtx());
    return source ? mainViewSessionId(source.getSnapshot()) : undefined;
  } catch {
    return undefined;
  }
}

/* sessions.create resolves a bare id string over the gateway but older builds
 * wrapped it — one normalizer for every call site */
export function normalizeSessionId(raw) {
  if (typeof raw === 'string') return raw;
  if (raw && raw.value) return raw.value.sessionId || raw.value.session || raw.value;
  return raw && raw.sessionId ? raw.sessionId : raw;
}

/** The conversation input bound to a Session, or null. */
export function resolveSessionInput(sessions, sessionId) {
  try {
    const scope = sessions && typeof sessions.scope === 'function' ? sessions.scope(sessionId) : undefined;
    const ctx = getAppCtx();
    const conversation = scope && typeof scope.get === 'function'
      ? scope.get('conversation')
      : ctx && typeof ctx.get === 'function' ? ctx.get('conversation') : null;
    if (!scope || !conversation || !conversation.input || typeof conversation.input.for !== 'function') return null;
    return conversation.input.for(scope) || null;
  } catch {
    return null;
  }
}

/** The current input snapshot (state store or legacy `snapshot` field). */
export function inputSnapshot(input) {
  if (!input) return null;
  if (input.state && typeof input.state.getSnapshot === 'function') return input.state.getSnapshot();
  return input.snapshot || null;
}

/** Write a draft through whichever input face this build exposes. */
export function setInputDraft(input, draft) {
  if (input && typeof input.setDraft === 'function') input.setDraft(draft);
  else if (input && input.actions && typeof input.actions.setDraft === 'function') input.actions.setDraft(draft);
  else return false;
  const snapshot = inputSnapshot(input);
  return Boolean(snapshot && snapshot.draft === draft);
}

export function sameAttachmentIds(left, right) {
  return Array.isArray(left) && Array.isArray(right)
    && left.length === right.length
    && left.every((id, index) => id === right[index]);
}

/**
 * Whether a Session id already exists in the public catalog.
 *
 * A retried create replays one txId whose target Session id is derived from it;
 * a refusal from `sessions.create` because the row is already there proves the
 * same transaction already created it (ADR 0011 Amendment 1).
 */
export function sessionIsCatalogued(sessions, sessionId) {
  if (typeof sessionId !== 'string' || sessionId === '') return false;
  try {
    const list = sessions && sessions.list;
    const snapshot = list && typeof list.getSnapshot === 'function' ? list.getSnapshot() : null;
    const byId = snapshot && snapshot.byId;
    return Boolean(byId && Object.prototype.hasOwnProperty.call(byId, sessionId));
  } catch {
    return false;
  }
}

/**
 * Reveal a Session in the main view.
 *
 * `sessions.open(id)` was never on the contract: revealing belongs to the
 * workspace UI (`uiWorkspace.openSession(id)`). Falls back to `sessions.open`
 * only for a harness that still offers it.
 * @returns whether a reveal was issued.
 */
export function openSessionInMainView(sessionId) {
  if (typeof sessionId !== 'string' || sessionId === '') return false;
  const appCtx = getAppCtx();
  const uiWorkspace = appCtx && typeof appCtx.get === 'function' ? appCtx.get('uiWorkspace') : undefined;
  if (uiWorkspace && typeof uiWorkspace.openSession === 'function') {
    // Deliberately NOT swallowed: a reveal that fails is a real failure the
    // caller must see. Only the ABSENT case falls through.
    uiWorkspace.openSession(sessionId);
    return true;
  }
  try {
    const sessions = appCtx && appCtx.sessions;
    if (sessions && typeof sessions.open === 'function') {
      sessions.open(sessionId);
      return true;
    }
  } catch { /* no reveal available */ }
  return false;
}

/** The Session row for `sessionId` from the public list, or undefined. */
export function sessionSummary(sessions, sessionId) {
  try {
    const list = sessions && sessions.list;
    const snapshot = list && typeof list.getSnapshot === 'function' ? list.getSnapshot() : null;
    return snapshot && snapshot.byId && sessionId ? snapshot.byId[sessionId] : undefined;
  } catch {
    return undefined;
  }
}
