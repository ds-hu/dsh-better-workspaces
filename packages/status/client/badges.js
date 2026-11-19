/**
 * The workspace-row badge line: branch, PR state/checks, diff stat and sync
 * delta, rendered into the shell's Workspace row by the sidebar injector.
 */
import { h, useEffect } from '@ds-hu/dsh-bw-core/client/react.js';
import { useStore } from '@ds-hu/dsh-bw-core/client/store.js';
import { useGitCwd, syncOf } from '@ds-hu/dsh-bw-core/client/feed.js';
import { getFeed } from '@ds-hu/dsh-bw-core/client/runtime.js';
import { fmtNum } from '@ds-hu/dsh-bw-core/client/util.js';
import { ChecksRing, PrNumBadge } from '@ds-hu/dsh-bw-core/client/ui.js';

export { syncOf };

/** One badge line for one Workspace checkout. */
export function Badges({ cwd: rawCwd }) {
  const feed = getFeed();
  const cwd = useGitCwd(rawCwd);
  const snapshot = useStore(feed.store, (s) => (cwd ? s.byCwd[cwd] : undefined));
  useEffect(() => {
    if (!cwd) return undefined;
    feed.track(cwd);
    return () => feed.untrack(cwd);
  }, [cwd]);
  if (!snapshot || !snapshot.isGit) return null;
  const badges = [];
  const known = snapshot.gitKnown || {};
  const branchName = known.head === false ? null : snapshot.branch ?? (snapshot.detached ? '@' + (snapshot.detachedShort || '') : null);
  if (branchName) {
    badges.push(h('span', { key: 'br', className: 'dsh-bw-badge dsh-bw-badge-branch', title: branchName }, branchName));
  }
  if (known.head !== false && snapshot.pr && snapshot.pr.number) {
    badges.push(h(PrNumBadge, { key: 'pr', pr: snapshot.pr }));
    if (snapshot.pr.checks && snapshot.pr.checks.status !== 'none' && (snapshot.pr.checks.total || 0) > 0) {
      badges.push(h(ChecksRing, { key: 'ck', checks: snapshot.pr.checks }));
    }
  }
  const stat = known.diffStat === false ? null : snapshot.diffStat;
  if (stat && (stat.additions > 0 || stat.deletions > 0)) {
    badges.push(h('span', { key: 'ds', className: 'dsh-bw-badge dsh-bw-badge-diff' },
      stat.additions > 0 ? h('span', { className: 'dsh-bw-green' }, '+' + fmtNum(stat.additions)) : null,
      stat.additions > 0 && stat.deletions > 0 ? ' ' : null,
      stat.deletions > 0 ? h('span', { className: 'dsh-bw-red' }, '−' + fmtNum(stat.deletions)) : null));
  }
  const sync = syncOf(snapshot);
  if ((sync.ahead || 0) > 0 || (sync.behind || 0) > 0) {
    badges.push(h('span', { key: 'sy', className: 'dsh-bw-badge dsh-bw-badge-diff' },
      (sync.ahead || 0) > 0 ? h('span', { title: 'ahead' }, '↑' + sync.ahead) : null,
      (sync.ahead || 0) > 0 && (sync.behind || 0) > 0 ? ' ' : null,
      (sync.behind || 0) > 0 ? h('span', { title: 'behind' }, '↓' + sync.behind) : null));
  }
  if (badges.length === 0) return null;
  return badges;
}
