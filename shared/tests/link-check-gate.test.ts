/**
 * Regression guard for `scripts/link-check.sh`, the wrapper the `links` gate
 * runs (#155).
 *
 * lychee writes a timeout to `.lycheecache` with an EMPTY status field
 * (`url,,timestamp`), and `--cache-exclude-status` only understands codes
 * between 100 and 999 — so no configuration can keep a timeout out of the
 * cache. With `max_cache_age = "2d"`, one slow response from a healthy host
 * then failed every later run instantly with `Error (cached)` until the row was
 * deleted by hand. The wrapper drops those undecided rows around each run.
 *
 * That pruning is silent by construction: if it stops working — lychee changes
 * the cache format, the field arithmetic drifts — nothing fails loudly, the
 * gate just quietly starts blocking pushes again. Same lesson as
 * `generated-specs-gate.test.ts`: reading the script cannot catch that, only
 * running the real one can. So these cases run the actual script with a stubbed
 * `lychee` on PATH, and assert both that undecided rows go AND that decided
 * rows survive — a script that simply emptied the cache would pass half of this
 * and fail the other half.
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
const SCRIPT = 'scripts/link-check.sh';
const CACHE = '.lycheecache';

/**
 * Walk up from `start` until the directory holding the gate script.
 * @param start - Directory to start from.
 * @returns The repository root.
 */
function findRepoRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, SCRIPT))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`could not locate ${SCRIPT} from ${start}`);
}

const REPO_ROOT = findRepoRoot(HERE);

const scratchDirs: string[] = [];

afterAll(() => {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
});

/** A decided row: lychee reached the URL and recorded a status. */
const OK_ROW = 'https://example.com/reachable,200,1787776000';
/** A decided failure. It stays cached on purpose — a 404 is not a flake. */
const NOT_FOUND_ROW = 'https://example.com/gone,404,1787776001';
/** What a timeout looks like: no status at all. This is what must be dropped. */
const TIMEOUT_ROW = 'https://example.com/slow,,1787776002';
/** The same, for a URL that itself contains commas — `$2` would miss this. */
const TIMEOUT_ROW_COMMA_URL = 'https://example.com/a,b,c/slow,,1787776003';
/** A decided row whose URL contains commas, which must NOT be dropped. */
const OK_ROW_COMMA_URL = 'https://example.com/x,y/page,200,1787776004';

/**
 * Build a throwaway working directory holding the real script, a stub `lychee`,
 * and an optional seeded cache.
 * @param options - Fixture options.
 * @param options.cacheRows - Rows to seed `.lycheecache` with, or null for no cache file.
 * @param options.lycheeExit - Exit status the stubbed lychee returns.
 * @param options.lycheeWritesRows - Rows the stub appends to the cache, as a real run would.
 * @returns The fixture directory.
 */
function fixture(options: {
  cacheRows?: string[] | null;
  lycheeExit?: number;
  lycheeWritesRows?: string[];
}): string {
  const { cacheRows = [], lycheeExit = 0, lycheeWritesRows = [] } = options;

  const root = mkdtempSync(join(tmpdir(), 'link-check-'));
  scratchDirs.push(root);

  mkdirSync(join(root, 'scripts'), { recursive: true });
  copyFileSync(join(REPO_ROOT, SCRIPT), join(root, SCRIPT));

  if (cacheRows !== null) writeFileSync(join(root, CACHE), cacheRows.join('\n') + '\n');

  // Stub lychee: append whatever rows this case says a run would produce, echo
  // the arguments it was handed (so argument forwarding is observable), exit
  // with the given status.
  const stubDir = join(root, 'stub');
  mkdirSync(stubDir, { recursive: true });
  const appends = lycheeWritesRows.map(
    (row) => `printf '%s\\n' ${JSON.stringify(row)} >> ${CACHE}`,
  );
  writeFileSync(
    join(stubDir, 'lychee'),
    [
      '#!/usr/bin/env bash',
      'echo "STUB ARGS: $*"',
      ...appends,
      `exit ${String(lycheeExit)}`,
      '',
    ].join('\n'),
    { mode: 0o755 },
  );

  return root;
}

