/**
 * The forge codec, caches, draft sidecar and reference attachment (`bw-forge`).
 *
 * A picked issue/PR becomes a REAL reference chip: `encodeForgeRef` is the
 * canonical identity (versioned, lowercase host/owner/repo), `clipboardText`
 * is the persistence projection, and `renderForgeReferenceText` is the model
 * form submitted at send time. The reference source registered by
 * `createForgeSource` keeps the codec reachable for as long as the row is
 * mounted — a chip whose source disappears blocks the send.
 */
import { apiGet, qs } from '@ds-hu/dsh-bw-core/client/api.js';
import { gitCwd } from '@ds-hu/dsh-bw-core/client/feed.js';
import { effectiveSessionCwd, inputSnapshot, resolveSessionInput } from '@ds-hu/dsh-bw-core/client/session.js';
import { failureMessage } from '@ds-hu/dsh-bw-core/client/util.js';
import { t } from '@ds-hu/dsh-bw-core/client/i18n.js';
import { getAppCtx } from '@ds-hu/dsh-bw-core/client/runtime.js';


/* The reference source's name IS the serializer routing key the
 * conversation stores on every chip ("slash: no serializer for
 * reference source X" is the failure when it goes missing), so it must
 * stay registered for as long as this plugin is mounted — a chip
 * inserted by the picker would otherwise block the send. */
export const FORGE_SOURCE = "better-workspaces-forge";
/** List rows are display hints only; submit always refreshes exact detail. */
export const forgeItems = new Map();
/** Successfully attached canonical refs, scoped by owning Session ID. */
export const forgeAttached = new Map();
export const forgeDraftRehydration = new Map();
export const forgeDraftBlocks = new Map();
const FORGE_REF_PREFIX = "bw1";
const FORGE_DRAFT_KEY_PREFIX = "dsh-bw-forge-draft-v1:";

function scalarToHex(value) {
	let hex = "";
	for (let i = 0; i < value.length; i += 1) hex += value.charCodeAt(i).toString(16).padStart(4, "0");
	return hex;
}

function hexToScalar(hex) {
	if (typeof hex !== "string" || hex.length % 4 !== 0 || !/^[0-9a-f]*$/i.test(hex)) return null;
	let value = "";
	for (let i = 0; i < hex.length; i += 4) value += String.fromCharCode(Number.parseInt(hex.slice(i, i + 4), 16));
	return value;
}

export function encodeForgeRef(item) {
	if (!item || !Number.isSafeInteger(item.number) || item.number <= 0
		|| !["issue", "change_request"].includes(item.kind)
		|| !item.host || !item.owner || !item.repo) return null;
	const json = JSON.stringify([String(item.host).toLowerCase(), String(item.owner).toLowerCase(), String(item.repo).toLowerCase(), item.kind, item.number]);
	return FORGE_REF_PREFIX + scalarToHex(json);
}

export function decodeForgeRef(ref) {
	if (typeof ref !== "string") return null;
	if (/^[1-9]\d*$/.test(ref)) {
		const number = Number(ref);
		return Number.isSafeInteger(number) ? { version: 0, number } : null;
	}
	if (!ref.startsWith(FORGE_REF_PREFIX) || (ref.length - FORGE_REF_PREFIX.length) % 4 !== 0) return null;
	try {
		const value = JSON.parse(hexToScalar(ref.slice(FORGE_REF_PREFIX.length)));
		if (!Array.isArray(value) || value.length !== 5) return null;
		const [host, owner, repo, kind, number] = value;
		if (!host || !owner || !repo || !["issue", "change_request"].includes(kind)
			|| !Number.isSafeInteger(number) || number <= 0) return null;
		return { version: 1, host: String(host).toLowerCase(), owner: String(owner).toLowerCase(), repo: String(repo).toLowerCase(), kind, number };
	} catch {
		return null;
	}
}

function invalidForgeClipboardText(ref) {
	if (typeof ref !== "string" || !ref.startsWith("bwi")) return null;
	return hexToScalar(ref.slice(3));
}

export function forgeClipboardText(ref) {
	const invalid = invalidForgeClipboardText(ref);
	if (invalid !== null) return invalid;
	const identity = decodeForgeRef(ref);
	if (!identity) return "#?";
	if (identity.version === 0) return "#" + identity.number;
	const route = identity.kind === "change_request" ? "pull" : "issues";
	return `[[dsh-bw1:https://${identity.host}/${encodeURIComponent(identity.owner)}/${encodeURIComponent(identity.repo)}/${route}/${identity.number}]]`;
}

