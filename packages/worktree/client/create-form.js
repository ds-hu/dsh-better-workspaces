/**
 * The worktree creation form (`bw-worktree`).
 *
 * One component serves both seats: the hero control's staging row (`variant
 * 'hero'`, rendered inline in the conversation hero) and the sidebar page
 * (`variant 'page'`, rendered by the 新建 worktree page). It owns the branch /
 * PR base list, the name field, the dice, and the whole creation transaction:
 * worktree → Workspace → target Session → draft handoff.
 *
 * The creation is DURABLE from the moment the worktree + Workspace + target
 * Session exist; the draft migration is a convenience on top of it. A migration
 * that cannot be committed therefore keeps the record (so the next Create
 * replays this txId and retries only the handoff), leaves the source Session
 * unarchived on screen, and reports the reason instead of claiming the creation
 * failed.
 */
import {
  h, react, useState, useRef, useEffect, useCallback,
} from '@ds-hu/dsh-bw-core/client/react.js';
import { apiGet, apiPost, qs, createRequestOwner, requireOwnership, ownershipError } from '@ds-hu/dsh-bw-core/client/api.js';
import { effectiveSessionCwd, currentSessionId, normalizeSessionId, sessionIsCatalogued } from '@ds-hu/dsh-bw-core/client/session.js';
import {
  readSessionDraft, inputTier, getLastDraftTransferReason, setLastDraftTransferReason, transferSessionDraft,
} from '@ds-hu/dsh-bw-core/client/draft.js';
import {
  workspaceItems, acquireWorkspaceMutation, queueWorkspaceRename,
} from '@ds-hu/dsh-bw-core/client/workspace.js';
import { getAppCtx } from '@ds-hu/dsh-bw-core/client/runtime.js';
import { failureMessage, basenameOf, mnemonicSlug, cx } from '@ds-hu/dsh-bw-core/client/util.js';
import { Popover, MenuList } from '@ds-hu/dsh-bw-core/client/ui.js';
import { BranchIcon } from '@ds-hu/dsh-bw-core/client/icons.js';
import { t } from '@ds-hu/dsh-bw-core/client/i18n.js';
import {
  heroCreateBlocks, HERO_TX_PREFIX,
  heroCreationRequest, settleHeroCreationTx, clearHeroCreationTx,
  releaseCreationTxOnFailure, stagedCreateRequest,
  branchNameProblem, heroNameProblem, draftReasonLabel, draftHandoffNoticeKey,
  createFailureText, DRAFT_UNTRANSFERABLE,
} from './creation.js';

/* ------------------------------------------------------------------ */
/* cwd resolution                                                      */
/* ------------------------------------------------------------------ */

/**
 * Resolve the directory the form creates a worktree in.
 *
 * The official hero resolves a Session's directory through its workingDirectory
 * projection, and before the first message through the Workspace that owns the
 * Session. The sidebar page must work in exactly the same states, so it reads
 * the same two sources, and only then the Session header fallback.
 * @returns the directory, or null while nothing resolves.
 */
export function resolveWorktreeFormCwd(sessions, workspaces, sessionId) {
  let summary = null;
  try {
    const snapshot = sessions.list.getSnapshot();
    summary = sessionId ? snapshot.byId[sessionId] : undefined;
  } catch { /* no store */ }
  const projected = summary ? effectiveSessionCwd(summary) : null;
  if (projected) return projected;
  let items = workspaces && Array.isArray(workspaces.items) ? workspaces.items : null;
  if (!items) {
    try { items = workspaceItems(); } catch { items = []; }
  }
  const owner = items.find((workspace) => workspace && Array.isArray(workspace.sessionIds)
    && workspace.sessionIds.some((id) => String(id) === String(sessionId)));
  if (owner && typeof owner.path === 'string' && owner.path !== '') return owner.path;
  return null;
}

/* ------------------------------------------------------------------ */
/* component                                                           */
/* ------------------------------------------------------------------ */

/**
 * `WorktreeCreateForm`
 * @param props.sessionId - launcher Session.
 * @param props.cwd - the repository checkout (hero passes the resolved cwd; the
 *   page lets the form resolve it).
 * @param props.variant - `'hero'` (inline row items) | `'page'` (boxed panel).
 * @param props.visible - whether the tab holding the page variant is showing.
 * @param props.onCreated - called once a creation committed.
 * @param props.onClose - dismiss request (page variant).
 */
