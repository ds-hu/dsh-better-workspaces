import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Build every feature client bundle.
 *
 * Source lives in `packages/<feature>/client/` (ES modules importing the
 * shared browser source from `@ds-hu/dsh-bw-core/client/*`); the artifact is
 * `packages/<feature>/lib/client.js`, wrapped in the DSH client-module
 * registration the browser's `window.__ModuleLoader__` consumes.
 *
 * Only CI runs this: built artifacts are git-ignored and are produced before
 * tests and before publish.
 */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Module specifiers the client module table provides at runtime. */
const EXTERNALS = Object.freeze([
  'react',
  'react-dom/client',
  'react/jsx-runtime',
  '@deepseek-ai/dsh-client-ui-primitives',
]);

/** The four feature bundles. The `id` is the package name the Loader row mounts. */
export const TARGETS = Object.freeze([
  { feature: 'diff', id: '@ds-hu/dsh-bw-diff' },
  { feature: 'worktree', id: '@ds-hu/dsh-bw-worktree' },
  { feature: 'status', id: '@ds-hu/dsh-bw-status' },
  { feature: 'forge', id: '@ds-hu/dsh-bw-forge' },
]);

/**
 * Wrap esbuild's CJS output in one client-module registration. The factory must
 * bind React itself: esbuild keeps it external and the module table is the only
 * React provider in the page (never a global).
 *
 * @param bundled - esbuild CJS output.
 * @param id - package name (graph row id) the registration answers.
 * @returns the registration script.
 */
export function wrapBundle(bundled, id) {
  return `window.__ModuleLoader__.load({
  id: ${JSON.stringify(id)},
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require("react");
${bundled}
    return module.exports;
  }
});
`;
}

/**
 * Build one target.
 *
 * @param target - a member of {@link TARGETS}.
 * @returns the absolute artifact path.
 */
export async function buildTarget(target) {
  const featureDir = join(repoRoot, 'packages', target.feature);
  const entry = join(featureDir, 'client', 'index.js');
  const output = join(featureDir, 'lib', 'client.js');
  const result = await build({
    absWorkingDir: repoRoot,
    entryPoints: [entry],
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    target: ['chrome100'],
    external: [...EXTERNALS],
    write: false,
    minify: process.env.NODE_ENV === 'production',
    legalComments: 'none',
    logLevel: 'warning',
  });
  const bundled = result.outputFiles?.[0]?.text;
  if (!bundled) throw new Error(`esbuild produced no bundle for ${target.id}`);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, wrapBundle(bundled, target.id), 'utf8');
  return output;
}

/**
 * Rebuild every bundle (or the ones named in argv).
 *
 * @param argv - feature names to restrict the build to; empty builds all.
 * @returns absolute artifact paths.
 */
export async function buildAll(argv) {
  const only = argv.filter((arg) => !arg.startsWith('-'));
  const targets = only.length === 0 ? TARGETS : TARGETS.filter((target) => only.includes(target.feature));
  if (only.length > 0 && targets.length !== only.length) {
    const known = TARGETS.map((target) => target.feature).join(', ');
    throw new Error(`unknown build target; expected one of: ${known}`);
  }
  const outputs = [];
  for (const target of targets) outputs.push(await buildTarget(target));
  return outputs;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // `import.meta.url` compare above: only the direct CLI invocation builds.
  const outputs = await buildAll(process.argv.slice(2));
  const rootPackage = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8'));
  process.stdout.write(`build:client ${rootPackage.version}: ${outputs.length} bundle(s)\n`);
  for (const output of outputs) process.stdout.write(`  ${output.slice(repoRoot.length + 1)}\n`);
}
