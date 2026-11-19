/**
 * The composer's GitHub control and the reference source (`bw-forge`).
 *
 * The control is the additive slot's third round button; picking a row attaches
 * a real chip. The source publishes the mandatory codec and answers the
 * candidate pipeline with a deliberately EMPTY list — never by omitting the
 * hook, because `candidates` is invoked synchronously on every `@` hit and a
 * missing method would take every source ordered after it down with it.
 */
import {
  h, useState, useRef, useEffect, useLayoutEffect, useSyncExternalStore,
} from '@ds-hu/dsh-bw-core/client/react.js';
import { useGitCwd } from '@ds-hu/dsh-bw-core/client/feed.js';
import { effectiveSessionCwd } from '@ds-hu/dsh-bw-core/client/session.js';
import { t } from '@ds-hu/dsh-bw-core/client/i18n.js';
import { ForgeIcon } from '@ds-hu/dsh-bw-core/client/icons.js';
import { getAppCtx } from '@ds-hu/dsh-bw-core/client/runtime.js';
import {
  FORGE_SOURCE, forgeDraftRehydration, forgeDraftStorageKey,
  decodeForgeRef, forgeDebugOn, forgeTrace, readForgeDraftSidecar,
  settleForgeDraftSidecar, rememberForgeItem, forgeClipboardText, renderForgeReferenceText,
  fetchForgeItem, attachForgeReference, resolveForgeSessionInput, setForgeDraftBlock,
  embeddedForgeDraft,
} from './forge-data.js';
import { ForgePicker } from './picker.js';

/**
 * The composer's forge button — the third round control of the tool row,
 * registered in `conversation.input.left` (the only additive slot there;
 * the native "+" command menu and paperclip file picker are hardcoded
 * and stay untouched). Picking a row attaches a reference chip; the
 * chip's own codec expands it into the full paseo text at submit time,
 * so the draft stays clean.
 */
export function ForgeAttachControl(props) {
	const sessionId = props.sessionId;
	const sessions = getAppCtx().sessions;
	const listState = useSyncExternalStore(
		(listener) => sessions.list.subscribe(listener),
		() => sessions.list.getSnapshot(),
		() => sessions.list.getSnapshot(),
	);
	const summary = sessionId ? listState.byId[sessionId] : undefined;
	// The picker asks about the checkout this Session works in, which is the
	// working copy the row and the diff page already read. Leaving it on the
	// raw projection made the composer report "workspace not authorized" in
	// the same view where the badges worked (Session moved into a subdirectory).
	const cwd = useGitCwd(effectiveSessionCwd(summary));
	const [open, setOpen] = useState(false);
	// The selector is REQUIRED, not optional: SnapshotSelectorHook is
	// `<S>(sel: (s: T) => S, eq?) => S`, so a bare useInput() invokes
	// `undefined` inside render and the control dies with a TypeError —
	// invisibly, because the registration stays in the slot registry
	// while the component never mounts (ADR 0009).
	const input = typeof props.useInput === "function" ? props.useInput((s) => s) : null;
	const draft = input && typeof input.draft === "string" ? input.draft : "";
	const draftRev = input && typeof input.draftRev === "number" ? input.draftRev : 0;
	const inputPhase = input && typeof input.phase === "string" ? input.phase : "plain";
	const occurrences = input && Array.isArray(input.occurrences) ? input.occurrences : [];
	let composerBlockStore = null;
	try {
		const conversation = getAppCtx().get("conversation");
		composerBlockStore = conversation && conversation.blocks ? conversation.blocks.storeFor(sessionId) : null;
	} catch { /* unavailable */ }
	const composerBlock = useSyncExternalStore(
		(listener) => composerBlockStore ? composerBlockStore.subscribe(listener) : () => {},
		() => composerBlockStore ? composerBlockStore.getSnapshot() : undefined,
		() => undefined,
	);
	const restoreProbe = useRef({ sessionId: null, done: false });
	if (restoreProbe.current.sessionId !== sessionId) restoreProbe.current = { sessionId, done: false };
	useEffect(() => () => {
		setForgeDraftBlock(sessionId, false);
		forgeDraftRehydration.delete(sessionId);
	}, [sessionId]);
	useLayoutEffect(() => {
		const pending = forgeDraftRehydration.has(sessionId);
		if (pending || occurrences.some((entry) => entry && entry.source === FORGE_SOURCE)) {
			if (pending) setForgeDraftBlock(sessionId, true);
			settleForgeDraftSidecar(sessionId, input, resolveForgeSessionInput(sessions, sessionId));
			if (forgeDraftRehydration.has(sessionId)) setForgeDraftBlock(sessionId, true);
			else {
				restoreProbe.current.done = true;
				setForgeDraftBlock(sessionId, false);
			}
			return;
		}
		const embedded = embeddedForgeDraft(draft);
		if (restoreProbe.current.done && embedded) restoreProbe.current.done = false;
		if (restoreProbe.current.done) {
			setForgeDraftBlock(sessionId, false);
			try { localStorage.removeItem(forgeDraftStorageKey(sessionId)); } catch { /* unavailable */ }
			return;
		}
		const saved = readForgeDraftSidecar(sessionId);
		const stored = saved && saved.draft === draft ? saved : embedded;
		if (!stored) {
			// The official store may seed after the slot's first empty render;
			// wait for it instead of deleting the only identity-bearing record.
			if (draft === "" && saved && saved.draft !== "") return;
			restoreProbe.current.done = true;
			setForgeDraftBlock(sessionId, false);
			return;
		}
		if (draft === stored.draft) {
			setForgeDraftBlock(sessionId, true);
			settleForgeDraftSidecar(sessionId, input, resolveForgeSessionInput(sessions, sessionId));
			return;
		}
		restoreProbe.current.done = true;
		setForgeDraftBlock(sessionId, false);
		try { localStorage.removeItem(forgeDraftStorageKey(sessionId)); } catch { /* unavailable */ }
	}, [sessionId, draft, draftRev, inputPhase, occurrences, composerBlock]);

	/* Diagnostics: is this control actually being fed live input state? A
	   parent that stops re-projecting would freeze `draftRev` here, and the
	   shell's span CAS would then reject every chip while the draft-end
	   fallback silently no-ops on an unchanged draft. Reported once per
	   session, and only while the opt-in channel is on. */
	const probe = useRef(null);
	if (forgeDebugOn() && probe.current !== sessionId) {
		probe.current = sessionId;
		forgeTrace("control", {
			sessionId: String(sessionId),
			hasUseInput: typeof props.useInput === "function",
			hasInput: Boolean(input),
			draftLength: draft.length,
			draftRev,
			occurrences: occurrences.length,
			hasActions: Boolean(props.inputActions),
		});
	}

	const forgeControlDisabled = Boolean(composerBlock) || !["plain", "claimed"].includes(inputPhase);
	useEffect(() => { if (forgeControlDisabled) setOpen(false); }, [forgeControlDisabled]);

	const attached = occurrences
		.filter((occurrence) => occurrence && occurrence.source === FORGE_SOURCE && decodeForgeRef(occurrence.ref))
		.map((occurrence) => occurrence.ref);

	/** One pick: attach atomically; a rejected insert leaves both the draft
	    and picker intact so the user can retry or cancel. */
	function insert(item) {
		const landed = attachForgeReference({
			item,
			sessionInput: resolveForgeSessionInput(sessions, sessionId),
			fallbackInput: input,
		});
		forgeTrace("pick", { number: item.number, landed });
		if (landed) {
			rememberForgeItem(item, sessionId);
			setOpen(false);
		}
	}

	if (!cwd) return null;
	return h("div", { className: "dsh-bw-forge" },
		h("button", {
			type: "button", className: "dsh-bw-forge-btn", onClick: () => setOpen(true), disabled: forgeControlDisabled,
			"data-armed": String(attached.length > 0), "aria-haspopup": "dialog", "aria-expanded": open,
			"aria-label": t("forge.addIssuePr"), title: t("forge.addIssuePr"),
		},
			h(ForgeIcon),
			attached.length > 0 ? h("span", { className: "dsh-bw-forge-count" }, String(attached.length)) : null),
		open ? h(ForgePicker, {
			cwd, attached,
			onClose: () => setOpen(false),
			onPick: (item) => insert(item),
		}) : null);
}

