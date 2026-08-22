/**
 * Regression guard for the pre-push gate's skip logic.
 *
 * `.husky/pre-push` skips the full `check:all` sweep for pushes that carry no
 * new commits — tag-only pushes, and branch deletions. That is a deliberate
 * hole in a protection mechanism, and the dangerous failure is not the hole
 * being too small but too big: a bug that widens it to a push carrying real
 * commits would let unchecked code through, silently, with the hook still
 * printing a reassuring line.
 *
 * So every case below asserts BOTH directions, in the manner of
 * `gate-ignores.test.ts`: that the hook skips exactly the pushes it should,
 * AND that it still runs the gate for everything else. Without the second half
 * the test would pass just as happily against a hook that skipped everything.
 *
 * The hook is executed for real, with only its final `npm run check:all` line
 * swapped for a marker — so what is under test is the actual shipped file's
 * parsing and branching, not a re-implementation of it. Swapping the last line
 * is what keeps the suite fast; the decision logic above it is untouched.
 *
 * The input shapes are git's documented pre-push stdin format:
 *   <local ref> <local sha> <remote ref> <remote sha>
 * with `(delete)` and an all-zero local sha for a deletion. Verified against
 * real git, not only assumed: deleting a remote branch prints the skip line.
 */
/* eslint-disable n/no-sync, security/detect-non-literal-fs-filename */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Walk up from `start` until the directory holding the husky hooks.
 * @param start - Directory to start from.
 * @returns The repository root.
 */
function findRepoRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, '.husky', 'pre-push'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`could not locate .husky/pre-push from ${start}`);
}

const REPO_ROOT = findRepoRoot(HERE);
const GATE_MARKER = 'GATE_RAN';

/** 40 hex zeros — a SHA-1 repo's "no such object" sha. */
const ZERO_SHA_1 = '0'.repeat(40);
/** 64 hex zeros — the same thing under SHA-256. */
const ZERO_SHA_256 = '0'.repeat(64);
const SHA = 'abc123def4567890abc123def4567890abc123de';

/**
 * Run the real hook against a given stdin, with the gate replaced by a marker.
 * @param stdin - Lines in git's pre-push format (no trailing newline needed).
 * @returns Whether the hook would have run `check:all`.
 */
function gateRuns(stdin: string): boolean {
  const hook = readFileSync(join(REPO_ROOT, '.husky', 'pre-push'), 'utf8');
  const instrumented = hook.replace(/^npm run check:all$/m, `echo "${GATE_MARKER}"`);
  // The replacement must have applied — otherwise this test would silently
  // become a no-op that runs the real 4-minute gate, or reports nothing.
  expect(instrumented, 'hook no longer ends in `npm run check:all`').not.toBe(hook);

  // Passed to `sh -c` rather than written to a temp file, so nothing is left
  // on disk if an assertion throws.
  const run = spawnSync('sh', ['-c', instrumented], {
    input: stdin === '' ? '' : `${stdin}\n`,
    encoding: 'utf8',
  });
  expect(run.error, 'sh should be available').toBeUndefined();
  return run.stdout.includes(GATE_MARKER);
}

describe('pre-push gate — pushes that carry no new commits are skipped', () => {
  it('skips a branch deletion', () => {
    expect(gateRuns(`(delete) ${ZERO_SHA_1} refs/heads/x ${SHA}`)).toBe(false);
  });

  it('skips a deletion in a SHA-256 repository', () => {
    // The zero sha is 64 characters there. An earlier revision compared against
    // a hardcoded 40 zeros, which stopped matching — it failed safe (the gate
    // ran) but the fallback it claimed to provide did not exist.
    expect(gateRuns(`(delete) ${ZERO_SHA_256} refs/heads/x ${SHA}`)).toBe(false);
  });

  it('skips several deletions at once', () => {
    expect(
      gateRuns(
        `(delete) ${ZERO_SHA_1} refs/heads/x ${SHA}\n(delete) ${ZERO_SHA_1} refs/heads/y ${SHA}`,
      ),
    ).toBe(false);
  });

  it('skips a tag-only push', () => {
    expect(gateRuns(`refs/tags/v1.0.0 ${SHA} refs/tags/v1.0.0 ${ZERO_SHA_1}`)).toBe(false);
  });

  it('skips a deletion pushed alongside a tag', () => {
    expect(
      gateRuns(
        `(delete) ${ZERO_SHA_1} refs/heads/x ${SHA}\nrefs/tags/v1.0.0 ${SHA} refs/tags/v1.0.0 ${ZERO_SHA_1}`,
      ),
    ).toBe(false);
  });

  it('treats an all-zero local sha as a deletion even without the literal', () => {
    // Belt-and-braces path: `(delete)` is what git sends today, the zero sha is
    // what it means.
    expect(gateRuns(`refs/heads/x ${ZERO_SHA_1} refs/heads/x ${SHA}`)).toBe(false);
  });
});

describe('pre-push gate — everything else still runs the gate', () => {
  // This half is the point. A hook that skipped unconditionally would pass
  // every assertion above.
  it('runs for an ordinary branch push', () => {
    expect(gateRuns(`refs/heads/x ${SHA} refs/heads/x ${ZERO_SHA_1}`)).toBe(true);
  });

  it('runs when a real branch is pushed alongside a deletion', () => {
    expect(
      gateRuns(
        `(delete) ${ZERO_SHA_1} refs/heads/x ${SHA}\nrefs/heads/y ${SHA} refs/heads/y ${ZERO_SHA_1}`,
      ),
    ).toBe(true);
  });

  it('runs when a real branch is pushed alongside a tag', () => {
    expect(
      gateRuns(
        `refs/tags/v1.0.0 ${SHA} refs/tags/v1.0.0 ${ZERO_SHA_1}\nrefs/heads/y ${SHA} refs/heads/y ${ZERO_SHA_1}`,
      ),
    ).toBe(true);
  });

  it('runs when no refs arrive on stdin', () => {
    // An invocation shape the hook does not recognise. The safe default is to
    // check, not to skip.
    expect(gateRuns('')).toBe(true);
  });

  it('runs when the local sha is missing entirely', () => {
    expect(gateRuns(`refs/heads/x  refs/heads/x ${SHA}`)).toBe(true);
  });
});
