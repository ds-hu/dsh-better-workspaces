/**
 * Shared picker pieces (`bw-forge`): the list-row markup and the list loader.
 *
 * The composer picker and the 右侧栏 Issue 与 PR page render the same rows from
 * the same route, so auth states and item identity can never drift between the
 * two surfaces.
 */
import { h, useState, useRef, useEffect, useCallback } from '@ds-hu/dsh-bw-core/client/react.js';
import { apiGet, qs } from '@ds-hu/dsh-bw-core/client/api.js';
import { useGitCwd } from '@ds-hu/dsh-bw-core/client/feed.js';
import { effectiveSessionCwd } from '@ds-hu/dsh-bw-core/client/session.js';
import { failureMessage } from '@ds-hu/dsh-bw-core/client/util.js';
import { t } from '@ds-hu/dsh-bw-core/client/i18n.js';
import { getAppCtx } from '@ds-hu/dsh-bw-core/client/runtime.js';
import { forgeItemKey, cacheForgeItem, attachForgeReference } from './forge-data.js';

export { attachForgeReference };

export function ForgeItemRow(props) {
	const item = props.item;
	return h("button", {
		type: "button", className: "dsh-bw-forge-row", "data-attached": String(Boolean(props.attached)),
		disabled: Boolean(props.attached), "aria-disabled": Boolean(props.attached),
		onClick: () => props.onPick(item),
	},
		h("span", { className: "dsh-bw-forge-icon" },
			item.kind === "change_request" ? h(PullIcon) : h(IssueIcon)),
		h("span", { className: "dsh-bw-forge-num" }, "#" + item.number),
		h("span", { className: "dsh-bw-forge-title" }, item.title || ""),
		h("span", { className: "dsh-bw-forge-meta" },
			item.kind === "change_request" && item.fork ? t("forge.fork") : item.state || ""));
}

function PullIcon() {
	return h("svg", { width: "13", height: "13", viewBox: "0 0 16 16", fill: "currentColor", "aria-hidden": "true" },
		h("path", { d: "M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z" }));
}

function IssueIcon() {
	return h("svg", { width: "13", height: "13", viewBox: "0 0 16 16", fill: "currentColor", "aria-hidden": "true" },
		h("path", { d: "M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z" }),
		h("path", { d: "M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z" }));
}

/** The picker: one searchable page of issues + PRs, local filtering. */

/**
 * Load the repository's issues + PRs for one Session.
 *
 * The hook is the composer picker's data path, lifted so the sidebar page reads
 * exactly the same payload: `{ items, authState, loading, error, reload }`.
 * @param args.sessionId - Session whose checkout is asked about.
 */
export function useForgeItems({ sessionId } = {}) {
  const appCtx = getAppCtx();
  const sessions = appCtx.sessions;
  const getSummary = useCallback(() => {
    try {
      const snapshot = sessions.list.getSnapshot();
      return sessionId ? snapshot.byId[sessionId] : undefined;
    } catch {
      return undefined;
    }
  }, [sessionId]);
  const summary = getSummary();
  const cwd = useGitCwd(effectiveSessionCwd(summary));
  const [state, setState] = useState({ items: [], authState: null, loading: true, error: null });
  const token = useRef(0);

  const reload = useCallback(async () => {
    if (!cwd) {
      setState({ items: [], authState: null, loading: false, error: null });
      return;
    }
    const seq = ++token.current;
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const result = await apiGet('/pulls' + qs({ cwd }));
      if (seq !== token.current) return;
      if (!result || !result.ok) {
        setState({
          items: [], authState: null, loading: false,
          error: failureMessage(result) || t('forge.loadFailed'),
        });
        return;
      }
      for (const item of result.items || []) {
        const key = forgeItemKey(item);
        if (key) cacheForgeItem(key, item);
      }
      setState({
        items: result.items || [],
        authState: result.authState || null,
        loading: false,
        error: result.authState === 'partial' ? result.error || t('forge.loadFailed') : null,
      });
    } catch (error) {
      if (seq !== token.current) return;
      setState({ items: [], authState: null, loading: false, error: String((error && error.message) || error) });
    }
  }, [cwd]);

  useEffect(() => {
    reload();
    return () => { token.current += 1; };
  }, [reload]);

  return { ...state, cwd, reload };
}
