/* mount-check.mjs — reproduce the cordis host mount outside dsh.
 *
 * Cold-boot mounts have failed silently once (row rolled back, routes 404); the
 * loader swallows the throw from stdout. This script imports every host module
 * and every feature row, then runs each `apply()` against a minimal fake ctx —
 * first dormant (no webServer), then with a fake webServer — printing any throw
 * verbatim so the exact cold-boot failure mode is visible without restarting
 * dsh.
 *
 * 0.4.0 has four rows over one shared core runtime instead of one plugin, so
 * the additional invariant is structural: any subset of rows may mount, every
 * subset registers the prefix route exactly once, and the last disposal
 * unregisters it exactly once.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Nothing here may read the real ~/.dsh: the built-in worktree base resolves
// from DSH_HOME, and configuring another base makes the mount scan the built-in
// one for checkouts it stranded (ADR 0017).
process.env.DSH_HOME = join(mkdtempSync(join(tmpdir(), 'dsh-bw-mount-home-')), 'dshhome');
mkdirSync(process.env.DSH_HOME, { recursive: true });

const MODULES = [
  '../packages/core/lib/git.js',
  '../packages/core/lib/diff.js',
  '../packages/core/lib/worktree.js',
  '../packages/core/lib/cleanup.js',
  '../packages/core/lib/state.js',
  '../packages/core/lib/actions.js',
  '../packages/core/lib/forge.js',
  '../packages/core/lib/api.js',
  '../packages/core/lib/engine.js',
  '../packages/core/lib/index.js',
  '../packages/diff/lib/index.js',
  '../packages/worktree/lib/index.js',
  '../packages/status/lib/index.js',
  '../packages/forge/lib/index.js',
];

for (const spec of MODULES) {
  try {
    await import(spec);
    console.log(`import ok: ${spec}`);
  } catch (e) {
    console.log(`IMPORT FAIL: ${spec}\n${e && e.stack ? e.stack : e}`);
    process.exit(1);
  }
}

// Same module instances the mount configures, so the assertions below observe
// the real override rather than a fresh copy.
const core = await import('../packages/core/lib/index.js');
const { configureWorktreesBaseDir, defaultWorktreesRoot, worktreesRoot } = await import('../packages/core/lib/worktree.js');
const { createGitStateHub } = await import('../packages/core/lib/state.js');

/** The four Loader rows, by the id `cordis.patch.yml` inserts and the host half exports. */
const ROWS = [
  { id: 'bw-diff', module: await import('../packages/diff/lib/index.js') },
  { id: 'bw-worktree', module: await import('../packages/worktree/lib/index.js') },
  { id: 'bw-status', module: await import('../packages/status/lib/index.js') },
  { id: 'bw-forge', module: await import('../packages/forge/lib/index.js') },
];

/* ---------------- core is a library, never a Loader row ----------------
 * `@ds-hu/dsh-bw-core` has no `dsh.bundle`/`dsh.client`, so the panel cannot
 * switch it. A stray `apply`/`name`/`inject` export would let the Loader mount
 * it as a row and bypass the four-way switch entirely.
 */
for (const absent of ['apply', 'name', 'inject']) {
  assert.equal(absent in core, false, `core must not export "${absent}": it is a library, not a row`);
}
for (const helper of ['createCleanupScheduler', 'createCreationSourceGuard', 'assertWorkspaceArchivable', 'deleteWorkspace', 'readWorktreesDirConfig', 'acquireRuntime', 'createApi', 'groupForPath']) {
  assert.equal(typeof core[helper], 'function', `core must export the ${helper} host helper`);
}
assert.equal(core.API_PREFIX, '/better-workspaces/api', 'the one prefix survives the split');
assert.ok(Object.isFrozen(core.API_GROUPS), 'API_GROUPS is the frozen route-group contract');
for (const [group, routes] of Object.entries(core.API_GROUPS)) {
  assert.ok(Object.isFrozen(routes), `API_GROUPS.${group} must be frozen`);
  for (const route of routes) {
    const [method, sub] = route.split(' ');
    assert.equal(core.groupForPath(method, sub), group, `${route} must resolve back to group ${group}`);
  }
}
console.log(`core surface ok: ${Object.keys(core.API_GROUPS).length} route groups`);

/* ---------------- row parity: name must equal the patch row id ----------------
 * The Loader resolves the package from the row's `name`, while the row's `id` is
 * matched against the host half's exported `name` (docs §2). A drift between the
 * three silently leaves the row mounted twice or never.
 */
for (const row of ROWS) {
  assert.equal(row.module.name, row.id, `the ${row.id} host half must export name = "${row.id}"`);
  assert.deepEqual(
    [...(row.module.inject ?? [])],
    ['webServer', 'workspaceRegistry'],
    `${row.id} must wait for the web server and its authorization registry`,
  );
  assert.equal(typeof row.module.apply, 'function', `${row.id} must export apply()`);
}
console.log('row parity ok');

/**
 * A minimal Cordis context: `ctx.root` is the engine's WeakMap key, `effect`
 * records the factory (the mount runner below executes it, as Cordis does
 * immediately), and `webServer.register` counts requests for the prefix route.
 */
