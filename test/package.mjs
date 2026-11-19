import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

/**
 * Package gate for the 0.4.0 split.
 *
 * One bundle package (`@ds-hu/dsh-better-workspaces`) ships a patch with four
 * feature rows; each row is its own npm package with a host half, a CI-built
 * browser half, locale metadata and the licence set; `@ds-hu/dsh-bw-core` is a
 * library that must never become a switchable row.
 *
 * This suite validates the manifests, the patch-row parity, the built
 * artifacts and (through `npm pack --dry-run`) the actual published file set of
 * every package. It runs after `npm run build:client` in CI.
 */

const repo = new URL('../', import.meta.url);
const repoPath = new URL('.', repo).pathname;

/** @param {string} path relative to the repository root @returns {Promise<any>} */
const readJson = async (path) => JSON.parse(await readFile(new URL(path, repo), 'utf8'));

/* Collect every published icon so the suite can prove the artwork is unique
   per module: four identical copies of the bundle mark is exactly the regression
   this gate exists for. */
const ICONS = new Map();

const FEATURES = [
  {
    dir: 'packages/diff',
    name: '@ds-hu/dsh-bw-diff',
    row: 'bw-diff',
    title: 'Code Changes',
    zhTitle: '代码变更',
  },
  {
    dir: 'packages/worktree',
    name: '@ds-hu/dsh-bw-worktree',
    row: 'bw-worktree',
    title: 'New Worktree',
    zhTitle: '新建工作树',
  },
  {
    dir: 'packages/status',
    name: '@ds-hu/dsh-bw-status',
    row: 'bw-status',
    title: 'Workspace Git Status',
    zhTitle: '工作区 Git 状态',
  },
  {
    dir: 'packages/forge',
    name: '@ds-hu/dsh-bw-forge',
    row: 'bw-forge',
    title: 'Issues & PRs',
    zhTitle: 'Issue 与 PR',
  },
];

const CORE = { dir: 'packages/core', name: '@ds-hu/dsh-bw-core' };
const DSH_ENGINE = '>=0.2.0 <0.3.0';

const root = await readJson('package.json');
assert.ok(root.name === '@ds-hu/dsh-better-workspaces', 'bundle package name');
assert.equal(typeof root.version, 'string', 'bundle version');
assert.equal(root.dsh?.bundle?.patch, './cordis.patch.yml', 'bundle patch path');
assert.equal(root.dsh?.client, undefined, 'the bundle package ships no browser half of its own');
assert.equal(root.main, undefined, 'the bundle package mounts no row of its own');
assert.equal(root.exports, undefined, 'the bundle package exports nothing');
assert.equal(root.engines?.dsh, DSH_ENGINE, 'bundle dsh engine range');
assert.deepEqual(root.workspaces, ['packages/*'], 'npm workspaces declaration');

// Dependency wiring: the bundle pins every feature package and the core
// library to its own version; feature packages pin core; nothing pins a
// sibling feature package or the bundle.
for (const feature of FEATURES) {
  assert.equal(
    root.dependencies?.[feature.name],
    root.version,
    `bundle depends on ${feature.name}@${root.version}`,
  );
}
assert.equal(root.dependencies?.[CORE.name], root.version, `bundle depends on ${CORE.name}@${root.version}`);

// ---- artwork: the bundle mark plus one distinct icon per module ----
const bundleIcon = await readFile(new URL('icon.svg', repo));
assert.ok(bundleIcon.length > 0 && bundleIcon.length <= 256 * 1024, 'bundle icon fits the 256 KiB panel limit');
assert.match(bundleIcon.toString('utf8'), /<svg[\s>]/, 'bundle icon is SVG');
assert.doesNotMatch(bundleIcon.toString('utf8'), /<script[\s>]/i, 'bundle icon is self-contained artwork');
ICONS.set('bundle', { label: 'bundle', bytes: bundleIcon });
const artwork = [...ICONS.entries()];
for (let i = 0; i < artwork.length; i += 1) {
  for (let j = i + 1; j < artwork.length; j += 1) {
    const [leftId, left] = artwork[i];
    const [rightId, right] = artwork[j];
    assert.ok(!left.bytes.equals(right.bytes), `${leftId} and ${rightId} ship distinct icon artwork`);
  }
}

// ---- the patch: exactly one row per feature, bare package names, stable ids ----
const patch = await readFile(new URL('cordis.patch.yml', repo), 'utf8');
const rows = [...patch.matchAll(/^\s*-\s+id:\s*(\S+)\s*$/gm)].map((match) => match[1]);
const names = [...patch.matchAll(/^\s+name:\s*'([^']+)'\s*$/gm)].map((match) => match[1]);
assert.deepEqual(rows, FEATURES.map((feature) => feature.row), 'patch rows are exactly the four feature ids, in order');
assert.deepEqual(names, FEATURES.map((feature) => feature.name), 'patch row names are the four package names, in order');
assert.equal(new Set(rows).size, rows.length, 'patch row ids are unique');
assert.equal(new Set(names).size, names.length, 'patch row names are unique');
// Comments are allowed to name the library; only a row may not.
assert.ok(!names.includes('@ds-hu/dsh-bw-core'), 'core is never a Loader row');
assert.ok(!rows.includes('bw-core'), 'core has no row id');