export function embeddedForgeDraft(draft) {
	if (typeof draft !== "string") return null;
	const references = [];
	const token = /\[\[dsh-bw1:https:\/\/([a-z0-9.-]+(?::\d+)?)\/([^/\s\]]+)\/([^/\s\]]+)\/(pull|issues)\/([1-9]\d*)\]\]/gi;
	let residual = draft;
	let match;
	while ((match = token.exec(draft)) !== null) {
		let owner;
		let repo;
		try { owner = decodeURIComponent(match[2]); repo = decodeURIComponent(match[3]); } catch { return { invalid: true, draft, references: [] }; }
		const identity = {
			version: 1, host: match[1].toLowerCase(), owner, repo,
			kind: match[4] === "pull" ? "change_request" : "issue", number: Number(match[5]),
		};
		const ref = encodeForgeRef(identity);
		if (!ref) return { invalid: true, draft, references: [] };
		references.push({
			ref, offset: match.index, length: match[0].length,
			label: (identity.kind === "change_request" ? "PR #" : "Issue #") + identity.number,
			clipboardText: match[0],
		});
		residual = residual.slice(0, match.index) + " ".repeat(match[0].length) + residual.slice(match.index + match[0].length);
	}
	const malformed = /\[\[dsh-bw1:[^\s\]]*(?:\]\])?/i.exec(residual);
	if (malformed) {
		references.push({
			ref: "bwi" + scalarToHex(malformed[0]), offset: malformed.index, length: malformed[0].length,
			label: t("forge.invalid"), clipboardText: malformed[0], invalid: true,
		});
		references.sort((a, b) => a.offset - b.offset);
		return { version: 1, invalid: true, draft, references };
	}
	return references.length ? { version: 1, draft, references } : null;
}

export function forgeItemKey(item) {
	return encodeForgeRef(item);
}

export function cacheForgeItem(ref, item) {
	forgeItems.delete(ref);
	forgeItems.set(ref, item);
	while (forgeItems.size > 512) forgeItems.delete(forgeItems.keys().next().value);
}

export function rememberForgeItem(item, sessionId) {
	const ref = forgeItemKey(item);
	if (!ref || typeof sessionId !== "string" || sessionId === "") return;
	cacheForgeItem(ref, item);
	const attached = forgeAttached.get(sessionId) || new Set();
	attached.add(ref);
	while (attached.size > 512) attached.delete(attached.values().next().value);
	forgeAttached.set(sessionId, attached);
	while (forgeAttached.size > 512) forgeAttached.delete(forgeAttached.keys().next().value);
}

export function forgeDraftStorageKey(sessionId) {
	return FORGE_DRAFT_KEY_PREFIX + sessionId;
}

export function setForgeDraftBlock(sessionId, blocked) {
	let conversation = null;
	try { conversation = getAppCtx() && getAppCtx().get("conversation"); } catch { /* unavailable */ }
	if (!conversation || !conversation.blocks || !sessionId) return;
	const owned = forgeDraftBlocks.get(sessionId);
	let current;
	try { current = conversation.blocks.storeFor(sessionId).getSnapshot(); } catch { current = undefined; }
	if (blocked) {
		if (owned && current === owned) return;
		if (owned) forgeDraftBlocks.delete(sessionId);
		if (current !== undefined) return;
		const block = { reason: t("forge.restorePending") };
		conversation.blocks.set(sessionId, block);
		forgeDraftBlocks.set(sessionId, block);
		return;
	}
	if (!owned) return;
	if (current === owned) conversation.blocks.set(sessionId, undefined);
	forgeDraftBlocks.delete(sessionId);
}

