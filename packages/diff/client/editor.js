/**
 * The CAS-protected file editor: reads through `GET /file`, writes through
 * `POST /file` with `baseSha1`, and reports a stale base as a conflict the user
 * must reload from (never a silent last-writer-wins).
 */
import {
  h, useState, useRef, useCallback, useEffect,
} from '@ds-hu/dsh-bw-core/client/react.js';
import { apiGet, apiPost, qs, createRequestOwner, requireOwnership } from '@ds-hu/dsh-bw-core/client/api.js';
import { failureMessage } from '@ds-hu/dsh-bw-core/client/util.js';
import { acquireWorkspaceMutation } from '@ds-hu/dsh-bw-core/client/workspace.js';
import { t } from '@ds-hu/dsh-bw-core/client/i18n.js';

export function FileEditor(props) {
  const [text, setText] = useState(props.initialContent != null ? props.initialContent : null);
  const [base, setBase] = useState(props.initialContent != null ? props.initialContent : null);
  const [sha1, setSha1] = useState(props.initialSha1 || null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [conflict, setConflict] = useState(false);
  const requestOwner = useRef(null);
  if (!requestOwner.current) requestOwner.current = createRequestOwner();
  const saveLock = useRef(false);

  const load = useCallback(async () => {
    const token = requestOwner.current.begin('file-load');
    try {
      const r = await apiGet('/file' + qs({ cwd: props.cwd, path: props.path }), token.controller.signal);
      requireOwnership(requestOwner.current, token);
      if (r && r.ok && r.kind === 'text') {
        setText(r.content);
        setBase(r.content);
        setSha1(r.sha1 || null);
        setError(null);
        setConflict(false);
      } else setError(t('files.editUnavailable'));
    } catch {
      if (requestOwner.current.owns(token)) setError(t('files.editUnavailable'));
    } finally {
      requestOwner.current.end(token);
    }
  }, [props.cwd, props.path]);

  useEffect(() => {
    if (props.initialContent == null) load();
    return () => requestOwner.current.reset();
  }, [load, props.initialContent]);

  async function save() {
    if (text === null || saveLock.current) return;
    const releaseMutation = acquireWorkspaceMutation(props.cwd);
    if (!releaseMutation) return;
    saveLock.current = true;
    const savedText = text;
    const savedSha1 = sha1;
    const token = requestOwner.current.begin('file-save');
    setSaving(true);
    setError(null);
    try {
      const r = await apiPost('/file', {
        cwd: props.cwd, path: props.path, content: savedText, baseSha1: savedSha1 || undefined,
      }, token.controller.signal);
      requireOwnership(requestOwner.current, token);
      if (r && r.ok) {
        setBase(savedText);
        if (r.sha1) setSha1(r.sha1);
        setConflict(false);
        if (props.onSaved) props.onSaved();
      } else if (r && r.error === 'conflict') {
        setConflict(true);
        setError(t('files.conflict'));
      } else setError(failureMessage(r) || t('files.saveFailed'));
    } catch (e) {
      if (requestOwner.current.owns(token)) setError(String((e && e.message) || e));
    } finally {
      if (requestOwner.current.owns(token)) setSaving(false);
      requestOwner.current.end(token);
      saveLock.current = false;
      releaseMutation();
    }
  }

  if (text === null) return h('div', { className: 'dsh-bw-empty', role: error ? 'alert' : 'status', 'aria-live': error ? undefined : 'polite' }, error || t('diff.loading'));
  const dirty = text !== base;
  return h('div', { className: 'dsh-bw-editor' },
    h('div', { className: 'dsh-bw-editor-bar' },
      h('span', { className: 'dsh-bw-editor-path', title: props.path }, props.path),
      dirty ? h('span', { className: 'dsh-bw-editor-dirty' }, '\u25cf') : null,
      h('span', { style: { flex: 1 } }),
      error ? h('span', { className: 'dsh-bw-hero-error', role: 'alert' }, error) : null,
      conflict ? h('button', { type: 'button', className: 'dsh-bw-btn', onClick: load }, t('files.reload')) : null,
      h('button', {
        type: 'button', className: 'dsh-bw-btn dsh-bw-btn-primary',
        disabled: !dirty || saving, onClick: save,
      }, saving ? t('files.saving') : t('files.save')),
      h('button', { type: 'button', className: 'dsh-bw-btn', onClick: props.onClose }, t('files.cancelEdit'))),
    h('textarea', {
      className: 'dsh-bw-editor-area', value: text, spellCheck: false, 'aria-label': props.path,
      onChange: (e) => setText(e.target.value),
      onKeyDown: (e) => {
        if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) {
          e.preventDefault();
          save();
        }
      },
    }));
}
