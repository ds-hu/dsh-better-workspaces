/**
 * Shared UI primitives: the checks ring, the PR number badge, the popover/menu
 * pair and the diff status letter.
 *
 * All of them are used by at least two rows (status badges + diff toolbar, the
 * worktree staging popover + diff action menu), so they live in `core`.
 */
import { h, useState, useRef, useEffect } from './react.js';
import { cx } from './util.js';
import { t } from './i18n.js';

/** The checks ring: completed/total arc coloured by state. */
export function ChecksRing({ checks }) {
  const radius = 5;
  const circ = 2 * Math.PI * radius;
  const total = Math.max(checks.total || 0, 1);
  const frac = Math.min((checks.completed || 0) / total, 1);
  const color =
    checks.status === 'failure' ? 'var(--dsh-bw-red)' :
    checks.status === 'pending' ? 'var(--dsh-bw-yellow)' : 'var(--dsh-bw-green)';
  return h('svg', {
    width: 12, height: 12, viewBox: '0 0 12 12', className: 'dsh-bw-ring',
    'aria-label': t('diff.checks', { status: t('checks.' + (checks.status || 'none')), completed: checks.completed || 0, total: checks.total || 0 }),
  },
  h('circle', { cx: 6, cy: 6, r: radius, fill: 'none', stroke: 'currentColor', opacity: 0.22, strokeWidth: 2 }),
  frac > 0 && h('circle', {
    cx: 6, cy: 6, r: radius, fill: 'none', stroke: color, strokeWidth: 2,
    strokeDasharray: (frac * circ).toFixed(2) + ' ' + circ.toFixed(2),
    transform: 'rotate(-90 6 6)', strokeLinecap: 'round',
  }));
}

/** `#123` coloured by PR state. */
export function PrNumBadge({ pr }) {
  const colorClass = pr.state === 'merged' ? 'dsh-bw-purple' : pr.state === 'open' ? 'dsh-bw-green' : 'dsh-bw-red';
  return h('span', { className: cx('dsh-bw-badge dsh-bw-pr-num', colorClass) }, '#' + pr.number);
}

/** A small anchored popover with outside-click and Escape handling. */
export function Popover({ trigger, children, align, panelClass }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const opener = useRef(null);
  const close = (restoreFocus = true) => {
    setOpen(false);
    const target = restoreFocus ? opener.current : null;
    if (target && typeof target.focus === 'function') queueMicrotask(() => { if (target.isConnected) target.focus(); });
  };
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (event) => {
      if (ref.current && !ref.current.contains(event.target)) close(false);
    };
    const onKey = (event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return h('div', { className: 'dsh-bw-pop', ref },
    trigger({ open, toggle: () => {
      if (!open) opener.current = document.activeElement;
      open ? close() : setOpen(true);
    } }),
    open && h('div', { className: cx('dsh-bw-pop-panel', align === 'right' && 'dsh-bw-pop-right', panelClass) }, children(close)));
}

/** One menu column; each item may carry label/hint/reason/active/disabled. */
export function MenuList({ items, onSelect }) {
  return h('div', { className: 'dsh-bw-menu' },
    items.map((item) =>
      item.separator
        ? h('div', { key: item.id, className: 'dsh-bw-menu-sep' })
        : h('button', {
          key: item.id, type: 'button', 'aria-pressed': item.active === undefined ? undefined : Boolean(item.active),
          className: cx('dsh-bw-menu-item', item.active && 'dsh-bw-menu-item-active'),
          disabled: Boolean(item.disabled), title: item.disabled ? item.reason || undefined : item.title || undefined,
          onClick: () => { if (!item.disabled) onSelect(item.id); },
        },
        h('span', { className: 'dsh-bw-menu-label' }, item.label),
        item.hint ? h('span', { className: 'dsh-bw-menu-hint' }, item.hint) : null)));
}

/** The A/D/R/C/M letter a diff file row shows. */
export function StatusLetter({ status }) {
  const letter = status === 'added' ? 'A' : status === 'deleted' ? 'D' : status === 'renamed' ? 'R' : status === 'copied' ? 'C' : status === 'binary' ? 'B' : status === 'too_large' ? 'L' : status === 'type-changed' ? 'T' : 'M';
  const color = status === 'added' ? 'dsh-bw-green' : status === 'deleted' ? 'dsh-bw-red' : status === 'renamed' || status === 'copied' ? 'dsh-bw-yellow' : '';
  return h('span', { className: cx('dsh-bw-statusletter', color) }, letter);
}