export function readForgeDraftSidecar(sessionId) {
	try {
		const parsed = JSON.parse(localStorage.getItem(forgeDraftStorageKey(sessionId)) || "null");
		if (!parsed || parsed.version !== 1 || typeof parsed.draft !== "string" || !Array.isArray(parsed.references)) return null;
		let end = 0;
		const references = [];
		for (const entry of parsed.references) {
			const identity = decodeForgeRef(entry && entry.ref);
			const invalidProjection = invalidForgeClipboardText(entry && entry.ref);
			const ownedRef = Boolean(identity?.version === 1 || invalidProjection !== null);
			const entryEnd = entry && entry.offset + entry.length;
			if (!ownedRef || !Number.isSafeInteger(entry.offset)
				|| !Number.isSafeInteger(entry.length) || entry.length < 2 || entry.offset < end
				|| !Number.isSafeInteger(entryEnd) || entryEnd > parsed.draft.length
				|| typeof entry.label !== "string" || entry.label.length > 500
				|| entry.clipboardText !== forgeClipboardText(entry.ref) || entry.length !== entry.clipboardText.length
				|| parsed.draft.slice(entry.offset, entryEnd) !== entry.clipboardText) return null;
			end = entry.offset + entry.length;
			references.push({
				ref: entry.ref, offset: entry.offset, length: entry.length,
				label: entry.label, clipboardText: entry.clipboardText,
				invalid: invalidProjection !== null,
			});
		}
		return references.length ? { version: 1, draft: parsed.draft, references } : null;
	} catch {
		return null;
	}
}

export function writeForgeDraftSidecar(sessionId, input) {
	try {
		const references = (input.occurrences || [])
			.filter((entry) => entry && entry.source === FORGE_SOURCE
				&& (decodeForgeRef(entry.ref)?.version === 1 || invalidForgeClipboardText(entry.ref) !== null))
			.map((entry) => ({
				ref: entry.ref, offset: entry.offset, length: entry.length,
				label: entry.label, clipboardText: entry.clipboardText,
			}));
		if (!references.length) {
			localStorage.removeItem(forgeDraftStorageKey(sessionId));
			return;
		}
		localStorage.setItem(forgeDraftStorageKey(sessionId), JSON.stringify({ version: 1, draft: input.draft, references }));
	} catch { /* unavailable/full storage never changes the live draft */ }
}

export function settleForgeDraftSidecar(sessionId, input, sessionInput) {
	const current = inputSnapshot(sessionInput) || input;
	if (!sessionId || !current || typeof current.draft !== "string") return false;
	let pending = forgeDraftRehydration.get(sessionId) || null;
	const allOccurrences = (current.occurrences || []).filter((entry) => entry && Number.isSafeInteger(entry.offset) && Number.isSafeInteger(entry.length));
	const live = allOccurrences.filter((entry) => entry.source === FORGE_SOURCE);
	if (!pending) {
		const saved = readForgeDraftSidecar(sessionId);
		const embedded = embeddedForgeDraft(current.draft);
		let stored = embedded || (saved && saved.draft === current.draft ? saved : null);
		if (!stored) {
			if (live.length) writeForgeDraftSidecar(sessionId, current);
			return false;
		}
		if (embedded && saved && saved.draft === current.draft) {
			const labels = new Map(saved.references.map((entry) => [`${entry.offset}\u0000${entry.ref}`, entry.label]));
			stored = {
				...embedded,
				references: embedded.references.map((entry) => ({
					...entry, label: labels.get(`${entry.offset}\u0000${entry.ref}`) || entry.label,
				})),
			};
		}
		const claimed = new Set();
		const remaining = stored.references.filter((entry) => {
			const index = live.findIndex((occurrence, liveIndex) => !claimed.has(liveIndex)
				&& occurrence.offset === entry.offset && occurrence.ref === entry.ref);
			if (index < 0) return true;
			claimed.add(index);
			return false;
		});
		pending = { ...stored, remaining: remaining.reverse() };
		if (!pending.remaining.length) {
			writeForgeDraftSidecar(sessionId, current);
			return false;
		}
		forgeDraftRehydration.set(sessionId, pending);
	}
	if (pending.draft !== current.draft) {
		forgeDraftRehydration.delete(sessionId);
		try { localStorage.removeItem(forgeDraftStorageKey(sessionId)); } catch { /* unavailable */ }
		return false;
	}
	const missing = pending.remaining[0];
	if (!missing) {
		forgeDraftRehydration.delete(sessionId);
		writeForgeDraftSidecar(sessionId, current);
		return false;
	}
	if (!sessionInput || typeof sessionInput.insertReference !== "function") return false;
	let shrink = 0;
	for (const entry of allOccurrences) if (entry.offset < missing.offset) shrink += entry.length - 1;
	const start = missing.offset - shrink;
	const rev = current.draftRev;
	if (!Number.isSafeInteger(start) || !Number.isSafeInteger(rev)) return false;
	const inserted = sessionInput.insertReference({
		source: FORGE_SOURCE,
		ref: missing.ref,
		label: missing.label,
		clipboardText: missing.clipboardText,
	}, { start, end: start + missing.length, draftRev: rev }) === true;
	if (!inserted) return false;
	pending.remaining.shift();
	const after = inputSnapshot(sessionInput);
	if (after && typeof after.draft === "string") pending.draft = after.draft;
	return true;
}