/**
 * Run the real gate script inside a fixture.
 * @param root - Fixture directory.
 * @param args - Extra arguments, as `npm run links -- …` would supply.
 * @returns Exit status, combined output, and the resulting cache rows.
 */
function runGate(
  root: string,
  ...args: string[]
): { status: number | null; output: string; rows: string[] } {
  const run = spawnSync('bash', [SCRIPT, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${join(root, 'stub')}:${process.env['PATH'] ?? ''}` },
  });
  const cachePath = join(root, CACHE);
  const rows = existsSync(cachePath)
    ? readFileSync(cachePath, 'utf8')
        .split('\n')
        .filter((row) => row !== '')
    : [];
  return { status: run.status, output: [run.stdout, run.stderr].join(''), rows };
}

describe('link-check gate (#155)', () => {
  it('drops a cached timeout before the run, so it cannot decide this run', () => {
    // The poisoning that prompted #155: the row is already there when the gate
    // starts, put there by a direct lychee invocation or an older cache.
    const root = fixture({ cacheRows: [OK_ROW, TIMEOUT_ROW, NOT_FOUND_ROW] });
    const { status, output, rows } = runGate(root);

    expect(status).toBe(0);
    expect(rows).not.toContain(TIMEOUT_ROW);
    expect(output).toContain('dropped 1 undecided');
    // Decided rows survive, or the cache would be useless and every run slow.
    expect(rows).toContain(OK_ROW);
    expect(rows).toContain(NOT_FOUND_ROW);
  });

  it('drops a timeout written by the run itself, so it cannot decide the next one', () => {
    const root = fixture({ cacheRows: [OK_ROW], lycheeExit: 2, lycheeWritesRows: [TIMEOUT_ROW] });
    const { status, rows } = runGate(root);

    // The run still fails — a link really did not answer.
    expect(status).toBe(2);
    // But the next run re-checks it live instead of replaying `Error (cached)`.
    expect(rows).not.toContain(TIMEOUT_ROW);
    expect(rows).toContain(OK_ROW);
  });

  it('addresses the status from the end of the row, so a URL containing commas is handled', () => {
    // `awk -F, '$2 != ""'` keeps TIMEOUT_ROW_COMMA_URL and re-poisons the cache.
    const root = fixture({ cacheRows: [OK_ROW_COMMA_URL, TIMEOUT_ROW_COMMA_URL] });
    const { rows } = runGate(root);

    expect(rows).not.toContain(TIMEOUT_ROW_COMMA_URL);
    expect(rows).toContain(OK_ROW_COMMA_URL);
  });

  it('passes a clean cache through untouched and stays quiet', () => {
    // Control: without this, a script that always reported "dropped" or always
    // rewrote the cache would satisfy the cases above.
    const root = fixture({ cacheRows: [OK_ROW, NOT_FOUND_ROW] });
    const { status, output, rows } = runGate(root);

    expect(status).toBe(0);
    expect(output).not.toContain('dropped');
    expect(rows).toStrictEqual([OK_ROW, NOT_FOUND_ROW]);
  });

  it('propagates lychee failure, so the gate can still fail', () => {
    // The #149 lesson: a gate that cannot fail is worse than no gate.
    const root = fixture({ cacheRows: [OK_ROW], lycheeExit: 2 });
    const { status, output } = runGate(root);

    expect(status).toBe(2);
    expect(output).toContain('lychee exited 2');
  });

  it('forwards extra arguments to lychee', () => {
    // `npm run links -- --verbose` must still reach lychee; wrapping the
    // command in a script silently swallowed it until this was fixed.
    const { output } = runGate(fixture({}), '--verbose');

    expect(output).toContain('STUB ARGS: --no-progress **/*.md --verbose');
  });

  it('runs without a cache file at all', () => {
    const root = fixture({ cacheRows: null });
    const { status } = runGate(root);

    expect(status).toBe(0);
  });
});