function fakeCtx({ withWebServer, registerThrows = false }) {
  const effects = [];
  const logs = [];
  const routes = [];
  const unregistered = [];
  const server = { registerThrows };
  let registerCalls = 0;
  const webServer = withWebServer
    ? {
        register(route) {
          registerCalls += 1;
          assert.equal(route.kind, 'prefix');
          assert.equal(route.path, core.API_PREFIX);
          if (server.registerThrows) throw new Error('duplicate route');
          routes.push(route);
          return () => { unregistered.push(route); };
        },
        registerFallback() {
          return () => {};
        },
        tapIndex(fn) {
          assert.equal(typeof fn, 'function');
          return () => {};
        },
      }
    : undefined;
  const ctx = {
    get(name) {
      if (name === 'webServer') return webServer;
      if (name === 'workspaceRegistry') return { list: () => [] };
      if (name === 'sessions') return { list: async () => [] };
      return undefined; // every optional service absent → dormant/degraded paths
    },
    on() {
      return () => {};
    },
    effect(fn, label) {
      effects.push({ label, factory: fn });
      return () => {};
    },
    logger: {
      warn: (...a) => logs.push(['warn', ...a]),
      error: (...a) => logs.push(['error', ...a]),
      info: (...a) => logs.push(['info', ...a]),
    },
  };
  ctx.root = ctx;
  return { ctx, effects, logs, routes, unregistered, server, registerCalls: () => registerCalls };
}

/** Run the effect factories appended since `since`, returning their disposers in registration order. */
function runEffects(fake, since = 0) {
  const disposers = [];
  for (let index = since; index < fake.effects.length; index += 1) {
    const entry = fake.effects[index];
    let disposer;
    try {
      disposer = entry.factory();
    } catch (error) {
      throw new Error(`EFFECT FAIL [${entry.label}]\n${error?.stack ?? error}`, { cause: error });
    }
    if (typeof disposer === 'function') disposers.push(disposer);
  }
  return disposers;
}

/** Cordis disposes a fiber's effects in reverse registration order. */
async function disposeEffects(disposers) {
  for (const dispose of [...disposers].reverse()) await dispose();
}

/** Mount one row on `fake` and return its disposers (still mounted). */
function mountRow(fake, row, config) {
  const since = fake.effects.length;
  row.module.apply(fake.ctx, config);
  return runEffects(fake, since);
}

/* ---------------- dormant and live mounts, one row at a time ----------------
 * Every row must mount against a ctx without webServer (cold boot re-activates
 * it later; a throw here rolls the row back) and against one with webServer
 * (exactly one prefix registration). Disposal must release it.
 */
for (const row of ROWS) {
  for (const withWebServer of [false, true]) {
    const fake = fakeCtx({ withWebServer });
    const disposers = [];
    try {
      disposers.push(...mountRow(fake, row));
      assert.equal(fake.registerCalls(), withWebServer ? 1 : 0, `${row.id} webServer=${withWebServer}: registration count`);
      assert.equal(fake.routes.length, withWebServer ? 1 : 0, `${row.id} webServer=${withWebServer}: mounted routes`);
      if (withWebServer) {
        // Claimed-groups-only: data is always on, every other group is off.
        assert.ok(fake.routes[0], 'the prefix route object exists');
      }
      console.log(`apply ok (${row.id}, webServer=${withWebServer}); effects=${disposers.length}; logs=${JSON.stringify(fake.logs)}`);
    } finally {
      await disposeEffects(disposers);
    }
    if (withWebServer) {
      assert.equal(fake.unregistered.length, 1, `${row.id}: last disposal must unregister the prefix once`);
    }
  }
}

/* ---------------- all four rows together: one prefix, no duplicate route ----------------
 * Four rows in one Cordis root is the whole point of 0.4.0; the failure mode is
 * a second `webServer.register` throwing "duplicate route" during cold boot.
 */
{
  const fake = fakeCtx({ withWebServer: true });
  const disposersByRow = [];
  for (const row of ROWS) disposersByRow.push(mountRow(fake, row));
  assert.equal(fake.registerCalls(), 1, 'four rows must share exactly one prefix registration');
  assert.equal(fake.routes.length, 1, 'four rows must not mount four routes');
  console.log(`four-row mount ok: registrations=${fake.registerCalls()}, effects=${fake.effects.length}`);

  // A row with no routes still owns a lease: dispose it and the shared prefix
  // must survive for the other three.
  const forgeDisposers = disposersByRow[disposersByRow.length - 1];
  await disposeEffects(forgeDisposers);
  assert.equal(fake.unregistered.length, 0, 'disposing the route-less row must not unregister the shared prefix');

  for (const disposers of [...disposersByRow.slice(0, -1)].reverse()) await disposeEffects(disposers);
  assert.equal(fake.unregistered.length, 1, 'the last row disposal unregisters the prefix exactly once');
}

