/**
 * Regression guard for the quality-gate ignore lists.
 *
 * These ignore lists are future-failure guards, and they have already failed
 * silently once: every directory entry in `.markdownlint-cli2.jsonc` was
 * written with a bare trailing slash ("dist/", "**\/test-results/"), which
 * matches no *file* and therefore ignored nothing — while a comment in the same
 * file asserted the entries existed precisely so a failing e2e run would not
 * block the push. The gate stayed red for a reason nobody could see.
 *
 * Reading the config cannot catch that; only running the real tool can. So each
 * case below drops a deliberately non-compliant file into an ignored location
 * and asserts the tool stays quiet, AND drops the same file into a non-ignored
 * location and asserts the tool still complains. Without that second half the
 * test would pass just as happily against a tool that reported nothing at all.
 *
 * The markdownlint and jscpd cases run hermetically: the repo's real config is
 * copied into a throwaway directory, so the assertions never depend on the
 * contents of this repository.
 *
 * Note on jscpd: `.jscpd.json` sets `"gitignore": true` and `.claude/` is listed
 * in `.gitignore`, yet jscpd scanned it anyway — so that flag is not what keeps
 * the worktrees out, the explicit `**\/.claude/**` entry is. `.jscpd.json` is
 * plain JSON and cannot carry a comment saying so, hence this note. If the
 * explicit entry is ever removed on the assumption that `gitignore: true`
 * covers it, the jscpd case below fails.
 */
/*
 * This is a tooling-integration test: it builds throwaway directories on disk
 * and invokes real CLIs, so synchronous fs and computed temp paths are
 * intentional. Those two rules are disabled for this file only, matching
 * `secret-scan.suspected.test.ts`.
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
 * Walk up from `start` until the directory holding the root markdownlint config.
 * @param start - Directory to start from.
 * @returns The repository root.
 */
function findRepoRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, '.markdownlint-cli2.jsonc'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('could not locate .markdownlint-cli2.jsonc from ' + start);
}

const REPO_ROOT = findRepoRoot(HERE);

/** Markdown that violates MD025 (two h1s) and MD040 (unlanguaged fence). */
const BAD_MARKDOWN = '# One\n\n# Two\n\n```\nx\n```\n';

/**
 * Directories the markdownlint config must ignore. `.claude` holds Claude Code
 * agent worktrees; the rest are generated artifacts whose Markdown is produced
 * by other tools and is not ours to keep compliant.
 */
const IGNORED_MARKDOWN_DIRS = [
  'dist',
  'build',
  'coverage',
  'test-results',
  'playwright-report',
  'reports',
  'a11y-reports',
  'lychee',
  '.claude',
];

/** A directory that must NOT be ignored — the control. */
const LINTED_DIR = 'docs';

const scratchDirs: string[] = [];

/**
 * Create a throwaway directory, registered for cleanup.
 * @param prefix - Temp-directory prefix.
 * @returns The directory path.
 */
function scratch(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratchDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
});

describe('markdownlint ignore list', () => {
  /**
   * Run the repo's real markdownlint config over a throwaway tree.
   * @param dirs - Directories to seed with a non-compliant file.
   * @returns Combined stdout+stderr from markdownlint-cli2.
   */
  function runAgainst(dirs: string[]): string {
    const root = scratch('mdl-ignores-');
    copyFileSync(
      join(REPO_ROOT, '.markdownlint-cli2.jsonc'),
      join(root, '.markdownlint-cli2.jsonc'),
    );
    for (const d of dirs) {
      mkdirSync(join(root, d), { recursive: true });
      writeFileSync(join(root, d, 'probe.md'), BAD_MARKDOWN);
    }
    // Same argv the `markdownlint` npm script uses, so this exercises the real
    // invocation rather than a convenient approximation.
    const run = spawnSync(
      join(REPO_ROOT, 'node_modules', '.bin', 'markdownlint-cli2'),
      ['**/*.md', '#**/node_modules/**'],
      { cwd: root, encoding: 'utf8' },
    );
    return [run.stdout, run.stderr].join('');
  }

  it('reports a non-compliant file in a directory that is not ignored', () => {
    // Red-before-green: without this, the case below would pass just as happily
    // against a markdownlint that had stopped reporting anything at all.
    const output = runAgainst([LINTED_DIR]);
    expect(output).toContain(`${LINTED_DIR}/probe.md`);
    expect(output).toContain('MD025');
  });

  it('ignores a non-compliant file in every ignored directory', () => {
    // One run seeding every ignored directory plus the control: the control
    // firing proves the run happened, so each absence below is meaningful.
    const output = runAgainst([...IGNORED_MARKDOWN_DIRS, LINTED_DIR]);
    expect(output).toContain(`${LINTED_DIR}/probe.md`);
    for (const dir of IGNORED_MARKDOWN_DIRS) {
      expect(output, `${dir}/ should be ignored`).not.toContain(`${dir}/probe.md`);
    }
  });
});

describe('eslint ignore list', () => {
  // Loading the root flat config pulls in the typed-linting setup, which takes
  // well over vitest's 5s default on a cold run.
  it('ignores .claude/ but still lints real source', { timeout: 60_000 }, async () => {
    const { ESLint } = await import('eslint');
    const eslint = new ESLint({ cwd: REPO_ROOT });
    // Claude Code agent worktrees are full checkouts of this repo living inside
    // it; linting them reports every finding once per worktree.
    await expect(eslint.isPathIgnored('.claude/worktrees/agent-x/api/src/app.ts')).resolves.toBe(
      true,
    );
    // Control: the same shape of path outside .claude/ must still be linted.
    await expect(eslint.isPathIgnored('api/src/app.ts')).resolves.toBe(false);
  });
});

describe('jscpd ignore list', () => {
  it('ignores duplicates inside .claude/ but still finds them in real source', () => {
    const root = scratch('jscpd-ignores-');
    copyFileSync(join(REPO_ROOT, '.jscpd.json'), join(root, '.jscpd.json'));
    // A block long enough to clear the config's minLines/minTokens floor.
    const dupe = Array.from(
      { length: 12 },
      (_, i) =>
        `export function probeFunction${String(i)}(value: number): number {\n` +
        `  const doubled = value * 2;\n  const offset = doubled + ${String(i)};\n` +
        `  return offset;\n}\n`,
    ).join('\n');
    for (const d of ['.claude/worktrees/agent-x/src', 'src']) {
      mkdirSync(join(root, d), { recursive: true });
      writeFileSync(join(root, d, 'a.ts'), dupe);
      writeFileSync(join(root, d, 'b.ts'), dupe);
    }
    const run = spawnSync(
      join(REPO_ROOT, 'node_modules', '.bin', 'jscpd'),
      ['--config', join(root, '.jscpd.json'), '--reporters', 'console', '--threshold', '100', '.'],
      { cwd: root, encoding: 'utf8' },
    );
    const output = [run.stdout, run.stderr].join('');
    // Control: the real-source pair is detected, so detection is working...
    expect(output).toMatch(/src\/(a|b)\.ts/);
    // ...and no clone is attributed to the agent worktree.
    expect(output).not.toContain('.claude');
  });
});
