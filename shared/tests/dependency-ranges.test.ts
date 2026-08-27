/**
 * Guard for override-induced dependency-range violations (#165).
 *
 * The root `overrides` block forces versions on transitive dependencies —
 * mostly to pull in patched releases ahead of what a parent declares. That is
 * what overrides are for. The hazard is that npm reports an overridden edge as
 * satisfied-by-fiat: `npm ls` marks it `overridden`, never `invalid`, so
 * `npm ls | grep invalid` returns zero however far an override drags a package
 * off its declared range. That check was in this repo's own acceptance criteria
 * for #163 and could not have failed.
 *
 * Discovered the hard way: `@afixt/usecase-runner@2.0.1` declares `zod@^4.4.3`
 * and was silently running on `4.3.6` — a package older than its stated
 * minimum, which is the one direction that can break at runtime on any code
 * path we do not happen to exercise.
 *
 * So this walks the installed tree, compares every declared `dependencies` and
 * non-optional `peerDependencies` range against the version actually resolvable
 * from that package, and classifies what it finds:
 *
 *   OLDER-THAN-REQUIRED  the resolved version is below the range's minimum.
 *                        Always a failure. A package cannot call an API that
 *                        does not exist yet.
 *   MAJOR-JUMP           resolved across a major boundary. Allowed only with an
 *                        entry in ACCEPTED_MAJOR_JUMPS explaining why.
 *   ahead-in-line        newer, same major. This is the intended effect of a
 *                        security override; not reported.
 *
 * It reads what is on disk rather than the lockfile, because the lockfile is
 * what we intend and node_modules is what actually gets imported.
 */
/* eslint-disable n/no-sync, security/detect-non-literal-fs-filename */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import semver from 'semver';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Walk up from `start` to the directory holding the root package.json.
 * @param start - Directory to start from.
 * @returns The repository root.
 */
function findRepoRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, 'package-lock.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`could not locate the repository root from ${start}`);
}

const REPO_ROOT = findRepoRoot(HERE);

/**
 * Major-version overrides we have looked at and decided to keep. Each entry is
 * a promise that someone checked the consequence, so leave the reason attached.
 */
const ACCEPTED_MAJOR_JUMPS: Record<string, string> = {
  // puppeteer's BiDi layer, four levels down under @afixt/usecase-runner. The
  // root override moves the whole tree to zod 4; pinning chromium-bidi back to
  // zod 3 was measured and made things worse (invalid=2, overridden=5, three
  // zod copies). We never call chromium-bidi directly — puppeteer drives it.
  'chromium-bidi:zod': 'forced 3.x -> 4.x by the root zod override; not called directly (#165)',
  // sequelize 6 declares uuid ^8; the override lifts it to 11 to clear
  // advisories against the 8.x line. Sequelize uses uuid only to generate v4
  // ids, an API stable across all three majors.
  'sequelize:uuid': 'forced 8.x -> 11.x for advisories; only uuid.v4() is used (#165)',
};

interface PackageManifest {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  /** An optional peer that is absent is not a violation — npm treats it as satisfied. */
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}

interface Violation {
  kind: 'OLDER-THAN-REQUIRED' | 'MAJOR-JUMP';
  parent: string;
  dep: string;
  range: string;
  resolved: string;
  key: string;
}

/**
 * Read a package.json, or null when absent or unparseable.
 * @param dir - Directory holding the manifest.
 * @returns The parsed manifest, or null.
 */
function readPkg(dir: string): PackageManifest | null {
  try {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as PackageManifest;
  } catch {
    return null;
  }
}

/**
 * Resolve `name` the way Node would from `fromDir`: nearest `node_modules`
 * walking upward. Reading the tree, not the lockfile, is the point.
 * @param fromDir - Directory of the package doing the requiring.
 * @param name - Package being required.
 * @returns The resolved manifest, or null when nothing is installed.
 */
function resolveFrom(fromDir: string, name: string): { version?: string } | null {
  let dir = fromDir;
  for (;;) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return readPkg(candidate);
    const parent = dirname(dir);
    if (parent === dir || !dir.startsWith(REPO_ROOT)) return null;
    dir = parent;
  }
}

/**
 * How deep a nested node_modules chain this walk will follow. The tree bottoms
 * out at 2 today, measured; the cap is a runaway guard, not a budget. It is
 * reported rather than silently applied — a detector that quietly stops looking
 * is the failure this whole test exists to prevent.
 */
const MAX_NESTING = 12;

/** Deepest nesting actually reached, so the cap can be asserted against it. */
let deepestSeen = 0;

/**
 * Yield every installed package under a node_modules directory.
 * @param nmDir - A node_modules directory.
 * @param depth - Current nesting depth.
 * @yields Directory and manifest for each package found.
 */