/**
 * Is the opt-in diagnostics channel on? Enabled from the page console with
 * `localStorage.setItem("dsh-bw-debug", "1")`; absent storage (Node, a
 * sandboxed frame) answers "off" rather than throwing.
 * @returns whether traces should be emitted.
 */
export function forgeDebugOn() {
	try {
		return typeof localStorage !== "undefined" && localStorage.getItem("dsh-bw-debug") === "1";
	} catch {
		return false;
	}
}

/**
 * Emit one step of the pick path. Every failure between a row click and a
 * chip on screen is otherwise silent — `insertReference` answers `false`
 * instead of throwing, `setDraft` returns without a write when the draft is
 * unchanged, and the resolver swallows its own exceptions — so this
 * channel is what makes a report actionable. Zero cost when off.
 * @param step - short stage name.
 * @param detail - plain data describing that stage (never live objects).
 */
export function forgeTrace(step, detail) {
	if (!forgeDebugOn()) return;
	try {
		console.warn("[better-workspaces:forge]", step, detail);
	} catch { /* a diagnostics channel must never break the feature */ }
}

export function forgeItemLabel(item) {
	const prefix = item.kind === "change_request" ? "PR" : "Issue";
	return prefix + " #" + item.number + (item.title ? " " + item.title : "");
}

/**
 * Resolve the composer facade that owns one session's editor.
 *
 * `conversation.input.for(actx)` resolves its session through
 * `sessions.scopeOf(ctx)` — a PRIVATE tag the sessions service stamps on
 * the ctx it materializes per session. A session BINDING carries no such
 * tag, so handing one over throws ("conversation.input.for requires a
 * session scope"); `sessions.scope(id)` is the public accessor for the ctx
 * it wants. Returns null when any hop is missing, so the caller can fall
 * back to a plain-text write instead of failing silently.
 * @param sessions - the client sessions service.
 * @param sessionId - the session whose composer receives the reference.
 * @returns the session's input facade, or null.
 */
export function resolveForgeSessionInput(sessions, sessionId) {
	try {
		/* The service key is "conversation", NOT "uiConversation": the official
		   plugin registers two different classes and only this one carries the
		   SessionInputResolver (`super(ctx, "conversation")` + `this.input =
		   config.input`; the `uiConversation` class has no `input` member at
		   all). `uiConversation` is merely the local variable name the official
		   bundle happens to use in its own apply, so `get("uiConversation")`
		   answered undefined and every attach was skipped before it could even
		   try — a silent no-op on a key that never existed. */
		const scope = sessions && sessions.scope ? sessions.scope(sessionId) : undefined;
		const scopedConversation = scope && typeof scope.get === "function" ? scope.get("conversation") : null;
		const rootConversation = getAppCtx() && getAppCtx().get ? getAppCtx().get("conversation") : null;
		const conversation = scopedConversation || rootConversation;
		forgeTrace("resolve", {
			sessionId: String(sessionId),
			hasConversation: Boolean(conversation),
			hasInput: Boolean(conversation && conversation.input),
			hasScope: Boolean(scope),
			hasFor: Boolean(conversation && conversation.input && typeof conversation.input.for === "function"),
		});
		const shell = resolveSessionInput(sessions, sessionId);
		forgeTrace("resolve.shell", {
			gotShell: Boolean(shell),
			hasInsertReference: Boolean(shell && typeof shell.insertReference === "function"),
			hasCaretSpan: Boolean(shell && typeof shell.caretSpan === "function"),
			hasSetDraft: Boolean(shell && typeof shell.setDraft === "function"),
			hasNotify: Boolean(shell && typeof shell.notify === "function"),
			shellRev: shell && typeof shell.rev === "number" ? shell.rev : null,
		});
		return shell;
	} catch (error) {
		forgeTrace("resolve.threw", { message: String((error && error.message) || error) });
		return null;
	}
}

