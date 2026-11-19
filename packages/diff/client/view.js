/**
 * The 代码变更 view: uncommitted / vs-base / task / per-session modes, the
 * commit list, the action ladder, the archive saga and the file editor pane.
 *
 * The view is a pure function of the git feed + its own HTTP reads; the
 * right-sidebar page and the composer pill are only doors to it.
 */
import {
  h, react, useState, useRef, useCallback, useEffect, useSyncExternalStore,
} from '@ds-hu/dsh-bw-core/client/react.js';
import { useStore } from '@ds-hu/dsh-bw-core/client/store.js';
import {
  apiGet, apiPost, qs, createRequestOwner, requireOwnership,
} from '@ds-hu/dsh-bw-core/client/api.js';
import { getAppCtx, getFeed, getLifecycleEpoch } from '@ds-hu/dsh-bw-core/client/runtime.js';
import { useGitCwd, syncOf, snapshotMutationKnown } from '@ds-hu/dsh-bw-core/client/feed.js';
import { cx, fmtNum, fmtRelTime, failureMessage } from '@ds-hu/dsh-bw-core/client/util.js';
import { effectiveSessionCwd, currentSessionId } from '@ds-hu/dsh-bw-core/client/session.js';
import { sessionTouchedPaths, sessionsHaveEmptyDrafts } from '@ds-hu/dsh-bw-core/client/draft.js';
import {
  workspaceItems, workspaceSnapshot, acquireWorkspaceMutation, openWorkspaceFor,
} from '@ds-hu/dsh-bw-core/client/workspace.js';
import {
  Popover, MenuList, PrNumBadge, ChecksRing, StatusLetter,
} from '@ds-hu/dsh-bw-core/client/ui.js';
import { t, lang } from '@ds-hu/dsh-bw-core/client/i18n.js';
import { FileEditor } from './editor.js';
import { workspaceArchiveBlocks, clearArchiveBlocks } from './archive.js';

function useCwd(sessionId) {
  const appCtx = getAppCtx();
  const sessions = appCtx.sessions;
  const get = useCallback(() => {
    try {
      const snapshot = sessions.list.getSnapshot();
      const summary = sessionId ? snapshot.byId[sessionId] : undefined;
      return effectiveSessionCwd(summary);
    } catch {
      return null;
    }
  }, [sessionId, sessions]);
  const raw = useSyncExternalStore((listener) => sessions.list.subscribe(listener), get, get);
  return useGitCwd(raw);
}

function useRunning(sessionId) {
  const appCtx = getAppCtx();
  const sessions = appCtx.sessions;
  const get = useCallback(() => {
    try {
      const snapshot = sessions.list.getSnapshot();
      const summary = sessionId ? snapshot.byId[sessionId] : undefined;
      return Boolean(summary && summary.running);
    } catch {
      return false;
    }
  }, [sessionId, sessions]);
  return useSyncExternalStore((listener) => sessions.list.subscribe(listener), get, get);
}

function Hunk({ hunk, wrap }) {
  let oldNo = hunk.oldStart;
  let newNo = hunk.newStart;
  return h('div', { className: 'dsh-bw-hunk' },
    h('div', { className: 'dsh-bw-hunkhdr' }, '@@ -' + hunk.oldStart + ',' + hunk.oldCount + ' +' + hunk.newStart + ',' + hunk.newCount + '@@' + (hunk.header ? ' ' + hunk.header : '')),
    hunk.lines.map((line, index) => {
      let oldCell = '';
      let newCell = '';
      if (line.type === 'del' || line.type === 'ctx') { oldCell = String(oldNo); oldNo += 1; }
      if (line.type === 'add' || line.type === 'ctx') { newCell = String(newNo); newNo += 1; }
      return h('div', {
        key: index,
        className: cx('dsh-bw-line', line.type === 'add' && 'dsh-bw-line-add', line.type === 'del' && 'dsh-bw-line-del', line.type === 'meta' && 'dsh-bw-line-meta', wrap && 'dsh-bw-wrap'),
      },
      h('span', { className: 'dsh-bw-ln' }, oldCell),
      h('span', { className: 'dsh-bw-ln' }, newCell),
      h('span', { className: 'dsh-bw-code' }, line.content));
    }));
}