function* walkInstalled(
  nmDir: string,
  depth = 0,
): Generator<[string, NonNullable<ReturnType<typeof readPkg>>]> {
  if (depth > MAX_NESTING || !existsSync(nmDir)) return;
  if (depth > deepestSeen) deepestSeen = depth;
  for (const entry of readdirSync(nmDir)) {
    if (entry === '.bin' || entry.startsWith('.')) continue;
    const full = join(nmDir, entry);
    if (entry.startsWith('@')) {
      yield* walkInstalled(full, depth);
      continue;
    }
    const pkg = readPkg(full);
    if (pkg) yield [full, pkg];
    yield* walkInstalled(join(full, 'node_modules'), depth + 1);
  }
}

/**
 * Collect every declared range the installed tree does not satisfy.
 * @returns Violations, deduplicated by parent/dep/resolved.
 */
function findViolations(): Violation[] {
  const found = new Map<string, Violation>();

  for (const [dir, pkg] of walkInstalled(join(REPO_ROOT, 'node_modules'))) {
    const declared = [
      ...Object.entries(pkg.dependencies ?? {}),
      // Peers break at runtime just as hard, and cost nothing to include: there
      // are none violated today, so this is coverage against tomorrow.
      ...Object.entries(pkg.peerDependencies ?? {}).filter(
        ([dep]) => pkg.peerDependenciesMeta?.[dep]?.optional !== true,
      ),
    ];

    for (const [dep, range] of declared) {
      if (!semver.validRange(range)) continue;

      const resolved = resolveFrom(dir, dep)?.version;
      if (resolved === undefined || semver.satisfies(resolved, range)) continue;

      const min = semver.minVersion(range);
      if (min === null) continue;

      const kind = semver.lt(resolved, min)
        ? 'OLDER-THAN-REQUIRED'
        : semver.major(resolved) === semver.major(min)
          ? null // ahead within the same major: the intended effect of an override
          : 'MAJOR-JUMP';
      if (kind === null) continue;

      const key = `${pkg.name ?? dir}:${dep}`;
      found.set(`${key}@${resolved}`, {
        kind,
        parent: `${pkg.name ?? dir}@${pkg.version ?? '?'}`,
        dep,
        range,
        resolved,
        key,
      });
    }
  }

  return [...found.values()];
}

/**
 * Render violations for an assertion message.
 * @param violations - The violations to describe.
 * @returns One line per violation.
 */
function describeAll(violations: Violation[]): string {
  return violations
    .map((v) => `  [${v.kind}] ${v.parent} needs ${v.dep}@${v.range} -> resolved ${v.resolved}`)
    .join('\n');
}

describe('dependency ranges under the root overrides (#165)', () => {
  const violations = findViolations();

  it('resolves nothing OLDER than the version its parent requires', () => {
    // The dangerous direction, and the one npm will never call invalid while an
    // override is responsible. `usecase-runner` spent this repo's whole 2.x
    // upgrade running on a zod below its declared minimum.
    const older = violations.filter((v) => v.kind === 'OLDER-THAN-REQUIRED');

    expect(
      older,
      `packages resolved below their required minimum:\n${describeAll(older)}`,
    ).toStrictEqual([]);
  });

  it('crosses a major boundary only where that has been accepted in writing', () => {
    const unexplained = violations.filter(
      (v) => v.kind === 'MAJOR-JUMP' && !(v.key in ACCEPTED_MAJOR_JUMPS),
    );

    expect(
      unexplained,
      `major-version overrides with no entry in ACCEPTED_MAJOR_JUMPS:\n${describeAll(unexplained)}\n` +
        'Add one with the reason it is safe, or change the override.',
    ).toStrictEqual([]);
  });

  it('walked the whole tree rather than stopping at the nesting cap', () => {
    // Without this the cap could truncate the scan and every other case here
    // would still pass, reporting a clean tree it never finished reading.
    expect(
      deepestSeen,
      `the walk reached the ${String(MAX_NESTING)} level cap, so packages below it went unchecked — raise MAX_NESTING`,
    ).toBeLessThan(MAX_NESTING);
  });

  it('has no stale entries in the accepted list', () => {
    // Control: without this the allowlist only ever grows, and an entry that
    // stopped applying would keep vouching for a condition that no longer
    // exists — the same shape of dead reassurance as a gate that cannot fail.
    const live = new Set(violations.filter((v) => v.kind === 'MAJOR-JUMP').map((v) => v.key));
    const stale = Object.keys(ACCEPTED_MAJOR_JUMPS).filter((key) => !live.has(key));

    expect(
      stale,
      `ACCEPTED_MAJOR_JUMPS entries no longer matching anything: ${stale.join(', ')}`,
    ).toStrictEqual([]);
  });
});
