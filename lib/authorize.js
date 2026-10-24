import { isAbsolute, relative, resolve, sep } from 'node:path';
import { lstat, stat } from 'node:fs/promises';
import { canonicalDirectory, canonicalDirectoryWithIdentity, detectRepoCached } from './discovery.js';
import { samePath } from './stable.js';
import { validateLinkedWorktree, validateManagedWorktree } from './worktree.js';

function contains(root, target) {
  const rel = relative(root, target);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/**
 * Authorize cwd selectors against current durable Workspace roots, one
 * plugin-managed worktree, or a linked Git worktree of an exact registered
 * main checkout. The caller-provided cwd selects a target; it never proves
 * ownership by itself.
 *
 * `fresh` skips the discovery cache (ADR 0013 Amendment 1). Every route that
 * mutates passes it: the repository-family gate key is derived from the
 * authorization, so a stale discovery would schedule a write under a key that no
 * longer describes the repository. Read routes use the cache, and the identity
 * facts they rely on (dev/ino of the cwd, Git dir and common dir) are re-`stat`ed
 * here and again at each commit point either way.
 */
export function createWorkspaceAuthorizer({ workspaceRoots } = {}) {
  const rootsProvider = typeof workspaceRoots === 'function' ? workspaceRoots : () => [];

  async function registeredRoots() {
    let values;
    try {
      values = await rootsProvider();
    } catch {
      return [];
    }
    if (!Array.isArray(values)) return [];
    const roots = [];
    for (const value of values) {
      const path = typeof value === 'string' ? value : value?.path;
      if (typeof path !== 'string' || !samePath(resolve(path), path)) continue;
      const canonical = await canonicalDirectory(path);
      // The registry path is the durable anchor. A symlink or a renamed-and-
      // rebound path must not silently retarget that capability.
      let direct;
      try {
        direct = samePath(canonical, path) && !(await lstat(path)).isSymbolicLink();
      } catch {
        continue;
      }
      if (direct && !roots.some((root) => samePath(root, canonical))) roots.push(canonical);
    }
    return roots;
  }

  async function authorize(value, options = {}) {
    const fresh = options.fresh === true;
    const resolved = await canonicalDirectoryWithIdentity(value);
    if (!resolved) return { ok: false, status: 403, error: 'workspace not authorized' };
    const cwd = resolved.path;
    const cwdIdentity = { dev: resolved.dev, ino: resolved.ino };

    const roots = await registeredRoots();
    if (roots.some((root) => samePath(root, cwd))) {
      const source = await detectRepoCached(cwd, { fresh, canonical: cwd, identity: cwdIdentity });
      const sourceRoot = source.isGit ? await canonicalDirectory(source.repoRoot) : null;
      const sourceMainRoot = source.isGit ? await canonicalDirectory(source.mainRepoRoot) : null;
      const managed = sourceRoot === cwd
        ? await validateManagedWorktree(cwd, { detected: source })
        : { ok: false };
      const [identity, mainIdentity, gitDirIdentity, gitCommonIdentity] = await Promise.all([
        stat(cwd),
        sourceMainRoot ? stat(sourceMainRoot) : Promise.resolve(null),
        source.isGit && source.gitDir ? stat(source.gitDir) : Promise.resolve(null),
        source.isGit && source.gitCommonDir ? stat(source.gitCommonDir) : Promise.resolve(null),
      ]);
      return {
        ok: true,
        cwd,
        root: cwd,
        kind: managed.ok ? 'managed-worktree' : 'workspace',
        gitBoundary: !source.isGit ? 'none' : sourceRoot === cwd ? 'root' : 'nested',
        mainRepoRoot: sourceMainRoot,
        gitDir: source.isGit ? source.gitDir : null,
        gitCommonDir: source.isGit ? source.gitCommonDir : null,
        gitDirIdentity: gitDirIdentity ? { dev: gitDirIdentity.dev, ino: gitDirIdentity.ino } : null,
        gitCommonIdentity: gitCommonIdentity ? { dev: gitCommonIdentity.dev, ino: gitCommonIdentity.ino } : null,
        identity: { dev: identity.dev, ino: identity.ino },
        mainIdentity: mainIdentity ? { dev: mainIdentity.dev, ino: mainIdentity.ino } : null,
      };
    }

    const allowedMainRoots = [];
    for (const root of roots) {
      // A registered root is not the selector being authorized: its discovery is
      // cached even on the fresh path, because the selector's own proof below is
      // live and the exact-path comparison is re-`realpath`ed either way.
      const source = await detectRepoCached(root);
      if (!source.isGit || (await canonicalDirectory(source.repoRoot)) !== root) continue;
      const sourceMain = await canonicalDirectory(source.mainRepoRoot);
      // Only an exact registered main checkout delegates the narrow temporary
      // capability used by its not-yet-registered managed children. A linked
      // Workspace never grants authority over all sibling worktrees.
      if (sourceMain === root && !allowedMainRoots.includes(sourceMain)) allowedMainRoots.push(sourceMain);
    }
    const detectedCwd = await detectRepoCached(cwd, { fresh, canonical: cwd, identity: cwdIdentity });
    const managed = await validateManagedWorktree(cwd, { detected: detectedCwd });
    if (managed.ok && allowedMainRoots.includes(managed.mainRepoRoot)) {
      const [identity, mainIdentity, gitDirIdentity, gitCommonIdentity] = await Promise.all([
        stat(cwd), stat(managed.mainRepoRoot), stat(managed.gitDir), stat(managed.gitCommonDir),
      ]);
      return {
        ok: true,
        cwd,
        root: cwd,
        kind: 'managed-worktree',
        gitBoundary: 'root',
        mainRepoRoot: managed.mainRepoRoot,
        gitDir: managed.gitDir,
        gitCommonDir: managed.gitCommonDir,
        gitDirIdentity: { dev: gitDirIdentity.dev, ino: gitDirIdentity.ino },
        gitCommonIdentity: { dev: gitCommonIdentity.dev, ino: gitCommonIdentity.ino },
        identity: { dev: identity.dev, ino: identity.ino },
        mainIdentity: { dev: mainIdentity.dev, ino: mainIdentity.ino },
      };
    }

    // DSH 0.2.1's native `create_worktree` / `working_directory` can enter a
    // real Git worktree that this plugin did not create. It is still inside
    // the registered main checkout's repository family, so read/action access
    // follows that checkout; lifecycle access (archive, cleanup) stays limited
    // to managed metadata and therefore never reaches this branch.
    const linked = await validateLinkedWorktree(cwd, { detected: detectedCwd });
    if (linked.ok && allowedMainRoots.includes(linked.mainRepoRoot)) {
      const [identity, mainIdentity, gitDirIdentity, gitCommonIdentity] = await Promise.all([
        stat(cwd), stat(linked.mainRepoRoot), stat(linked.gitDir), stat(linked.gitCommonDir),
      ]);
      return {
        ok: true,
        cwd,
        root: cwd,
        kind: 'linked-worktree',
        gitBoundary: 'root',
        mainRepoRoot: linked.mainRepoRoot,
        gitDir: linked.gitDir,
        gitCommonDir: linked.gitCommonDir,
        gitDirIdentity: { dev: gitDirIdentity.dev, ino: gitDirIdentity.ino },
        gitCommonIdentity: { dev: gitCommonIdentity.dev, ino: gitCommonIdentity.ino },
        identity: { dev: identity.dev, ino: identity.ino },
        mainIdentity: { dev: mainIdentity.dev, ino: mainIdentity.ino },
      };
    }

    return { ok: false, status: 403, error: 'workspace not authorized' };
  }

  return { authorize, registeredRoots };
}

export function isWithinRoot(root, target) {
  return contains(resolve(root), resolve(target));
}