/**
 * Convert a published InputState's clipboard projection to its exact detect
 * end. Occurrence offset/length are BOTH clipboard coordinates. The editor
 * projects every real chip as one U+FFFC in detect text, so each occurrence
 * shrinks by `length - 1`; ordinary text, line breaks and block gaps keep the
 * same length in both projections.
 *
 * Malformed ranges return null rather than manufacturing a span: an invalid
 * detect span makes `insertReference` answer false and used to trigger the
 * surprising full-text fallback.
 * @param input - published InputState (live shell snapshot preferred).
 * @returns the detect-coordinate document end, or null when inconsistent.
 */
export function referenceDetectEnd(input) {
	if (!input || typeof input.draft !== "string" || !Array.isArray(input.occurrences)) return null;
	let previousEnd = 0;
	let shrink = 0;
	for (const occurrence of input.occurrences) {
		const offset = occurrence && occurrence.offset;
		const length = occurrence && occurrence.length;
		if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || length < 1) return null;
		const clipboardEnd = offset + length;
		if (!Number.isSafeInteger(clipboardEnd) || offset < previousEnd || clipboardEnd > input.draft.length) return null;
		previousEnd = clipboardEnd;
		shrink += length - 1;
		if (!Number.isSafeInteger(shrink)) return null;
	}
	const end = input.draft.length - shrink;
	return Number.isSafeInteger(end) && end >= 0 ? end : null;
}

/**
 * Pick an append-only insertion span from the LIVE shell. `caretSpan()` may
 * answer a selection parked in the middle of text; a dialog pick must not
 * split it, so only a collapsed caret exactly at the computed detect end is
 * reused. The revision always comes from the shell counter checked by the
 * official span CAS. Render-time input is a last-resort compatibility
 * fallback, never preferred over `target.snapshot`.
 * @param target - the resolved session input facade.
 * @param fallbackInput - render-time InputState for a facade without snapshot.
 * @returns the span and its source, or null when no safe span exists.
 */
export function forgeInsertSpan(target, fallbackInput) {
	const liveInput = inputSnapshot(target);
	const input = liveInput || fallbackInput;
	const detectEnd = referenceDetectEnd(input);
	const rev = input && Number.isSafeInteger(input.draftRev) ? input.draftRev : null;
	if (detectEnd === null || rev === null) {
		forgeTrace("span.invalid", { hasLiveInput: Boolean(liveInput), detectEnd, rev });
		return null;
	}
	forgeTrace("caret", { shellRev: rev, detectEnd, atEnd: true });
	return { span: { start: detectEnd, end: detectEnd, draftRev: rev }, source: "draft-end" };
}

/**
 * Atomically attach one picked issue/PR as a real reference chip. A failed
 * span/CAS/phase check must leave the draft unchanged: expanding the model
 * form into the editor is not an acceptable degradation of the chip-shaped
 * UI contract. The caller keeps the picker open so the user can retry.
 * @param args - item, resolved facade, and render-time fallback InputState.
 * @returns true only when the chip landed.
 */
function attachForgeReferenceLegacy(args) {
	const item = args.item;
	const ref = encodeForgeRef(item);
	if (!ref) return false;
	const reference = {
		source: FORGE_SOURCE,
		ref,
		label: forgeItemLabel(item),
		// No `appearance`: ReferenceInsert allows only session/file/folder,
		// and an issue/PR is none of them.
		/* The chip's marker is "#", NOT "@": "@" wakes the official
		   attachment/reference sources, so an "@N" chip put their menu and
		   ours on the same keystroke. `clipboardText` is only the
		   clipboard/persistence projection — the official field doc says
		   "never the model form" — so the send-time payload is unaffected
		   (see the codec's `trigger` for why it stays "@"). */
		clipboardText: forgeClipboardText(ref),
	};
	const target = args.sessionInput;
	const phase = target && target.snapshot ? target.snapshot.phase : null;
	forgeTrace("attach", { number: item.number, kind: item.kind, phase, target: Boolean(target) });
	let done = false;
	let chipError = null;
	if (target && typeof target.insertReference === "function") {
		try {
			const picked = forgeInsertSpan(target, args.fallbackInput);
			if (picked) {
				done = target.insertReference(reference, picked.span) === true;
				forgeTrace("insert", { ok: done, source: picked.source, span: picked.span });
			} else {
				chipError = t("forge.attachFailedRejected");
			}
		} catch (error) {
			chipError = String((error && error.message) || error);
			forgeTrace("insert.threw", { message: chipError });
		}
	} else {
		forgeTrace("insert.skipped", { hasTarget: Boolean(target) });
	}
	if (done) {
		forgeTrace("done", { chip: true });
		return true;
	}
	const writable = phase === "plain" || phase === "claimed";
	const reason = chipError || t(writable ? "forge.attachFailedRejected" : "forge.attachFailedNoTarget");
	forgeTrace("done", { chip: false, reason });
	try {
		if (target && typeof target.notify === "function") target.notify("error", t("forge.attachFailed", { reason }));
	} catch { /* the notice is best-effort */ }
	return false;
}