// ---- core: a library that the panel cannot switch ----
const core = await readJson(`${CORE.dir}/package.json`);
assert.equal(core.name, CORE.name, 'core package name');
assert.equal(core.version, root.version, 'core shares the release version');
assert.equal(core.main, 'lib/index.js', 'core main');
assert.equal(core.dsh, undefined, 'core declares neither dsh.bundle nor dsh.client');
assert.equal(core.engines?.dsh, DSH_ENGINE, 'core dsh engine range');
for (const file of ['lib/index.js', 'lib/engine.js', 'lib/api.js', 'lib/git.js', 'lib/worktree.js', 'lib/state.js']) {
  assert.ok(existsSync(new URL(`${CORE.dir}/${file}`, repo)), `core ships ${file}`);
}

// ---- feature packages ----
const packReports = new Map();
const npmCommand = process.env.npm_execpath ? process.execPath : 'npm';
const npmBase = process.env.npm_execpath
  ? [process.env.npm_execpath, 'pack', '--dry-run', '--json', '--ignore-scripts']
  : ['pack', '--dry-run', '--json', '--ignore-scripts'];

/**
 * Run `npm pack --dry-run` for one workspace (or the root package).
 *
 * @param {string} [workspace] package name; omitted for the root package.
 * @returns {{ files: Set<string>, size: number, unpackedSize: number }} the pack report.
 */
function packReport(workspace) {
  const args = workspace === undefined ? [...npmBase] : [...npmBase, '--workspace', workspace];
  const packed = spawnSync(npmCommand, args, {
    cwd: repoPath,
    encoding: 'utf8',
    env: { ...process.env, npm_config_loglevel: 'error' },
  });
  assert.equal(packed.status, 0, `npm pack failed for ${workspace ?? root.name}: ${packed.stderr || packed.stdout}`);
  let report;
  try {
    report = JSON.parse(packed.stdout);
  } catch (error) {
    throw new Error(`npm pack did not return JSON for ${workspace ?? root.name}: ${packed.stdout.slice(0, 500)}`, { cause: error });
  }
  assert.equal(report.length, 1, `npm pack reports exactly one package for ${workspace ?? root.name}`);
  return {
    files: new Set(report[0].files.map((entry) => entry.path)),
    size: report[0].size,
    unpackedSize: report[0].unpackedSize,
  };
}