function FileDiff({ file, wrap, anchorId, onEdit }) {
  const [open, setOpen] = useState(true);
  const bodyId = anchorId + '-body';
  return h('div', { className: 'dsh-bw-file', id: anchorId },
    h('div', { className: 'dsh-bw-filehead' },
      h('button', {
        type: 'button', className: 'dsh-bw-filetoggle', 'aria-expanded': open,
        'aria-controls': bodyId, onClick: () => setOpen((o) => !o),
      },
      h('span', { className: 'dsh-bw-caret', 'aria-hidden': 'true' }, open ? '▾' : '▸'),
      h(StatusLetter, { status: file.status }),
      h('span', { className: 'dsh-bw-filepath', title: file.oldPath ? file.oldPath + ' → ' + file.path : file.path },
        file.oldPath ? file.oldPath + ' → ' + file.path : file.path),
      h('span', { className: 'dsh-bw-filestat' },
        file.status === 'binary' ? t('diff.binary')
          : file.status === 'too_large' ? t('diff.tooLarge')
            : h(react.Fragment, null,
              h('span', { className: 'dsh-bw-green' }, '+' + fmtNum(file.additions || 0)), ' ',
              h('span', { className: 'dsh-bw-red' }, '−' + fmtNum(file.deletions || 0))))),
      onEdit && file.status !== 'binary' && file.status !== 'too_large' && file.status !== 'deleted'
        ? h('button', {
          type: 'button', className: 'dsh-bw-btn dsh-bw-fileedit',
          onClick: () => onEdit(file.path),
        }, t('diff.editFile'))
        : null),
    h('div', { id: bodyId, hidden: !open },
      file.status === 'binary' || file.status === 'too_large'
        ? h('div', { className: 'dsh-bw-notice' }, file.status === 'binary' ? t('diff.binaryBody') : t('diff.tooLargeBody'))
        : (file.hunks || []).map((hunk, index) => h(Hunk, { key: index, hunk, wrap }))));
}

/** Session-aware wrapper: resolves cwd and the agent-running flag. */
export function DiffView(props) {
  const sessionId = props.sessionId;
  const cwd = useCwd(sessionId);
  const agentRunning = useRunning(sessionId);
  return h(DiffViewResource, {
    ...props, key: `${sessionId || ''}\u0000${cwd || ''}`, cwd, agentRunning,
  });
}