/**
 * paseo's renderChangeRequestAttachment / renderIssueAttachment: the
 * MODEL form of one reference. The composer shows the chip label; this
 * text is what the agent receives (ADR 0008).
 */
export function renderForgeReferenceText(item) {
	const lines = [];
	if (item.kind === "change_request") {
		lines.push("GitHub PR #" + item.number + ": " + (item.title || ""));
		if (item.url) lines.push(item.url);
		if (item.baseRefName) lines.push("Base: " + item.baseRefName);
		if (item.headRefName) lines.push("Head: " + item.headRefName);
	} else {
		lines.push("GitHub Issue #" + item.number + ": " + (item.title || ""));
		if (item.url) lines.push(item.url);
	}
	if (item.body) lines.push("", item.body);
	return lines.join("\n");
}

export async function fetchForgeItem(cwd, ref, signal) {
	const identity = decodeForgeRef(ref);
	if (!identity || identity.version !== 1) throw new Error(t("forge.detailFailed"));
	const cwds = [];
	if (typeof cwd === "string" && cwd) cwds.push(gitCwd(cwd));
	try {
		const snapshot = getAppCtx().sessions.list.getSnapshot();
		for (const sessionId of snapshot.ids || []) {
			const candidate = gitCwd(effectiveSessionCwd(snapshot.byId[sessionId]));
			if (typeof candidate === "string" && candidate && cwds.indexOf(candidate) === -1) cwds.push(candidate);
		}
	} catch { /* use any preferred cwd */ }
	if (cwds.length === 0) throw new Error(t("forge.detailFailed"));
	let last = null;
	for (const candidateCwd of cwds) {
		const selector = identity.version === 1
			? { cwd: candidateCwd, number: identity.number, kind: identity.kind, host: identity.host, owner: identity.owner, repo: identity.repo }
			: { cwd: candidateCwd, number: identity.number };
		const result = await apiGet("/pull" + qs(selector), signal);
		last = result;
		if (!result || !result.ok || !result.item) {
			if (identity.version === 1
				&& (result?.error === "repository identity changed" || result?.authState === "no_remote")) continue;
			throw new Error(failureMessage(result) || t("forge.detailFailed"));
		}
		const returnedRef = forgeItemKey(result.item);
		if (identity.version === 1 && returnedRef !== ref) throw new Error(t("forge.detailFailed"));
		if (returnedRef) cacheForgeItem(returnedRef, result.item);
		return result.item;
	}
	throw new Error(failureMessage(last) || t("forge.detailFailed"));
}

/** One row: number, title, kind glyph, fork/state hint. */
/**
 * Attach one picked issue/PR as a real reference chip.
 *
 * Two arities, one contract:
 *   - `attachForgeReference({ item, sessionInput, fallbackInput })` — the
 *     composer's form: atomic, returns `true` only when the chip landed.
 *   - `attachForgeReference(sessionId, item)` — the sidebar page's form:
 *     resolves the Session's input facade first, then runs the atomic attach.
 *
 * @returns a boolean, or a Promise<boolean> for the two-argument form.
 */
export function attachForgeReference(argsOrSessionId, maybeItem) {
  if (maybeItem !== undefined) {
    const sessionId = argsOrSessionId;
    return Promise.resolve().then(() => {
      const sessions = getAppCtx().sessions;
      return attachForgeReference({ item: maybeItem, sessionInput: resolveForgeSessionInput(sessions, sessionId) });
    });
  }
  return attachForgeReferenceLegacy(argsOrSessionId);
}


/** Details fetched for one encoded reference (used by the picker/page cache). */
export async function loadForgeItemDetail({ ref, cwd, signal } = {}) {
  return fetchForgeItem(cwd === undefined ? null : cwd, ref, signal);
}