/* ---------------- worktreesDir config (ADR 0017) ----------------
 * The rows accept the same optional config, but one Cordis root has one managed
 * namespace: the first non-null value wins, a repeat is harmless, a disagreement
 * is a mount error. An unconfigured mount must restore the built-in base.
 */
{
  const worktreeRow = ROWS.find((row) => row.id === 'bw-worktree');
  const diffRow = ROWS.find((row) => row.id === 'bw-diff');
  const configuredBase = join(tmpdir(), `dsh-bw-base-${process.pid}`);

  const mountOne = async (row, config) => {
    const fake = fakeCtx({ withWebServer: false });
    const disposers = mountRow(fake, row, config);
    return () => disposeEffects(disposers);
  };

  await (await mountOne(worktreeRow, { worktreesDir: configuredBase }))();
  assert.equal(worktreesRoot(), resolve(configuredBase), 'a configured worktreesDir becomes the managed base');
  await (await mountOne(worktreeRow, undefined))();
  assert.equal(worktreesRoot(), defaultWorktreesRoot(), 'an unconfigured mount restores the built-in base');

  // bw-diff mounts before bw-worktree in a real profile; the config on the
  // later row must still fix the base for the whole root.
  {
    const fake = fakeCtx({ withWebServer: false });
    const disposers = [
      ...mountRow(fake, diffRow),
      ...mountRow(fake, worktreeRow, { worktreesDir: configuredBase }),
    ];
    assert.equal(worktreesRoot(), resolve(configuredBase), 'a later row may be the one carrying the config');
    await disposeEffects(disposers);
  }

  // Two rows disagreeing is a boot failure, not a coin toss.
  {
    const fake = fakeCtx({ withWebServer: false });
    const disposers = mountRow(fake, diffRow, { worktreesDir: configuredBase });
    try {
      assert.throws(
        () => mountRow(fake, worktreeRow, { worktreesDir: join(tmpdir(), `dsh-bw-other-${process.pid}`) }),
        /worktreesDir/,
        'two rows disagreeing about the managed namespace must fail the mount',
      );
    } finally {
      await disposeEffects(disposers);
    }
  }

  // Restore the built-in base so the next block observes a clean module state.
  configureWorktreesBaseDir(null);
  console.log('worktreesDir config ok');
}

/* ---------------- invalid config is refused at mount, never half-applied ---------------- */
{
  const worktreeRow = ROWS.find((row) => row.id === 'bw-worktree');
  assert.throws(
    () => mountRow(fakeCtx({ withWebServer: false }), worktreeRow, { worktreesDir: 'relative/dir' }),
    /worktreesDir must be an absolute path/,
  );
  assert.equal(worktreesRoot(), defaultWorktreesRoot(), 'a refused value cannot leave a half-applied base');
  assert.throws(
    () => mountRow(fakeCtx({ withWebServer: false }), worktreeRow, { worktreeDir: '/tmp/nope' }),
    /unknown plugin config key/,
    'a misspelled key must fail loudly: ignoring it would move worktrees silently',
  );
  assert.throws(
    () => mountRow(fakeCtx({ withWebServer: false }), worktreeRow, { worktreesDir: '/tmp/bw-ok', extra: true }),
    /unknown plugin config key/,
  );
}

// A hub whose housekeeping timers hold the event loop turns "the suite finished"
// into "the job waited out its timeout": on a hosted Windows runner every case
// had reported within 17 seconds and the job still ran to its 45-minute limit.
// Asserting `unref()` here keeps that a seconds-long failure instead.
{
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const handles = [];
  globalThis.setInterval = () => {
    const handle = { unrefd: false, unref() { handle.unrefd = true; } };
    handles.push(handle);
    return handle;
  };
  globalThis.clearInterval = () => {};
  try {
    const hub = createGitStateHub({ onChange: () => {} });
    await hub.dispose();
  } finally {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
  assert.ok(handles.length >= 2, `the hub starts its housekeeping intervals (saw ${handles.length})`);
  assert.ok(
    handles.every((handle) => handle.unrefd),
    'every housekeeping interval must be unref\'d, or a leaked hub pins the process',
  );
  console.log(`housekeeping timers ok: ${handles.length} unref'd`);
}

// A duplicate route must dispose the API heartbeat and hub timers immediately;
// the first row's failed mount also must not poison the root: its lease was
// never recorded, so a retry on the same ctx creates a fresh runtime.
{
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const intervals = new Set();
  globalThis.setInterval = () => {
    const token = {};
    intervals.add(token);
    return token;
  };
  globalThis.clearInterval = (token) => {
    intervals.delete(token);
  };
  try {
    const fake = fakeCtx({ withWebServer: true, registerThrows: true });
    const diffRow = ROWS.find((row) => row.id === 'bw-diff');
    assert.throws(() => diffRow.module.apply(fake.ctx), /duplicate route/);
    assert.equal(intervals.size, 0, 'failed registration cannot leak hub/API intervals');

    fake.server.registerThrows = false;
    const disposers = mountRow(fake, diffRow);
    assert.equal(fake.routes.length, 1, 'the failed mount must not poison the root context');
    await disposeEffects(disposers);
    assert.equal(fake.unregistered.length, 1);
    assert.equal(intervals.size, 0, 'the retried mount cleans up its intervals on disposal');
  } finally {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
}

console.log('MOUNT CHECK: ALL PASS');
