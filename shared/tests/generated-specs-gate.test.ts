/**
 * Regression guard for the `usecases-specs-in-sync` CI gate.
 *
 * The gate originally ran `git diff --quiet -- '**\/e2e/generated/'`. Without
 * `:(glob)` magic, git's `*` does not cross `/`, so that pathspec matched no
 * file and the check could never fail; and `git diff` never reports untracked
 * files, so a freshly generated spec was invisible regardless (#149). Three
 * specs shipped in v0.3.0 sat untracked while the job stayed green.
 *
 * Same lesson as `gate-ignores.test.ts`: reading the config cannot catch this,
 * only running the real command can. Each case below builds a throwaway git
 * repo with a committed spec, seeds one kind of drift, and asserts the script
 * fails — AND asserts the clean tree passes, so the test cannot be satisfied by
 * a script that always exits 1.
 */
/* eslint-disable n/no-sync, security/detect-non-literal-fs-filename */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Walk up from `start` until the directory holding the gate script.
 * @param start - Directory to start from.
 * @returns The repository root.
 */
function findRepoRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, 'scripts', 'check-generated-specs.sh'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('could not locate scripts/check-generated-specs.sh from ' + start);
}

const REPO_ROOT = findRepoRoot(HERE);
const SCRIPT = 'scripts/check-generated-specs.sh';
const UI_SPEC = 'ui/e2e/generated/probe.spec.ts';
const WIDGET_SPEC = 'widget/e2e/generated/probe.spec.ts';

const scratchDirs: string[] = [];

afterAll(() => {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
});

/**
 * Environment for git invoked inside the fixture. Git hooks (husky's pre-push
 * runs this suite) export GIT_DIR, GIT_INDEX_FILE, GIT_WORK_TREE and friends;
 * a child git inherits them and silently operates on THIS repository instead
 * of the temp one — `git init` then flipped the real checkout to core.bare
 * and `git commit` landed a "seed" commit on the real branch. Strip every
 * GIT_* variable so the fixture is the only repository the child can see
 * (same guard as `secret-scan.suspected.test.ts`, learned the same way).
 */
const GIT_ENV: NodeJS.ProcessEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')),
);

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
 * Build a throwaway git repo (never this checkout — see the livechat fixture
 * incident) with the real gate script and one committed spec per output dir.
 * @returns The repo path.
 */
function fixtureRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'specs-gate-'));
  scratchDirs.push(root);
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'test');
  mkdirSync(join(root, 'scripts'), { recursive: true });
  copyFileSync(join(REPO_ROOT, SCRIPT), join(root, SCRIPT));
  for (const spec of [UI_SPEC, WIDGET_SPEC]) {
    mkdirSync(dirname(join(root, spec)), { recursive: true });
    writeFileSync(join(root, spec), '// generated\n');
  }
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'seed');
  return root;
}

/**
 * Run the gate script in `cwd`.
 * @param cwd - Fixture repo.
 * @returns Exit status and combined output.
 */
function runGate(cwd: string): { status: number | null; output: string } {
  const run = spawnSync('bash', [SCRIPT], { cwd, encoding: 'utf8', env: GIT_ENV });
  return { status: run.status, output: [run.stdout, run.stderr].join('') };
}

describe('usecases-specs-in-sync gate', () => {
  it('passes on a clean tree', () => {
    const { status, output } = runGate(fixtureRepo());
    expect(output).toContain('in sync');
    expect(status).toBe(0);
  });

  it('fails when a committed spec is modified (hand-edit or stale regeneration)', () => {
    const root = fixtureRepo();
    writeFileSync(join(root, UI_SPEC), '// generated\n// drift\n');
    const { status, output } = runGate(root);
    expect(status).toBe(1);
    expect(output).toContain('out of sync');
    expect(output).toContain(UI_SPEC);
  });

  it('fails when the generator produces a spec that was never committed', () => {
    const root = fixtureRepo();
    const untracked = 'widget/e2e/generated/brand-new.spec.ts';
    writeFileSync(join(root, untracked), '// generated\n');
    const { status, output } = runGate(root);
    expect(status).toBe(1);
    expect(output).toContain(untracked);
  });

  it('fails when a committed spec is no longer generated', () => {
    const root = fixtureRepo();
    rmSync(join(root, WIDGET_SPEC));
    const { status, output } = runGate(root);
    expect(status).toBe(1);
    expect(output).toContain(WIDGET_SPEC);
  });

  it('ignores drift outside the generated directories', () => {
    // Control: the gate must not fire on unrelated changes, or it would block
    // every PR touching anything else.
    const root = fixtureRepo();
    writeFileSync(join(root, 'ui/e2e/handwritten.spec.ts'), '// not generated\n');
    const { status } = runGate(root);
    expect(status).toBe(0);
  });
});
