/**
 * lane.js — bounded-concurrency scheduling with a foreground class.
 *
 * One capacity is shared by two FIFO queues. Foreground means "an HTTP request
 * is waiting on this"; background means "nobody is waiting" — a recompute the
 * user did not ask for, or a periodic fetch. Foreground always starts first, so
 * a stale-badge refresh wave can never sit in front of a `/detect`, a `/diff`
 * or a `/actions` call. Background still may use the whole capacity when
 * nothing is queued ahead of it, so it drains at full speed on an idle host.
 *
 * The one way this could starve background work is a host busy enough that a
 * foreground task is always waiting. A background entry therefore carries the
 * time it was queued and is promoted to the front of the foreground queue once
 * it has waited `promoteAfterMs`. Promotion keeps FIFO order among everything
 * promoted in the same tick.
 *
 * This module is deliberately pure: no child processes, no timers, no I/O. The
 * `now` hook exists so a test can prove the promotion boundary without sleeping.
 */

const DEFAULT_PROMOTE_AFTER_MS = 10000;

/**
 * Create one lane.
 * @param {{capacity?: number, promoteAfterMs?: number, now?: () => number}} [options]
 * @returns {{run: (fn: () => any, options?: {background?: boolean}) => Promise<any>, capacity: number, promoteAfterMs: number, stats: () => {active: number, foreground: number, background: number}}}
 */
export function createLane(options = {}) {
  const capacity = options.capacity ?? 8;
  if (!Number.isInteger(capacity) || capacity < 1) throw new TypeError('lane capacity must be a positive integer');
  const promoteAfterMs = options.promoteAfterMs ?? DEFAULT_PROMOTE_AFTER_MS;
  if (!(typeof promoteAfterMs === 'number' && promoteAfterMs >= 0)) throw new TypeError('lane promoteAfterMs must be a non-negative number');
  const now = typeof options.now === 'function' ? options.now : Date.now;

  let active = 0;
  const foreground = [];
  const background = [];

  /** Move every background entry that has waited long enough to the front. */
  const promoteDue = () => {
    if (background.length === 0) return;
    const cutoff = now() - promoteAfterMs;
    const promoted = [];
    while (background.length > 0 && background[0].queuedAt <= cutoff) promoted.push(background.shift());
    if (promoted.length > 0) foreground.unshift(...promoted);
  };

  const start = (entry) => {
    active += 1;
    Promise.resolve()
      .then(entry.fn)
      .then(entry.resolve, entry.reject)
      .finally(() => {
        active -= 1;
        next();
      });
  };

  const next = () => {
    promoteDue();
    const entry = foreground.length > 0 ? foreground.shift() : background.shift();
    if (entry !== undefined) start(entry);
  };

  return {
    capacity,
    promoteAfterMs,
    stats: () => ({ active, foreground: foreground.length, background: background.length }),
    run(fn, runOptions = {}) {
      const isBackground = runOptions.background === true;
      return new Promise((resolve, reject) => {
        const entry = { fn, resolve, reject, queuedAt: now() };
        const immediate = active < capacity
          && (isBackground
            // Background yields to anything already queued, foreground included.
            ? foreground.length === 0 && background.length === 0
            // Foreground only respects its own FIFO: a queued background task
            // must not make a request wait.
            : foreground.length === 0);
        if (immediate) start(entry);
        else (isBackground ? background : foreground).push(entry);
      });
    },
  };
}
