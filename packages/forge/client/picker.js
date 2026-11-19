/**
 * The forge picker dialog (`bw-forge`): one searchable page of issues + PRs,
 * local filtering, keyboard trap, and an atomic pick path.
 */
import { h, useState, useRef, useEffect } from '@ds-hu/dsh-bw-core/client/react.js';
import { apiGet, qs } from '@ds-hu/dsh-bw-core/client/api.js';
import { t } from '@ds-hu/dsh-bw-core/client/i18n.js';
import { failureMessage } from '@ds-hu/dsh-bw-core/client/util.js';
import { ForgeItemRow } from './picker-parts.js';
import { forgeItemKey, cacheForgeItem } from './forge-data.js';

export function ForgePicker(props) {
	const [query, setQuery] = useState("");
	const [state, setState] = useState({ status: "loading", items: [], authState: null, error: null });
	const inputRef = useRef(null);
	const dialogRef = useRef(null);
	const previousFocus = useRef(null);
	const closeRef = useRef(props.onClose);
	closeRef.current = props.onClose;

	useEffect(() => {
		let alive = true;
		const controller = new AbortController();
		setState({ status: "loading", items: [], authState: null, error: null });
		apiGet("/pulls" + qs({ cwd: props.cwd }), controller.signal)
			.then((result) => {
				if (!alive) return;
				if (!result || !result.ok) {
					setState({ status: "error", items: [], authState: null, error: failureMessage(result) || t("forge.loadFailed") });
					return;
				}
				for (const item of result.items || []) { const key = forgeItemKey(item); if (key) cacheForgeItem(key, item); }
				setState({ status: "ready", items: result.items || [], authState: result.authState || null, error: result.authState === "partial" ? result.error || t("forge.loadFailed") : null });
			})
			.catch((error) => {
				if (alive) setState({ status: "error", items: [], authState: null, error: String((error && error.message) || error) });
			});
		return () => { alive = false; controller.abort(); };
	}, [props.cwd]);

	useEffect(() => {
		previousFocus.current = document.activeElement;
		if (inputRef.current) inputRef.current.focus();
		const onKey = (event) => {
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
				closeRef.current();
				return;
			}
			if (event.key !== "Tab" || !dialogRef.current) return;
			const focusable = [...dialogRef.current.querySelectorAll('button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])')]
				.filter((node) => !node.hidden && node.getAttribute("aria-hidden") !== "true");
			if (!focusable.length) return;
			const first = focusable[0];
			const last = focusable[focusable.length - 1];
			if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
			else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
		};
		document.addEventListener("keydown", onKey, true);
		return () => {
			document.removeEventListener("keydown", onKey, true);
			const target = previousFocus.current;
			if (target && target.isConnected && typeof target.focus === "function") target.focus();
		};
	}, []);

	const needle = query.trim().toLowerCase();
	const items = needle === ""
		? state.items
		: state.items.filter((item) =>
			String(item.number).indexOf(needle) !== -1 ||
			(item.title || "").toLowerCase().indexOf(needle) !== -1);

	let body;
	if (state.status === "loading") body = h("div", { className: "dsh-bw-forge-empty", role: "status", "aria-live": "polite" }, t("diff.loading"));
	else if (state.status === "error") body = h("div", { className: "dsh-bw-forge-empty", role: "alert" }, state.error);
	else if (state.authState && state.authState !== "authenticated" && state.authState !== "partial") {
		body = h("div", { className: "dsh-bw-forge-empty", role: "alert" }, t("forge.auth." + state.authState));
	} else if (items.length === 0) {
		body = h("div", { className: "dsh-bw-forge-empty", role: "status", "aria-live": "polite" }, t(needle === "" ? "forge.empty" : "forge.noResults"));
	} else {
		body = h("div", null,
			state.authState === "partial" ? h("div", { className: "dsh-bw-forge-empty", role: "status", "aria-live": "polite" }, state.error) : null,
			h("div", { className: "dsh-bw-forge-list" }, items.map((item) => h(ForgeItemRow, {
				key: item.kind + ":" + item.number, item,
				attached: props.attached.indexOf(forgeItemKey(item)) !== -1,
				onPick: props.onPick,
			}))));
	}

	return h("div", {
		className: "dsh-bw-forge-overlay",
		onMouseDown: (event) => { if (event.target === event.currentTarget) props.onClose(); },
	},
		h("div", {
			ref: dialogRef, className: "dsh-bw-forge-dialog", role: "dialog", "aria-modal": "true",
			"aria-labelledby": "dsh-bw-forge-title", "aria-describedby": "dsh-bw-forge-hint",
		},
			h("div", { className: "dsh-bw-forge-head" },
				h("div", { id: "dsh-bw-forge-title", className: "dsh-bw-forge-titlebar" }, t("forge.pickerTitle")),
				h("input", {
					ref: inputRef, className: "dsh-bw-forge-search", type: "text", "aria-label": t("forge.searchPlaceholder"),
					value: query, placeholder: t("forge.searchPlaceholder"),
					onChange: (event) => setQuery(event.target.value),
				}),
				h("button", { type: "button", className: "dsh-bw-forge-close", onClick: props.onClose, "aria-label": t("forge.close") }, "×")),
			body,
			h("div", { id: "dsh-bw-forge-hint", className: "dsh-bw-forge-hint" }, t("forge.hint"))));
}
