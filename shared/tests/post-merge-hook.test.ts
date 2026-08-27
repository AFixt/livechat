/**
 * Regression guard for the post-merge install hook.
 *
 * `.husky/post-merge` reinstalls when a merge or checkout moved the lockfile.
 * It used to run `npm install`, which RE-RESOLVES dependencies and rewrites
 * `package-lock.json`. This repo's zod overrides leave npm two defensible
 * resolutions for `chromium-bidi`'s zod, so it alternates between them (#161) —
 * and the tree went dirty on every branch switch, for a file nobody edited,
 * with `git commit -am` standing ready to sweep it into an unrelated commit.
 *
 * `npm ci` installs exactly what is committed and never writes the lockfile.
 * But it DELETES `node_modules` first, so a failure part-way leaves no working
 * install at all — which is how the environment was destroyed while #161 was
 * being investigated. Hence the fallback to `npm install`.
 *
 * Both halves are load-bearing and both are asserted here, in the manner of
 * `pre-push-hook.test.ts`: that the hook reaches for `ci` and not `install` on
 * the happy path, AND that a failing `ci` still ends with a working install.
 * Without the second half the test would pass just as happily against a hook
 * that left the developer with nothing.
 *
 * The real hook file is executed, with `npm` stubbed on PATH — so what is under
 * test is the shipped file's branching, not a re-implementation of it.
 */
/* eslint-disable n/no-sync, security/detect-non-literal-fs-filename */
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK = '.husky/post-merge';

/**
 * Walk up from `start` until the directory holding the hook.
 * @param start - Directory to start from.
 * @returns The repository root.
 */
function findRepoRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, HOOK))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`could not locate ${HOOK} from ${start}`);
}

const REPO_ROOT = findRepoRoot(HERE);

/**
 * Git hooks export GIT_DIR and friends; a child git would otherwise operate on
 * THIS repository instead of the fixture. Same guard as
 * `generated-specs-gate.test.ts`, learned the same way.
 */
const GIT_ENV: NodeJS.ProcessEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')),
);

const scratchDirs: string[] = [];

afterAll(() => {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
});

/**
 * Run git in `cwd`, throwing on failure.
 * @param cwd - Repository directory.
 * @param args - git arguments.
 */
function git(cwd: string, ...args: string[]): void {
  const run = spawnSync('git', args, { cwd, encoding: 'utf8', env: GIT_ENV });
  if (run.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${run.stderr}`);
}

/**
 * Build a throwaway repo carrying the real hook, a stubbed `npm`, and a commit
 * history whose tip either did or did not touch the lockfile.
 * @param options - Fixture options.
 * @param options.touchLockfile - Whether the last commit modifies package-lock.json.
 * @param options.ciExit - Exit status the stubbed `npm ci` returns.
 * @returns The fixture directory.
 */
function fixture(options: { touchLockfile: boolean; ciExit?: number }): string {
  const { touchLockfile, ciExit = 0 } = options;

  const root = mkdtempSync(join(tmpdir(), 'post-merge-'));
  scratchDirs.push(root);

  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'test');

  mkdirSync(join(root, '.husky'), { recursive: true });
  copyFileSync(join(REPO_ROOT, HOOK), join(root, HOOK));
  writeFileSync(join(root, 'package-lock.json'), '{"lockfileVersion":3}\n');
  writeFileSync(join(root, 'README.md'), 'seed\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'seed');

  // A second commit, so HEAD@{1} resolves. Whether it touches the lockfile is
  // what the hook branches on.
  writeFileSync(join(root, touchLockfile ? 'package-lock.json' : 'README.md'), 'changed\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'second');

  // Stub npm: record every invocation, and let `ci` fail on demand.
  const stubDir = join(root, 'stub');
  mkdirSync(stubDir, { recursive: true });
  writeFileSync(
    join(stubDir, 'npm'),
    [
      '#!/usr/bin/env bash',
      `echo "npm $*" >> "${join(root, 'npm-calls.log')}"`,
      `if [ "$1" = "ci" ]; then exit ${String(ciExit)}; fi`,
      'exit 0',
      '',
    ].join('\n'),
    { mode: 0o755 },
  );

  return root;
}

/**
 * Run the real hook inside a fixture.
 * @param root - Fixture directory.
 * @returns The npm invocations it made, plus combined output.
 */
function runHook(root: string): { calls: string[]; output: string } {
  const run = spawnSync('bash', [HOOK], {
    cwd: root,
    encoding: 'utf8',
    env: { ...GIT_ENV, PATH: `${join(root, 'stub')}:${process.env['PATH'] ?? ''}` },
  });
  const log = join(root, 'npm-calls.log');
  const calls = existsSync(log)
    ? readFileSync(log, 'utf8')
        .split('\n')
        .filter((line) => line !== '')
    : [];
  return { calls, output: [run.stdout, run.stderr].join('') };
}

describe('post-merge install hook (#161)', () => {
  it('installs with `npm ci`, which never rewrites the lockfile', () => {
    const { calls } = runHook(fixture({ touchLockfile: true }));

    expect(calls).toContain('npm ci');
    // The whole point: `npm install` re-resolves and rewrites package-lock.json.
    expect(calls).not.toContain('npm install');
  });

  it('falls back to `npm install` when ci fails, rather than leaving no install', () => {
    // `npm ci` deletes node_modules before installing, so a failure part-way
    // leaves nothing. A rewritten lockfile beats an unusable checkout.
    const { calls, output } = runHook(fixture({ touchLockfile: true, ciExit: 1 }));

    expect(calls).toContain('npm ci');
    expect(calls).toContain('npm install');
    expect(output).toContain('falling back');
  });

  it('does nothing at all when the merge did not touch the lockfile', () => {
    // Control: without this, a hook that reinstalled unconditionally would
    // satisfy both cases above while making every merge slow.
    const { calls } = runHook(fixture({ touchLockfile: false }));

    expect(calls).toStrictEqual([]);
  });

  it('still runs the audit after a successful install', () => {
    const { calls } = runHook(fixture({ touchLockfile: true }));

    expect(calls.some((call) => call.startsWith('npm audit'))).toBe(true);
  });
});