export function WorktreeCreateForm(props) {
  const variant = props.variant === 'page' ? 'page' : 'hero';
  const visible = props.visible !== false;
  const appCtx = getAppCtx();
  const [resolvedCwd, setResolvedCwd] = useState(null);
  const cwd = props.cwd || resolvedCwd;
  const sessionId = props.sessionId;

  const [detect, setDetect] = useState(null);
  const [branchPick, setBranchPick] = useState(null); // null → default
  const [pullPick, setPullPick] = useState(null); // PR-checkout row
  const [branchName, setBranchName] = useState('');
  const [branches, setBranches] = useState(null);
  const [pulls, setPulls] = useState(null);
  const [pullsError, setPullsError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const requestOwner = useRef(null);
  if (!requestOwner.current) requestOwner.current = createRequestOwner();
  const operation = useRef(null);

  // resolve cwd for the page (the hero passes it)
  const resolveCwd = useCallback(() => {
    if (props.cwd) return;
    setResolvedCwd(resolveWorktreeFormCwd(appCtx.sessions, appCtx.workspaces, sessionId));
  }, [props.cwd, sessionId]);
  useEffect(() => {
    resolveCwd();
    let unsubscribe = () => {};
    try {
      if (appCtx.sessions && appCtx.sessions.list && typeof appCtx.sessions.list.subscribe === 'function') {
        unsubscribe = appCtx.sessions.list.subscribe(resolveCwd) || unsubscribe;
      }
    } catch { /* no store */ }
    return () => { try { unsubscribe(); } catch { /* ignore */ } };
  }, [resolveCwd]);

  // reset staging when the target moves
  useEffect(() => {
    requestOwner.current.reset();
    operation.current = null;
    setBusy(null);
    setBranchPick(null);
    setPullPick(null);
    setBranchName('');
    setError(null);
    setPullsError(null);
    setBranches(null);
    setPulls(null);
    setDetect(null);
    const ownedSessionId = sessionId;
    return () => {
      requestOwner.current.reset();
      const blockedToken = heroCreateBlocks.get(ownedSessionId);
      if (!blockedToken) return;
      heroCreateBlocks.delete(ownedSessionId);
      try {
        const conversation = appCtx.get('conversation');
        if (conversation && conversation.blocks) conversation.blocks.set(ownedSessionId, undefined);
      } catch { /* component teardown must not retain a block */ }
    };
  }, [sessionId, cwd]);

  // detect the directory (source title + forge join), only while shown
  useEffect(() => {
    if (!cwd || !visible) return undefined;
    const token = requestOwner.current.begin('detect');
    setDetect(null);
    apiGet('/detect' + qs({ path: cwd }), token.controller.signal)
      .then((value) => { if (requestOwner.current.owns(token)) setDetect({ cwd, sessionId, value }); })
      .catch(() => {})
      .finally(() => requestOwner.current.end(token));
    return () => requestOwner.current.abort(token);
  }, [cwd, sessionId, visible]);
  const det = detect && detect.cwd === cwd
    && (detect.sessionId === undefined || detect.sessionId === sessionId) ? detect.value : null;

  // arm the form with a usable name the first time it is shown
  useEffect(() => {
    if (!visible) return;
    setBranchName((current) => (branchNameProblem(current) === null ? current : mnemonicSlug()));
  }, [visible, cwd, sessionId]);

  const liveBranches = branches && branches.cwd === cwd ? branches.value : null;
  const livePulls = pulls && pulls.cwd === cwd ? pulls.value : null;

  const openLists = useCallback(async () => {
    if (!cwd) return;
    const token = requestOwner.current.begin('hero-list');
    setError(null);
    setPullsError(null);
    try {
      const jobs = [];
      if (!liveBranches) {
        jobs.push(apiGet('/branches' + qs({ cwd }), token.controller.signal).then((result) => {
          requireOwnership(requestOwner.current, token);
          if (result.ok) setBranches({ cwd, value: result });
          else setError(t('hero.failed', { message: result.error || '?' }));
        }));
      }
      /* A forge failure never masks the branch list. */
      if (!livePulls) {
        jobs.push(apiGet('/pulls' + qs({ cwd }), token.controller.signal).then((result) => {
          requireOwnership(requestOwner.current, token);
          if (result.ok) {
            setPulls({ cwd, value: result.items || [] });
            if (result.authState === 'partial') {
              const message = result.error || t('forge.loadFailed');
              setPullsError(t(result.partialSide === 'issues' ? 'forge.issuesFailed' : 'forge.pullsFailed', { message }));
            }
          } else {
            setPulls({ cwd, value: [] });
            setPullsError(failureMessage(result) || t('forge.loadFailed'));
          }
        }));
      }
      await Promise.all(jobs);
    } catch (e) {
      if (requestOwner.current.owns(token)) setError(t('hero.failed', { message: String((e && e.message) || e) }));
    } finally {
      requestOwner.current.end(token);
    }
  }, [cwd, liveBranches, livePulls]);

  useEffect(() => {
    if (!visible || !cwd) return undefined;
    openLists();
    return undefined;
  }, [visible, cwd, openLists]);

  /* Capture the source draft for one staged create, waiting — bounded — for a
   * composer that is mid-command to settle. The wait happens BEFORE the request
   * and the result is re-read after it, so the payload is the newest draft. */
  async function captureWritableSourceDraft(sourceId, token) {
    const deadline = Date.now() + 1500;
    let captured = readSessionDraft(appCtx.sessions, sourceId);
    while (captured && inputTier(captured) === 'frozen' && Date.now() < deadline
      && requestOwner.current.owns(token) && currentSessionId() === sourceId) {
      await new Promise((resolve) => { setTimeout(resolve, 50); });
      captured = readSessionDraft(appCtx.sessions, sourceId);
    }
    if (!captured) {
      setLastDraftTransferReason('source-composer-unavailable');
      return null;
    }
    if (inputTier(captured) === 'frozen') {
      setLastDraftTransferReason('source-not-plain');
      return null;
    }
    return captured;
  }

  async function prepareStagedWorktree(baseBranch, explicit, pull) {
    if (operation.current || !cwd) return;
    const named = String(explicit || branchName || '').trim();
    // Reachable through Enter in the name input, so this guard must say why it
    // refused: a silent return was a place the staged create vanished without a
    // trace.
    const guardProblem = pull ? null : branchNameProblem(named);
    if (guardProblem !== null) {
      setError(t(guardProblem === 'empty' ? 'hero.nameRequired' : 'hero.nameInvalid'));
      return;
    }
    const sourceId = sessionId;
    // Silent by design: the session moved on, which is navigation, not a
    // failure the user needs told about.
    if (!sourceId || currentSessionId() !== sourceId) return;
    const token = requestOwner.current.begin('hero-create');
    operation.current = token;
    const conversation = appCtx.get('conversation');
    setBusy(t(pull ? 'hero.checkingOut' : 'hero.creating'));
    setError(null);
    /* Refuse BEFORE the request, not after it. A composer that cannot be read,
     * or that never leaves a command submission, used to be discovered only
     * once the worktree, Workspace and Session already existed. */
    const abandonPreflight = (message) => {
      if (message && requestOwner.current.owns(token) && currentSessionId() === sourceId) {
        setError(message);
        setBusy(null);
      }
      requestOwner.current.end(token);
      if (operation.current === token) operation.current = null;
    };
    const capturedDraft = await captureWritableSourceDraft(sourceId, token).catch(() => null);
    if (!capturedDraft) {
      abandonPreflight(t(getLastDraftTransferReason() === 'source-composer-unavailable'
        ? 'hero.composerUnavailable' : 'hero.sourceBusy'));
      return;
    }
    if (!requestOwner.current.owns(token) || currentSessionId() !== sourceId) {
      abandonPreflight(null);
      return;
    }
    const releaseMutation = acquireWorkspaceMutation(cwd);
    if (!releaseMutation) {
      // Another worktree mutation holds this repo. Actionable, so say it.
      abandonPreflight(t('hero.busyRepo'));
      return;
    }
    let targetId;
    if (conversation && conversation.blocks) {
      heroCreateBlocks.set(sourceId, token);
      try { conversation.blocks.set(sourceId, { reason: t('hero.blockReason') }); } catch { /* cosmetic */ }
    }
    const items0 = workspaceItems();
    const srcWs =
      items0.find((w) => Array.isArray(w.sessionIds) && w.sessionIds.indexOf(sourceId) !== -1) ||
      items0.find((w) => w.path === cwd) || null;
    const sourceTitle =
      (srcWs && typeof srcWs.title === 'string' && srcWs.title.trim()) ||
      basenameOf((det && (det.mainRepoRoot || det.repoRoot)) || cwd) || '';
    const { selection, body } = stagedCreateRequest({
      cwd, sourceId, sourceTitle, pull, name: named,
      baseRef: baseBranch || branchPick || defaultBaseRef() || null,
    });
    /* Minted LAST: a transaction may only be recorded once the request it
     * describes is certain to be sent. */
    const pending = heroCreationRequest(sourceId, selection, () => body);
    try {
      const requestBody = { ...pending.body, txId: pending.txId };
      // Creation is idempotent by txId. Do not abort the mutation after it was
      // sent: a lost response must remain forward-retryable.
      const result = await apiPost('/worktrees', requestBody);
      requireOwnership(requestOwner.current, token);
      if (currentSessionId() !== sourceId) throw ownershipError();
      if (!result.ok) {
        releaseCreationTxOnFailure(sourceId, pending.txId, result);
        const failure = new Error(createFailureText(result, t));
        /* Already translated: the catch below must not wrap a typed Host
         * refusal in a second "失败:" prefix. */
        failure.translated = true;
        throw failure;
      }
      setBusy(t('hero.switching'));
      if (typeof result.workspaceId !== 'string' || result.workspaceId === '') throw new Error('workspace receipt unavailable');
      let workspace = workspaceItems().find((item) => item.workspaceId === result.workspaceId) || null;
      if (!workspace) workspace = await appCtx.workspaces.create({ path: result.path });
      requireOwnership(requestOwner.current, token);
      if (currentSessionId() !== sourceId) throw ownershipError();
      if (!workspace || workspace.path !== result.path || workspace.workspaceId !== result.workspaceId) {
        throw new Error('workspace receipt no longer owns the created path');
      }
      const workspaceId = result.workspaceId;
      await queueWorkspaceRename(workspaceId, (sourceTitle ? sourceTitle + ' · ' : '') + (result.branch || ''));
      requireOwnership(requestOwner.current, token);
      if (currentSessionId() !== sourceId) throw ownershipError();
      try {
        targetId = normalizeSessionId(await appCtx.sessions.create({
          workspaceId,
          sessionId: pending.targetSessionId,
        }));
      } catch (createError) {
        const converged = workspaceItems().find((item) => item.workspaceId === workspaceId
          && item.path === result.path && Array.isArray(item.sessionIds)
          && item.sessionIds.map(String).includes(pending.targetSessionId));
        if (!converged && !sessionIsCatalogued(appCtx.sessions, pending.targetSessionId)) throw createError;
        targetId = pending.targetSessionId;
      }
      requireOwnership(requestOwner.current, token);
      if (currentSessionId() !== sourceId) throw ownershipError();
      if (typeof targetId !== 'string' || targetId === '') throw new Error('session create failed');
      /* A handoff needs the target's conversation scope, and that scope only
       * exists for a RETAINED Session. sessions.create is optimistic, so the
       * target must be retained before the transfer — opening it IS the
       * intended end state, so retain first, transfer, and release the
       * reservation if anything goes wrong. */
      let reserved = null;
      try {
        const sessionsService = appCtx.sessions;
        if (typeof sessionsService.retain === 'function') {
          reserved = sessionsService.retain(targetId, { source: 'workspaceOperation' });
          if (reserved && typeof reserved.ready?.then === 'function') await reserved.ready;
        }
      } catch { reserved = null; }
      let handed = false;
      try {
        const handoffDeadline = Date.now() + 2000;
        handed = transferSessionDraft(appCtx.sessions, sourceId, targetId, capturedDraft, conversation);
        /* A reason no retry can fix ends the window immediately. */
        while (!handed && Date.now() < handoffDeadline
          && !DRAFT_UNTRANSFERABLE.has(getLastDraftTransferReason())
          && requestOwner.current.owns(token) && currentSessionId() === sourceId) {
          await new Promise((resolve) => { setTimeout(resolve, 50); });
          handed = transferSessionDraft(appCtx.sessions, sourceId, targetId, capturedDraft, conversation);
        }
      } finally {
        try { reserved?.release?.(); } catch { /* retention is best-effort */ }
      }
      if (handed) {
        clearHeroCreationTx(sourceId, pending.txId);
        try { await appCtx.workspaces.archiveSession(sourceId); } catch { /* target already owns the draft */ }
      } else {
        /* Committed creation, stranded draft. Keep the source Session on
         * screen, keep the txId so the next Create replays this receipt and
         * retries only the handoff, and name the reason. */
        const reason = getLastDraftTransferReason() || 'unknown';
        settleHeroCreationTx(sourceId, pending.txId, result);
        if (requestOwner.current.owns(token) && currentSessionId() === sourceId) {
          setError(t(draftHandoffNoticeKey(reason), { reason: draftReasonLabel(reason, t) }));
        }
      }
      if (typeof props.onCreated === 'function') props.onCreated(result);
    } catch (e) {
      if (requestOwner.current.owns(token) && currentSessionId() === sourceId) {
        setError(e && e.translated
          ? String((e && e.message) || e)
          : t('hero.failed', { message: String((e && e.message) || e) }));
      }
    } finally {
      if (conversation && conversation.blocks && heroCreateBlocks.get(sourceId) === token) {
        heroCreateBlocks.delete(sourceId);
        try { conversation.blocks.set(sourceId, undefined); } catch { /* cosmetic */ }
      }
      if (requestOwner.current.owns(token) && currentSessionId() === sourceId) setBusy(null);
      requestOwner.current.end(token);
      if (operation.current === token) operation.current = null;
      releaseMutation();
    }
  }

  function refDisplay(ref) {
    if (typeof ref !== 'string') return '';
    if (ref.indexOf('refs/heads/') === 0) return ref.slice('refs/heads/'.length);
    if (ref.indexOf('refs/remotes/origin/') === 0) return ref.slice('refs/remotes/origin/'.length);
    return ref;
  }

  function defaultBaseRef() {
    if (!liveBranches || !liveBranches.defaultBranch) return null;
    const entry = (liveBranches.branches || []).find((b) => b.name === liveBranches.defaultBranch);
    if (entry && entry.hasRemote) return 'refs/remotes/origin/' + entry.name;
    if (entry && entry.hasLocal) return 'refs/heads/' + entry.name;
    return liveBranches.defaultBranch;
  }

  /* staging form actions: the name is required, and the explicit Create click
   * is the only creation trigger — picking a base branch or a PR row stays
   * side-effect free (ADR 0014) */
  function createStaged() {
    if (busy) return;
    if (pullPick) { prepareStagedWorktree(null, null, pullPick); return; }
    prepareStagedWorktree(branchPick || null, branchName);
  }

  function createDisabled() {
    if (busy) return true;
    if (pullPick) return false;
    return branchNameProblem(branchName) !== null;
  }
  // Same judge as the disable above gives the reason, so the button can never
  // be disabled with nothing on screen explaining it.
  const nameProblem = heroNameProblem(false, pullPick, branchName);

  /* paseo picker parity: the origin row comes first because it IS the default
   * base; the local row shows as "<name>（本地）" with +N −M divergence when
   * both sides exist. */
  const defRef = defaultBaseRef();
  const picked = branchPick || defRef;
  const branchItems = [];
  if (liveBranches) {
    for (const branch of (liveBranches.branches || []).slice(0, 200)) {
      if (branch.hasRemote) {
        const ref = 'refs/remotes/origin/' + branch.name;
        branchItems.push({
          id: ref,
          kind: 'branch',
          label: branch.name,
          hint: ref === defRef ? t('hero.default') : null,
          active: picked === ref,
        });
      }
      if (branch.hasLocal) {
        const ref = 'refs/heads/' + branch.name;
        const parts = [];
        if (branch.localAhead > 0) parts.push('+' + branch.localAhead);
        if (branch.localBehind > 0) parts.push('\u2212' + branch.localBehind);
        branchItems.push({
          id: ref,
          kind: 'branch',
          label: branch.hasRemote ? branch.name + t('hero.localSuffix') : branch.name,
          hint: branch.current ? t('hero.current') : parts.length ? parts.join(' ') : null,
          active: picked === ref,
        });
      }
    }
  }

  /* Open pull requests join the base list: one page, newest first, labelled
   * `#N title` with a head → base hint so a PR row cannot read as a branch.
   * Picking one checks the PR's HEAD out — it is not a base to cut from. */
  const prItems = (livePulls || [])
    .filter((item) => item.kind === 'change_request' && item.headRefName)
    .map((item) => ({
      id: 'pr:' + item.number,
      kind: 'change_request',
      label: (item.fork ? t('forge.fork') + ' ' : '') + '#' + item.number + ' ' + (item.title || ''),
      hint: '→ ' + (item.baseRefName || '?'),
      item,
    }));
  const baseItems = prItems.length > 0
    ? branchItems.concat([{ id: '__forge_sep__', separator: true }], prItems)
    : branchItems;

  const effectiveBranch = refDisplay(picked) || '…';

  const items = [
    h(Popover, {
      key: 'base',
      align: 'left',
      trigger: ({ open, toggle }) =>
        h('button', {
          type: 'button', className: 'dsh-bw-hero-btn', onClick: toggle, disabled: Boolean(busy),
          'aria-expanded': open,
        },
        h(BranchIcon),
        h('span', { className: 'dsh-bw-hero-label' },
          pullPick
            ? '#' + pullPick.number + ' ' + (pullPick.title || '')
            : t('hero.pickBase', { branch: effectiveBranch })),
        h('span', { className: 'dsh-bw-hero-chevron' }, '▾')),
      children: (close) =>
        liveBranches === null
          ? h('div', { className: 'dsh-bw-hero-panel-row' }, t('diff.loading'))
          : h(MenuList, {
            items: baseItems,
            onSelect: (id) => {
              if (id === '__sep__' || id === '__forge_sep__') return;
              close();
              // selection is side-effect free: only the Create button creates
              const pr = prItems.find((entry) => entry.id === id);
              if (pr) { setPullPick(pr.item); setBranchPick(null); return; }
              setPullPick(null);
              setBranchPick(id);
            },
          }),
    }),
    h('input', {
      key: 'name',
      className: 'dsh-bw-hero-input', value: branchName, 'aria-label': t('hero.name'),
      placeholder: t('hero.namePlaceholder'),
      disabled: Boolean(busy) || Boolean(pullPick),
      title: pullPick ? t('hero.prNameLocked') : t('hero.name'),
      onChange: (e) => setBranchName(e.target.value),
      onKeyDown: (e) => {
        if (e.key === 'Enter') { e.preventDefault(); createStaged(); }
        else if (e.key === 'Escape') { e.preventDefault(); props.onClose?.(); }
      },
    }),
    h('button', {
      key: 'dice',
      type: 'button', className: 'dsh-bw-hero-btn', 'aria-label': t('hero.diceName'), title: t('hero.diceName'),
      disabled: Boolean(busy) || Boolean(pullPick),
      onClick: () => setBranchName(mnemonicSlug()),
    }, '\u2684'),
    h('button', {
      key: 'create',
      type: 'button', className: 'dsh-bw-btn dsh-bw-btn-primary', disabled: createDisabled(),
      onClick: () => createStaged(),
    }, busy || (pullPick ? t('hero.checkoutPr') : t('hero.create'))),
  ];
  const messages = [];
  if (nameProblem) messages.push(h('span', { key: 'nm', className: 'dsh-bw-hero-error', role: 'alert' }, t(nameProblem)));
  if (pullsError) messages.push(h('span', { key: 'pe', className: 'dsh-bw-hero-error', role: 'alert' }, t('forge.pullsFailed', { message: pullsError })));
  if (error) messages.push(h('span', { key: 'err', className: 'dsh-bw-hero-error', role: 'alert' }, error));

  if (variant === 'hero') {
    return h(react.Fragment, null, ...items, ...messages);
  }
  return h('div', { className: cx('dsh-bw-form', 'dsh-bw-form-page') },
    h('div', { className: 'dsh-bw-form-head' },
      h('span', { className: 'dsh-bw-form-title' }, t('hero.modeWorktree')),
      props.onClose
        ? h('button', { type: 'button', className: 'dsh-bw-btn', onClick: () => props.onClose() }, t('files.cancelEdit'))
        : null),
    h('div', { className: 'dsh-bw-form-row' }, ...items),
    ...messages,
    cwd ? null : h('div', { className: 'dsh-bw-empty' }, t('diff.loading')));
}

export { HERO_TX_PREFIX };