const forFeature = async (feature) => {
  const manifest = await readJson(`${feature.dir}/package.json`);
  const label = feature.name;
  assert.equal(manifest.name, feature.name, `${label}: name`);
  assert.equal(manifest.version, root.version, `${label}: shares the release version`);
  assert.equal(manifest.main, 'lib/index.js', `${label}: host half main`);
  assert.equal(manifest.exports?.['.'], './lib/index.js', `${label}: exports the host half`);
  assert.equal(manifest.exports?.['./client'], './lib/client.js', `${label}: exports the browser half`);
  assert.equal(manifest.exports?.['./locale/*.json'], './locale/*.json', `${label}: exports locales`);
  assert.equal(manifest.exports?.['./icon'], './icon.svg', `${label}: exports the icon`);
  assert.equal(manifest.icon, './icon.svg', `${label}: icon manifest field`);
  assert.equal(manifest.engines?.dsh, DSH_ENGINE, `${label}: dsh engine range`);
  assert.equal(manifest.dsh?.bundle, undefined, `${label}: a feature row is not a bundle`);
  assert.equal(manifest.dsh?.client?.platform, 'web', `${label}: browser platform`);
  assert.ok(Array.isArray(manifest.dsh?.client?.inject), `${label}: dsh.client.inject is an array`);
  for (const injected of manifest.dsh.client.inject) {
    assert.match(injected, /^@deepseek-ai\/dsh-client-/, `${label}: injects only official client packages (${injected})`);
  }
  assert.equal(manifest.dependencies?.[CORE.name], root.version, `${label}: depends on core@${root.version}`);
  for (const other of FEATURES) {
    if (other.name === feature.name) continue;
    assert.equal(manifest.dependencies?.[other.name], undefined, `${label}: never depends on ${other.name}`);
  }
  assert.equal(manifest.dependencies?.[root.name], undefined, `${label}: never depends on the bundle`);

  // Display metadata is read without activating the plugin: both locales carry
  // a real title and description.
  for (const locale of ['en', 'zh']) {
    const dictionary = await readJson(`${feature.dir}/locale/${locale}.json`);
    assert.equal(typeof dictionary.meta?.title, 'string', `${label}: ${locale} meta.title`);
    assert.ok(dictionary.meta.title.trim() !== '', `${label}: ${locale} meta.title non-empty`);
    assert.equal(typeof dictionary.meta?.description, 'string', `${label}: ${locale} meta.description`);
    assert.ok(dictionary.meta.description.trim() !== '', `${label}: ${locale} meta.description non-empty`);
  }
  const en = await readJson(`${feature.dir}/locale/en.json`);
  const zh = await readJson(`${feature.dir}/locale/zh.json`);
  assert.equal(en.meta.title, feature.title, `${label}: English panel title`);
  assert.equal(zh.meta.title, feature.zhTitle, `${label}: Chinese panel title`);
  assert.notEqual(zh.meta.title, feature.name, `${label}: the Chinese title is a display name, not the package name`);

  // Host half: the Loader parity rule (row id == exported name) and the hard
  // dependency pair the engine needs.
  const host = await import(`../${feature.dir}/lib/index.js`);
  assert.equal(host.name, feature.row, `${label}: host half exports its row id as name`);
  assert.deepEqual([...(host.inject ?? [])], ['webServer', 'workspaceRegistry'], `${label}: host half injects the engine dependencies`);
  assert.equal(typeof host.apply, 'function', `${label}: host half exports apply`);

  // Browser half: a CI artifact whose registration id is the package name.
  const bundlePath = new URL(`${feature.dir}/lib/client.js`, repo);
  assert.ok(existsSync(bundlePath), `${label}: browser bundle exists (built by CI)`);
  const bundle = await readFile(bundlePath, 'utf8');
  assert.match(bundle, /__ModuleLoader__\.load\(/, `${label}: bundle registers with the client module table`);
  assert.ok(bundle.includes(JSON.stringify(feature.name)), `${label}: bundle registration id is the package name`);

  // The icon must be self-contained SVG artwork within the panel limit.
  const icon = await readFile(new URL(`${feature.dir}/icon.svg`, repo));
  assert.ok(icon.length > 0 && icon.length <= 256 * 1024, `${label}: icon fits the 256 KiB panel limit`);
  assert.match(icon.toString('utf8'), /<svg[\s>]/, `${label}: icon is SVG`);
  assert.doesNotMatch(icon.toString('utf8'), /<script[\s>]/i, `${label}: icon is self-contained artwork`);
  ICONS.set(feature.row, { label, bytes: icon });

  // Published file set: real code + metadata, never tests, CI config or
  // dependencies.
  const report = packReport(feature.name);
  packReports.set(feature.name, report);
  for (const required of [
    'package.json',
    'README.md',
    'LICENSE',
    'NOTICE',
    'LICENSES/paseo-Apache-2.0.txt',
    'LICENSES/dsh-git-worktree-MIT.txt',
    'locale/en.json',
    'locale/zh.json',
    'icon.svg',
    'lib/index.js',
    'lib/client.js',
  ]) {
    assert.ok(report.files.has(required), `${label}: published package is missing ${required}`);
  }
  for (const path of report.files) {
    assert.ok(!path.startsWith('test/'), `${label}: test fixture leaked into package: ${path}`);
    assert.ok(!path.startsWith('.github/'), `${label}: CI file leaked into package: ${path}`);
    assert.ok(!path.startsWith('node_modules/'), `${label}: dependency leaked into package: ${path}`);
    assert.ok(!path.startsWith('client/'), `${label}: browser source leaked into the package: ${path}`);
    assert.ok(!path.endsWith('.tgz'), `${label}: nested tarball leaked into package: ${path}`);
  }
  return manifest;
};

for (const feature of FEATURES) await forFeature(feature);

// The bundle package: metadata and docs only, never the workspace sources.
const bundleReport = packReport();
for (const required of ['package.json', 'README.md', 'LICENSE', 'cordis.patch.yml', 'icon.svg', 'locale/en.json', 'locale/zh.json', 'docs/ARCHITECTURE-modules.md']) {
  assert.ok(bundleReport.files.has(required), `bundle package is missing ${required}`);
}
for (const path of bundleReport.files) {
  assert.ok(!path.startsWith('packages/'), `bundle package leaked a workspace package: ${path}`);
  assert.ok(!path.startsWith('test/'), `test fixture leaked into package: ${path}`);
  assert.ok(!path.startsWith('scripts/'), `build script leaked into package: ${path}`);
  assert.ok(!path.startsWith('.github/'), `CI file leaked into package: ${path}`);
  assert.ok(!path.startsWith('node_modules/'), `dependency leaked into package: ${path}`);
  assert.notEqual(path, 'eslint.config.js', 'lint config leaked into package');
  assert.notEqual(path, 'package-lock.json', 'lockfile leaked into package');
  assert.ok(!path.endsWith('.tgz'), `nested tarball leaked into package: ${path}`);
}

const packedSizes = [...packReports.values()].map((report) => report.size);
assert.ok(packedSizes.every((size) => size > 0), 'every feature package has a plausible packed size');
assert.ok(bundleReport.size > 0 && bundleReport.unpackedSize > bundleReport.size, 'bundle package has plausible sizes');

console.log(`PACKAGE: ALL PASS (${FEATURES.length} feature packages + core + bundle)`);