function DiffViewResource(props) {
  const appCtx = getAppCtx();
  const feed = getFeed();
  const sessionId = props.sessionId;
  // Keying the resource body by Session+cwd prevents a render from ever pairing
  // a new mutation target with the previous target's action state.
  const visible = props.visible !== false;
  const cwd = props.cwd;
  const agentRunning = props.agentRunning;
  const snapshot = useStore(feed.store, (s) => (cwd ? s.byCwd[cwd] : undefined));
  useEffect(() => {
    if (!cwd) return undefined;
    feed.track(cwd);
    return () => feed.untrack(cwd);
  }, [cwd]);

  const [mode, setMode] = useState('uncommitted');
  const [touched, setTouched] = useState(null);
  const [detectLite, setDetectLite] = useState(null);
  const [taskMissing, setTaskMissing] = useState(false);
  const [pane, setPane] = useState('files');
  const [diff, setDiff] = useState(null);
  const [commits, setCommits] = useState(null);
  const [selectedCommit, setSelectedCommit] = useState(null);
  const [actions, setActions] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [editingFile, setEditingFile] = useState(null);
  const [running, setRunning] = useState(null);
  const [banner, setBanner] = useState(null);
  const [ignoreWs, setIgnoreWs] = useState(false);
  const [wrap, setWrap] = useState(false);
  const [commitMsg, setCommitMsg] = useState('');
  const [rev, setRev] = useState(0);
  const lastAutoRefetch = useRef(0);
  const requestOwner = useRef(null);
  if (!requestOwner.current) requestOwner.current = createRequestOwner();
  const actionLock = useRef(false);
  const commitBackRef = useRef(null);
  const commitButtonRefs = useRef(new Map());
  const returnCommitFocus = useRef(null);
  useEffect(() => {
    if (selectedCommit && commitBackRef.current) commitBackRef.current.focus();
    else if (!selectedCommit && returnCommitFocus.current) {
      const target = commitButtonRefs.current.get(returnCommitFocus.current);
      returnCommitFocus.current = null;
      if (target) target.focus();
    }
  }, [selectedCommit]);
  useEffect(() => () => requestOwner.current.reset(), [cwd, sessionId]);
  // paseo-parity defaults: a managed worktree session's history IS the task diff
  // (base..worktree); a shared-workspace session falls back to its own
  // transcript-attributed files, then to plain uncommitted
  useEffect(() => {
    let alive = true;
    setDetectLite(null);
    setTouched(null);
    setTaskMissing(false);
    if (!cwd) return undefined;
    (async () => {
      let det;
      try { det = await apiGet('/detect' + qs({ path: cwd })); } catch { /* unavailable */ }
      if (!alive) return;
      if (det && det.ok) setDetectLite(det);
      // /detect answers managed=true exactly when worktree metadata exists; the
      // task route re-guards the base ref itself
      if (det && det.ok && det.isLinkedWorktree && det.managed) {
        setMode('task');
        return;
      }
      const paths = await sessionTouchedPaths(sessionId, cwd);
      if (!alive) return;
      setTouched(paths);
      setMode(paths && paths.size > 0 ? 'session' : 'uncommitted');
    })();
    return () => { alive = false; };
  }, [cwd, sessionId]);

  useEffect(() => {
    if (mode !== 'session' || !cwd) return undefined;
    let alive = true;
    sessionTouchedPaths(sessionId, cwd, true).then((paths) => { if (alive) setTouched(paths); });
    return () => { alive = false; };
  }, [mode, rev, sessionId, cwd]);

  // auto refetch when the hub pushes a new snapshot revision (max 1 per 3s)
  const snapshotAt = snapshot ? snapshot.at : 0;
  useEffect(() => {
    if (!cwd || !visible) return;
    const now = Date.now();
    if (now - lastAutoRefetch.current < 3000) return;
    lastAutoRefetch.current = now;
    setRev((r) => r + 1);
  }, [snapshotAt, cwd, visible]);

  // coming back into view is a reason to refresh at once
  const wasVisible = useRef(visible);
  useEffect(() => {
    const previous = wasVisible.current;
    wasVisible.current = visible;
    if (!visible || previous) return;
    lastAutoRefetch.current = Date.now();
    setRev((r) => r + 1);
  }, [visible]);

  const load = useCallback(async () => {
    if (!cwd) return;
    const token = requestOwner.current.begin('diff-load');
    const commitSha = pane === 'commits' && selectedCommit ? selectedCommit.sha : undefined;
    try {
      const [diffResult, actionsResult] = await Promise.all([
        apiGet('/diff' + qs({ cwd, mode, w: ignoreWs ? 1 : '', commit: commitSha }), token.controller.signal),
        apiGet('/actions' + qs({ cwd, running: agentRunning ? 1 : '' }), token.controller.signal),
      ]);
      requireOwnership(requestOwner.current, token);
      let commitsResult = null;
      if ((mode === 'base' || mode === 'task') && pane === 'commits' && !selectedCommit) {
        commitsResult = await apiGet('/commits' + qs({
          cwd,
          base: mode === 'task' && diffResult && diffResult.ok ? diffResult.refs.baseRef : undefined,
        }), token.controller.signal);
        requireOwnership(requestOwner.current, token);
      }
      if (diffResult && diffResult.ok) setDiff(diffResult);
      else if (diffResult && diffResult.error === 'task-base-missing') {
        setTaskMissing(true);
        setMode('uncommitted');
      }
      if (actionsResult && actionsResult.ok) setActions(actionsResult);
      if (commitsResult && commitsResult.ok) setCommits(commitsResult);
    } catch { /* transient, superseded, or hidden */ }
    finally { requestOwner.current.end(token); }
  }, [cwd, mode, pane, selectedCommit ? selectedCommit.sha : '', ignoreWs, agentRunning, rev]);

  useEffect(() => {
    setDiff(null);
    setEditingFile(null);
    load();
  }, [load]);

  function localizeFailure(result) {
    let text = result.reasonKey ? t(result.reasonKey, result.params || {}) : result.message || t('actions.failed');
    if (result.conflictFiles && result.conflictFiles.length > 0) text += ': ' + result.conflictFiles.join(', ');
    if (result.recoveryCwd) text += ' · ' + t('actions.merge.recoveryCwd', { cwd: result.recoveryCwd });
    return text;
  }

  async function runAction(name, params, confirmText) {
    if (actionLock.current) return;
    if (confirmText && !window.confirm(confirmText)) return;
    const sourceId = sessionId;
    const archiveWorkspace = name === 'archive' ? workspaceItems().find((item) => item.path === cwd) : null;
    const archiveSessionIds = archiveWorkspace && Array.isArray(archiveWorkspace.sessionIds)
      ? archiveWorkspace.sessionIds.slice() : null;
    const archivedAtStart = new Set((workspaceSnapshot().archivedSessionIds || []).map(String));
    const archiveLiveSessionIds = archiveSessionIds
      ? archiveSessionIds.map(String).filter((id) => !archivedAtStart.has(id)) : null;
    if (name === 'archive' && (!archiveWorkspace || typeof archiveWorkspace.workspaceId !== 'string'
      || !archiveSessionIds || archiveLiveSessionIds.length !== 1 || archiveLiveSessionIds[0] !== sourceId
      || !sessionsHaveEmptyDrafts(appCtx.sessions, archiveLiveSessionIds))) {
      setBanner({ kind: 'err', text: t('actions.archive.draftBlocked') });
      return;
    }
    const releaseMutation = acquireWorkspaceMutation(cwd);
    if (!releaseMutation) return;
    actionLock.current = true;
    const archiveMainRoot = name === 'archive' && snapshot ? snapshot.mainRepoRoot : null;
    const token = requestOwner.current.begin('action');
    const sagaLifecycleEpoch = getLifecycleEpoch();
    const blockedArchiveIds = name === 'archive' ? archiveLiveSessionIds : [];
    if (blockedArchiveIds.length > 0) {
      let conversation = null;
      try { conversation = appCtx.get('conversation'); } catch { /* unavailable */ }
      for (const blockedId of blockedArchiveIds) {
        workspaceArchiveBlocks.set(blockedId, token);
        try { if (conversation && conversation.blocks) conversation.blocks.set(blockedId, { reason: t('actions.archive.confirm') }); } catch { /* cosmetic */ }
      }
    }
    setRunning(name);
    setBanner(null);
    try {
      if (name === 'archive' && !sessionsHaveEmptyDrafts(appCtx.sessions, blockedArchiveIds)) {
        throw new Error(t('actions.archive.draftBlocked'));
      }
      const requestParams = name === 'archive'
        ? { ...(params || {}), deferWorkspaceDelete: true }
        : params || {};
      let result = await apiPost('/action', { cwd, name, params: requestParams });
      if (!(name === 'archive' && result && result.ok)) requireOwnership(requestOwner.current, token);
      if (result && !result.ok && name === 'archive' && result.reason === 'unsafe') {
        const forced = window.confirm(t('actions.archive.unsafeConfirm', { message: result.message || '' }));
        if (forced) result = await apiPost('/action', { cwd, name, params: { ...requestParams, force: true } });
        requireOwnership(requestOwner.current, token);
      }
      if (result && result.ok) {
        if (name === 'archive') {
          if (getLifecycleEpoch() !== sagaLifecycleEpoch
            || workspaceArchiveBlocks.get(sourceId) !== token) return;
          if (!archiveMainRoot || result.workspaceId !== archiveWorkspace.workspaceId
            || !Array.isArray(result.workspaceSessionIds)) {
            throw new Error('archive Workspace receipt is incomplete');
          }
          const authoritativeSessionIds = result.workspaceSessionIds.map(String);
          const archivedNow = new Set((workspaceSnapshot().archivedSessionIds || []).map(String));
          const authoritativeLiveIds = authoritativeSessionIds.filter((id) => !archivedNow.has(id));
          if (authoritativeLiveIds.length > 0 && (authoritativeLiveIds.length !== 1
            || authoritativeLiveIds[0] !== sourceId
            || !sessionsHaveEmptyDrafts(appCtx.sessions, authoritativeLiveIds))) {
            throw new Error(t('actions.archive.draftBlocked'));
          }
          const settledCurrent = currentSessionId();
          if (settledCurrent === sourceId) await openWorkspaceFor(archiveMainRoot, sourceId);
          if (getLifecycleEpoch() !== sagaLifecycleEpoch
            || workspaceArchiveBlocks.get(sourceId) !== token
            || !sessionsHaveEmptyDrafts(appCtx.sessions, authoritativeLiveIds)) return;
          for (const archivedId of authoritativeLiveIds) {
            if (getLifecycleEpoch() !== sagaLifecycleEpoch
              || workspaceArchiveBlocks.get(sourceId) !== token) return;
            await appCtx.workspaces.archiveSession(archivedId);
          }
          if (getLifecycleEpoch() !== sagaLifecycleEpoch
            || workspaceArchiveBlocks.get(sourceId) !== token) return;
          if (result.workspaceDeletionToken) {
            const finalized = await apiPost('/worktrees/finalize-delete', {
              cwd: archiveMainRoot,
              token: result.workspaceDeletionToken,
            });
            if (!finalized || !finalized.ok) throw new Error(failureMessage(finalized) || 'workspace deletion finalization failed');
          }
          return;
        }
        setBanner({ kind: 'ok', text: t('actions.' + name + '.done') + (result.url ? ' · ' + result.url : '') });
        if (name === 'commit') setCommitMsg('');
        lastAutoRefetch.current = Date.now();
        feed.refresh(cwd);
        setRev((r) => r + 1);
      } else setBanner({ kind: 'err', text: localizeFailure(result || {}) });
    } catch (e) {
      if (requestOwner.current.owns(token)) setBanner({ kind: 'err', text: String((e && e.message) || e) });
    } finally {
      if (requestOwner.current.owns(token)) setRunning(null);
      requestOwner.current.end(token);
      clearArchiveBlocks(blockedArchiveIds, token);
      actionLock.current = false;
      releaseMutation();
    }
  }

  if (!cwd) return h('div', { className: 'dsh-bw-view' }, h('div', { className: 'dsh-bw-empty' }, t('diff.loading')));
  if (snapshot && snapshot.isGit === false) {
    return h('div', { className: 'dsh-bw-view' }, h('div', { className: 'dsh-bw-empty' }, t('diff.notGit')));
  }

  // Core Workspace/Agent services currently expose no cross-page retiring lease.
  // Hide manual physical archive rather than race another page's draft or Agent
  // admission; Host independently fails closed as well.
  const ladder = ((actions && actions.ladder) || []).filter((entry) => entry.id !== 'archive');
  const pr = snapshot ? snapshot.pr : null;
  const sync = snapshot ? syncOf(snapshot) : { ahead: 0, behind: 0 };
  const enabled = ladder.filter((entry) => !entry.disabled && entry.id !== 'openPr');
  const primary = enabled.length > 0 ? enabled[0] : null;
  const rest = ladder.filter((entry) => entry !== primary && entry.id !== 'openPr');

  function onPrimary() {
    if (!primary) return;
    if (primary.id === 'commit') {
      if (!commitMsg.trim()) { setBanner({ kind: 'err', text: t('actions.commit.noMessage') }); return; }
      runAction('commit', { message: commitMsg.trim(), addAll: true });
      return;
    }
    if (primary.id === 'discard') { runAction('discard', {}, t('actions.discard.confirm')); return; }
    if (primary.id === 'archive') { runAction('archive', { path: cwd }, t('actions.archive.confirm')); return; }
    runAction(primary.id, {});
  }

  function onMenuAction(id) {
    if (id === 'commit') {
      if (!commitMsg.trim()) { setBanner({ kind: 'err', text: t('actions.commit.noMessage') }); return; }
      runAction('commit', { message: commitMsg.trim(), addAll: true });
      return;
    }
    if (id === 'discard') { runAction('discard', {}, t('actions.discard.confirm')); return; }
    if (id === 'archive') { runAction('archive', { path: cwd }, t('actions.archive.confirm')); return; }
    runAction(id, {});
  }

  const toolbar = h('div', { className: 'dsh-bw-toolbar' },
    h('div', { className: 'dsh-bw-seg' },
      h('button', { type: 'button', 'aria-pressed': mode === 'uncommitted', onClick: () => { setMode('uncommitted'); setSelectedCommit(null); } }, t('diff.modeUncommitted')),
      h('button', {
        type: 'button', 'aria-pressed': mode === 'session',
        disabled: touched !== null && touched.size === 0,
        title: touched === null ? t('diff.sessionUnavailable') : touched && touched.size === 0 ? t('diff.sessionEmpty') : undefined,
        onClick: () => { setMode('session'); setSelectedCommit(null); },
      }, t('diff.modeSession')),
      detectLite && detectLite.isLinkedWorktree && detectLite.managed
        ? h('button', { type: 'button', 'aria-pressed': mode === 'task', onClick: () => { setMode('task'); setSelectedCommit(null); } }, t('diff.modeTask'))
        : null,
      h('button', { type: 'button', 'aria-pressed': mode === 'base', onClick: () => { setMode('base'); setSelectedCommit(null); } }, t('diff.modeBase'))),
    snapshot && snapshot.branch
      ? h('span', { className: 'dsh-bw-branch' }, '⎇', h('span', { className: 'dsh-bw-branch-name', title: snapshot.branch }, snapshot.branch),
        snapshot.baseRefName && snapshot.baseRefName !== snapshot.branch ? h('span', { className: 'dsh-bw-menu-hint' }, '← ' + snapshot.baseRefName) : null)
      : null,
    snapshot && (sync.ahead > 0 || sync.behind > 0)
      ? h('span', { className: 'dsh-bw-sync' }, (sync.ahead > 0 ? '↑' + sync.ahead : '') + (sync.ahead > 0 && sync.behind > 0 ? ' ' : '') + (sync.behind > 0 ? '↓' + sync.behind : ''))
      : null,
    pr && pr.number
      ? h('span', { className: 'dsh-bw-pr' },
        h(PrNumBadge, { pr }),
        h('span', { className: 'dsh-bw-pr-title', title: pr.title }, pr.title),
        pr.isDraft ? h('span', { className: 'dsh-bw-menu-hint' }, t('diff.prDraft')) : null,
        pr.checks && pr.checks.status !== 'none' ? h(ChecksRing, { checks: pr.checks }) : null,
        pr.mergeable === 'CONFLICTING' ? h('span', { className: 'dsh-bw-red' }, t('diff.prConflicting')) : null,
        pr.url ? h('a', { href: pr.url, target: '_blank', rel: 'noreferrer' }, t('diff.openPr')) : null)
      : null,
    h('span', { className: 'dsh-bw-toolbar-spacer' }),
    h('label', { className: 'dsh-bw-check' },
      h('input', { type: 'checkbox', checked: ignoreWs, onChange: (e) => setIgnoreWs(e.target.checked) }),
      t('diff.ignoreWs')),
    h('label', { className: 'dsh-bw-check' },
      h('input', { type: 'checkbox', checked: wrap, onChange: (e) => setWrap(e.target.checked) }),
      t('diff.wrap')),
    h('button', { type: 'button', className: 'dsh-bw-btn', onClick: () => { feed.refresh(cwd); setRev((r) => r + 1); }, disabled: Boolean(running) }, t('diff.refresh')),
    primary
      ? h('button', {
        type: 'button', className: cx('dsh-bw-btn', 'dsh-bw-btn-primary', primary.id === 'discard' && 'dsh-bw-btn-danger'),
        onClick: onPrimary, disabled: Boolean(running),
      }, t('actions.' + primary.id) + (primary.id === 'push' && primary.params && primary.params.ahead ? ' (' + primary.params.ahead + ')' : '') + (primary.id === 'pull' && primary.params && primary.params.behind ? ' (' + primary.params.behind + ')' : ''))
      : null,
    rest.length > 0
      ? h(Popover, {
        align: 'right',
        trigger: ({ toggle, open }) => h('button', { type: 'button', className: 'dsh-bw-btn', onClick: toggle, 'aria-expanded': open }, t('actions.more'), ' ▾'),
        children: (close) => h(MenuList, {
          items: rest.map((entry) => ({
            id: entry.id,
            label: t('actions.' + entry.id),
            disabled: Boolean(entry.disabled) || Boolean(running),
            reason: entry.reasonKey ? t(entry.reasonKey, entry.params || {}) : running ? t('actions.disabled.agentRunning') : null,
            hint: entry.warn ? '!' : null,
          })),
          onSelect: (id) => { close(); onMenuAction(id); },
        }),
      })
      : null);

  const commitKnown = snapshotMutationKnown(snapshot);
  const commitRow = mode === 'uncommitted' && snapshot && commitKnown && snapshot.dirty
    ? h('div', { className: 'dsh-bw-commitrow' },
      h('input', {
        type: 'text', className: 'dsh-bw-commit-input', value: commitMsg, placeholder: t('diff.commitPlaceholder'), 'aria-label': t('diff.commitPlaceholder'),
        onChange: (e) => setCommitMsg(e.target.value),
        onKeyDown: (e) => {
          if (e.key === 'Enter' && commitMsg.trim() && !running) {
            runAction('commit', { message: commitMsg.trim(), addAll: true });
          }
        },
        disabled: Boolean(running),
      }),
      h('button', {
        type: 'button', className: 'dsh-bw-btn dsh-bw-btn-primary', disabled: Boolean(running) || !commitMsg.trim(),
        onClick: () => runAction('commit', { message: commitMsg.trim(), addAll: true }),
      }, t('diff.commitAll')))
    : null;

  const bannerEl = banner
    ? h('div', { className: cx('dsh-bw-banner', banner.kind === 'ok' ? 'dsh-bw-banner-ok' : 'dsh-bw-banner-err'), role: banner.kind === 'ok' ? 'status' : 'alert' }, banner.text)
    : null;
  const taskBanner = taskMissing
    ? h('div', { className: 'dsh-bw-banner dsh-bw-banner-err', role: 'alert' }, t('diff.taskUnavailable'))
    : null;

  const allFiles = (diff && diff.files) || [];
  const files = mode === 'session' && touched ? allFiles.filter((f) => touched.has(f.path)) : allFiles;
  const showCommitToggle = mode === 'base' || mode === 'task';
  const fileList = h('div', { className: 'dsh-bw-filelist' },
    showCommitToggle
      ? h('div', { className: 'dsh-bw-seg', style: { margin: '8px 10px' } },
        h('button', { type: 'button', 'aria-pressed': pane === 'files', onClick: () => { setPane('files'); setSelectedCommit(null); } }, t('diff.paneFiles')),
        h('button', { type: 'button', 'aria-pressed': pane === 'commits', onClick: () => setPane('commits') }, t('diff.paneCommits')))
      : null,
    pane === 'files' || selectedCommit
      ? files.length === 0
        ? h('div', { className: 'dsh-bw-empty', role: diff ? undefined : 'status', 'aria-live': diff ? undefined : 'polite' }, mode === 'session' && touched && touched.size === 0 ? t('diff.sessionEmpty') : diff ? t('diff.empty') : t('diff.loading'))
        : files.map((file, index) =>
          h('button', {
            key: file.path, type: 'button', 'aria-current': selectedFile === file.path ? 'true' : undefined,
            className: cx('dsh-bw-fileitem', selectedFile === file.path && 'dsh-bw-fileitem-active'),
            onClick: () => {
              setSelectedFile(file.path);
              const anchor = document.getElementById('dsh-bw-f-' + index);
              if (anchor) anchor.scrollIntoView({ block: 'start' });
            },
          },
          h(StatusLetter, { status: file.status }),
          h('span', { className: 'dsh-bw-fileitem-path', title: file.path }, file.path),
          h('span', { className: 'dsh-bw-fileitem-stat' },
            file.status === 'binary' || file.status === 'too_large'
              ? ''
              : h(react.Fragment, null,
                h('span', { className: 'dsh-bw-green' }, '+' + fmtNum(file.additions || 0)), ' ',
                h('span', { className: 'dsh-bw-red' }, '−' + fmtNum(file.deletions || 0))))))
      : h('div', { className: 'dsh-bw-commits', style: { maxHeight: 'none', flex: 1 } },
        !commits
          ? h('div', { className: 'dsh-bw-empty', role: 'status', 'aria-live': 'polite' }, t('diff.loading'))
          : commits.commits.length === 0
            ? h('div', { className: 'dsh-bw-empty' }, t('diff.commitListEmpty'))
            : commits.commits.map((commit) =>
              h('button', {
                key: commit.sha, type: 'button', 'aria-pressed': Boolean(selectedCommit && selectedCommit.sha === commit.sha),
                ref: (node) => { if (node) commitButtonRefs.current.set(commit.sha, node); else commitButtonRefs.current.delete(commit.sha); },
                className: cx('dsh-bw-commit', selectedCommit && selectedCommit.sha === commit.sha && 'dsh-bw-commit-active'),
                onClick: () => setSelectedCommit(commit),
              },
              h('span', { className: 'dsh-bw-sha' }, commit.short),
              h('span', { className: 'dsh-bw-commit-subject', title: commit.subject }, commit.subject),
              commit.unpushed ? h('span', { className: 'dsh-bw-unpushed-dot', title: t('diff.unpushed') }, '↑') : null,
              h('span', { className: 'dsh-bw-commit-meta' }, fmtRelTime(commit.at, lang()))))));

  const diffPane = h('div', { className: 'dsh-bw-diffpane' },
    selectedCommit
      ? h('div', { className: 'dsh-bw-toolbar' },
        h('button', {
          ref: commitBackRef, type: 'button', className: 'dsh-bw-btn',
          onClick: () => { returnCommitFocus.current = selectedCommit.sha; setSelectedCommit(null); },
        }, t('diff.backToBranch')),
        h('span', { className: 'dsh-bw-sha' }, selectedCommit.short),
        h('span', { className: 'dsh-bw-commit-subject' }, selectedCommit.subject))
      : null,
    diff && diff.tooLarge ? h('div', { className: 'dsh-bw-banner dsh-bw-banner-err' }, t('diff.truncated')) : null,
    files.length === 0
      ? h('div', { className: 'dsh-bw-empty' }, diff ? t('diff.empty') : t('diff.loading'))
      : files.map((file, index) => h(FileDiff, {
        key: (selectedCommit ? selectedCommit.sha : mode) + ':' + file.path,
        file, wrap, anchorId: 'dsh-bw-f-' + index,
        onEdit: (path) => setEditingFile(path),
      })));

  return h('div', { className: 'dsh-bw-view' },
    toolbar,
    bannerEl,
    taskBanner,
    commitRow,
    h('div', { className: 'dsh-bw-body' }, fileList,
      editingFile
        ? h(FileEditor, {
          key: cwd + '\u0000' + editingFile,
          cwd,
          path: editingFile,
          onSaved: () => { load(); },
          onClose: () => { setEditingFile(null); load(); },
        })
        : diffPane));
}
