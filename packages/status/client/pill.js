/**
 * The composer's diff pill: the one-click door to the right-sidebar 代码变更
 * page and the only always-visible git summary in the conversation.
 *
 * The pill knows the diff page by its stable tab `kind` (`bw-diff`) and never
 * imports the diff bundle: if that row is disabled the click simply has no page
 * to open, and every other row keeps working.
 */
import { h, useEffect, useSyncExternalStore } from '@ds-hu/dsh-bw-core/client/react.js';
import { useStore } from '@ds-hu/dsh-bw-core/client/store.js';
import { useGitCwd, gitCwd, snapshotMutationKnown } from '@ds-hu/dsh-bw-core/client/feed.js';
import { getAppCtx, getFeed } from '@ds-hu/dsh-bw-core/client/runtime.js';
import { effectiveSessionCwd } from '@ds-hu/dsh-bw-core/client/session.js';
import { fmtNum } from '@ds-hu/dsh-bw-core/client/util.js';
import { t } from '@ds-hu/dsh-bw-core/client/i18n.js';

/** The diff page's stable type discriminator (owned by the bw-diff bundle). */
export const SIDEBAR_DIFF_KIND = 'bw-diff';

/** Whether this page can be opened at all: the official right column is up. */
export function sidebarAvailable() {
  const appCtx = getAppCtx();
  return Boolean(appCtx && typeof appCtx.get === 'function' && appCtx.get('sidebarRight'));
}

/**
 * Open (or reveal) the diff page in the official right Sidebar. The column
 * expands in the same step, and an already-open diff tab is revealed rather
 * than duplicated, because a page deduplicates within its pane.
 */
export function openDiffTab() {
  const appCtx = getAppCtx();
  const sidebarRight = appCtx && typeof appCtx.get === 'function' ? appCtx.get('sidebarRight') : undefined;
  if (!sidebarRight || typeof sidebarRight.openTab !== 'function') return;
  try {
    sidebarRight.openTab(SIDEBAR_DIFF_KIND);
  } catch {
    /* no mounted right-column seat: nothing to open into */
  }
}

export { snapshotMutationKnown };

/** The pill's factual label: diffstat, then dirty count, then unpushed, then the bare tab name. */
export function pillLabel(snapshot, translate) {
  const known = snapshot.gitKnown || {};
  const stat = known.head === false || known.diffStat === false ? null : snapshot.diffStat;
  if (stat && (stat.additions > 0 || stat.deletions > 0)) {
    return h('span', null,
      stat.additions > 0 ? h('span', { className: 'dsh-bw-green' }, '+' + fmtNum(stat.additions)) : null,
      stat.additions > 0 && stat.deletions > 0 ? ' ' : null,
      stat.deletions > 0 ? h('span', { className: 'dsh-bw-red' }, '−' + fmtNum(stat.deletions)) : null);
  }
  if (known.head !== false && known.status !== false && snapshot.dirty) {
    return h('span', null, translate('pill.dirty', { n: snapshot.changedFileCount || 0 }));
  }
  const ahead = known.head === false ? 0 : snapshot.upstream ? snapshot.upstream.ahead : 0;
  if (ahead > 0) return h('span', null, '↑' + ahead + ' ' + translate('diff.unpushed'));
  return h('span', null, translate('view.diff'));
}

/** The composer dock occupant. */
export function GitDiffPill(props) {
  const feed = getFeed();
  const appCtx = getAppCtx();
  const sessionId = props.sessionId;
  const sessions = appCtx.sessions;
  const listState = useSyncExternalStore(
    (listener) => sessions.list.subscribe(listener),
    () => sessions.list.getSnapshot(),
    () => sessions.list.getSnapshot(),
  );
  const summary = sessionId ? listState.byId[sessionId] : undefined;
  const cwd = useGitCwd(effectiveSessionCwd(summary));
  const snapshot = useStore(feed.store, (s) => (cwd ? s.byCwd[cwd] : undefined));
  useEffect(() => {
    if (!cwd) return undefined;
    feed.track(cwd);
    return () => feed.untrack(cwd);
  }, [cwd]);
  // The pill is the diff page's only door: a clean git session keeps the pill
  // (showing "diff") instead of dropping the view out of reach.
  if (!cwd || !snapshot || !snapshot.isGit || !sidebarAvailable()) return null;
  return h('button', {
    type: 'button', className: 'dsh-bw-pill', title: t('pill.title'),
    onClick: () => openDiffTab(),
  },
  h('span', { className: 'dsh-bw-pill-icon' }, '±'),
  pillLabel(snapshot, t));
}

export { gitCwd };
