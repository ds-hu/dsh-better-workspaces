/**
 * discovery.js — cached answers to "which repository is this directory in?"
 * (ADR 0013 Amendment 2).
 *
 * `detectRepo` costs three Git spawns (`rev-parse --show-toplevel`,
 * `--git-common-dir`, `--git-dir`), and the read path asks it several times for
 * one directory: once to classify the cwd selector, once inside
 * `validateManagedWorktree`/`validateLinkedWorktree`, and once per registered
 * root when the selector is not itself a root. Measured on Windows a spawn is
 * ~0.8 s, so on a 20-workspace host that repetition alone was hundreds of
 * processes for a single page load.
 *
 * What is cached is only the **strings** Git printed. Identity is never cached:
 * every caller that needs ownership re-`stat`s the cwd, the Git directory and the
 * common directory at its own commit point (ADR 0013), so a replaced path still
 * fails closed. Entries are also keyed by the directory's dev/ino, so a path that
 * now names a *different* directory is a miss rather than a hit.
 *
 * One residual window is documented instead of argued away: a directory deleted
 * and re-created at the same spelling can be handed the same inode (ext4 does
 * this readily), and then the key does not change either — the cache can go on
 * describing a directory that no longer exists, for up to its TTL. That is a
 * stale *read* only: writes re-authorize with `{ fresh: true }` and re-derive the
 * repository-family gate key there, so the mismatch fails closed with 409 rather
 * than writing through the stale answer.
 *
 * Two things deliberately do not use this cache:
 *   - Git **mutations** re-discover from scratch (`{ fresh: true }`), because
 *     their next step takes the repository-family gate and a stale discovery
 *     would hand it a stale key (ADR 0011).
 *   - `validateManagedWorktree`/`validateLinkedWorktree` called on their own
 *     still discover live; the cache only reaches them through the
 *     `detected` option, i.e. from a caller that already has a live-or-cached
 *     answer for that exact directory.
 */

import { isAbsolute } from 'node:path';
import { realpath, stat } from 'node:fs/promises';
import { detectRepo } from './git.js';

const DISCOVERY_TTL_MS = 30000;
const MAX_DISCOVERY_ENTRIES = 1024;

/** canonical path → { dev, ino, at, detected } */
const cache = new Map();
let clock = Date.now;

/** Drop every cached answer. Tests and explicit resets only. */
export function resetDiscoveryCache() {
  cache.clear();
}

/** Replace the clock (tests prove the TTL boundary without sleeping). */
export function setDiscoveryClock(next) {
  clock = typeof next === 'function' ? next : Date.now;
}

export function discoveryCacheSize() {
  return cache.size;
}

/**
 * Canonical directory plus the identity that proves which directory it is.
 * @returns `null` when the path is not an absolute path to a real directory.
 */
export async function canonicalDirectoryWithIdentity(path) {
  if (typeof path !== 'string' || path === '' || !isAbsolute(path)) return null;
  try {
    const canonical = await realpath(path);
    const info = await stat(canonical);
    return info.isDirectory() ? { path: canonical, dev: info.dev, ino: info.ino } : null;
  } catch {
    return null;
  }
}

export async function canonicalDirectory(path) {
  const resolved = await canonicalDirectoryWithIdentity(path);
  return resolved ? resolved.path : null;
}

function remember(canonical, dev, ino, detected) {
  cache.delete(canonical);
  cache.set(canonical, { dev, ino, at: clock(), detected });
  while (cache.size > MAX_DISCOVERY_ENTRIES) cache.delete(cache.keys().next().value);
}

/**
 * `detectRepo` with a 30 s string cache.
 *
 * @param path - absolute directory (a file is resolved to its directory).
 * @param options.fresh - skip both the lookup and the store (mutation paths).
 * @param options.canonical - already-canonicalized path, when the caller has it.
 * @param options.identity - that directory's `{dev, ino}`, when the caller has it.
 */
export async function detectRepoCached(path, options = {}) {
  const { fresh = false } = options;
  let canonical = typeof options.canonical === 'string' ? options.canonical : null;
  let identity = options.identity ?? null;
  if (!canonical || !identity) {
    const resolved = await canonicalDirectoryWithIdentity(path);
    if (!resolved) return { isGit: false };
    canonical = resolved.path;
    identity = { dev: resolved.dev, ino: resolved.ino };
  }
  if (!fresh) {
    const hit = cache.get(canonical);
    // The dev/ino comparison is the whole safety argument: the same spelling
    // with a different directory behind it is a miss, not a hit.
    if (hit && hit.dev === identity.dev && hit.ino === identity.ino && clock() - hit.at < DISCOVERY_TTL_MS) {
      return hit.detected;
    }
  }
  const detected = await detectRepo(canonical);
  if (fresh) cache.delete(canonical);
  else if (detected.isGit) remember(canonical, identity.dev, identity.ino, detected);
  else cache.delete(canonical);
  return detected;
}
