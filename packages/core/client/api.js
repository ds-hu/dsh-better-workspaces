/**
 * The HTTP face of the plugin's data plane.
 *
 * Every bundle talks to the host through these helpers only; the base path is
 * the one route group `@ds-hu/dsh-bw-core` mounts (`/better-workspaces/api`).
 */
import { qs } from './util.js';

export const API_BASE = '/better-workspaces/api';

export { qs };

/** GET a JSON route. */
export async function apiGet(path, signal) {
  const res = await fetch(API_BASE + path, {
    headers: { Accept: 'application/json' },
    ...(signal ? { signal } : {}),
  });
  return await res.json();
}

/** POST a JSON route. */
export async function apiPost(path, body, signal) {
  const res = await fetch(API_BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body ?? {}),
    ...(signal ? { signal } : {}),
  });
  return await res.json();
}

/**
 * Request ownership: one component instance owns its in-flight reads/writes, so
 * a late answer from a previous cwd/session can never overwrite the current one.
 */
export function createRequestOwner() {
  let epoch = 0;
  const active = new Set();
  function abortAll() {
    epoch += 1;
    for (const token of active) token.controller.abort();
    active.clear();
  }
  return {
    begin(channel) {
      if (channel) {
        for (const prior of active) {
          if (prior.channel === channel) {
            prior.controller.abort();
            active.delete(prior);
          }
        }
      }
      const token = { epoch, channel: channel || null, controller: new AbortController() };
      active.add(token);
      return token;
    },
    owns(token) {
      return Boolean(token && token.epoch === epoch && active.has(token) && !token.controller.signal.aborted);
    },
    end(token) { active.delete(token); },
    abort(token) {
      if (!token) return;
      token.controller.abort();
      active.delete(token);
    },
    reset: abortAll,
  };
}

/** The AbortError every superseded request throws. */
export function ownershipError() {
  const error = new Error('request owner changed');
  error.name = 'AbortError';
  error.code = 'ABORT_ERR';
  return error;
}

/** Throw when a request's owner was superseded while it was in flight. */
export function requireOwnership(owner, token) {
  if (!owner.owns(token)) throw ownershipError();
}