/**
 * The reference source behind the chips publishes the mandatory codec and
 * answers the candidate pipeline with a deliberately EMPTY list — never by
 * omitting the hook: `candidates` is required by the
 * controller's roster loop (it is invoked synchronously on every `@`
 * hit, so a missing method throws inside the loop and takes every
 * source ordered after it down with it). The picker is this source's
 * only door.
 */
export function createForgeSource() {
	return {
		/* `trigger` MUST stay "@": the official `TriggerChar` union is
		   `'/' | '@'`, this field is the lexicon's key domain, and the
		   candidate roster is keyed off it. It is NOT what the user sees —
		   the chip's marker comes from `codec.clipboardText`, which is only
		   the clipboard/persistence projection. Keeping them different is
		   the point: "@" would wake the official attachment/reference menu
		   on the same keystroke as our chip. */
		trigger: "@",
		name: FORGE_SOURCE,
		/* Empty, but a function: the roster loop calls it on every hit. */
		candidates: async () => [],
		onPick: () => undefined,
		codec: {
			clipboardText: (ref) => forgeClipboardText(ref),
			serialize: async (ref, signal) => {
				if (signal && signal.aborted === true) throw new Error("aborted");
				// No preferred cwd: `snapshot.current` is a field the session
				// controller never publishes, so `fetchForgeItem` scans every
				// Session cwd instead.
				const item = await fetchForgeItem(null, ref, signal);
				if (signal && signal.aborted === true) throw new Error("aborted");
				return renderForgeReferenceText(item);
			},
		},
	};
}


/**
 * Register the composer surface: the reference source and the row's round
 * button. The source rides the same effect as the slot, so a chip inserted by
 * the picker can never outlive its serializer.
 * @param ctx - the bundle's root context.
 */
export function registerForgeComposer(ctx) {
  return ctx.inject(['inputTriggers'], (triggerCtx) => {
    triggerCtx.effect(
      () => triggerCtx.inputTriggers.registerSource(createForgeSource()),
      'bw-forge: forge reference source',
    );
    triggerCtx.slots.inject('conversation.input.left', () => triggerCtx.slots.register({
      name: 'conversation.input.left',
      id: 'forge-issue-pr',
      order: 200,
      locale: 'bw-forge',
      inject: (sessionId) => ({ sessionId }),
    }, ForgeAttachControl));
  });
}
