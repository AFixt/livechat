/**
 * Guard for the guard: proves an unreachable integration stack can never read
 * as a pass (#170).
 *
 * Before this existed, every integration test opened with
 * `if (harness === null) return;` — with MySQL/Redis down the whole suite
 * reported ✓ passed in 0–1 ms, indistinguishable from a real run. The fix
 * (`tests/integration/setup.ts`) probes the stack once at module load: down
 * means the file fails loudly, unless `INTEGRATION_DB_OPTIONAL=1` explicitly
 * requested running without it, in which case `describe.skipIf` reports the
 * tests as *skipped*.
 *
 * A gate like that is only trustworthy if it is exercised in the state it
 * exists to catch (cf. `shared/tests/generated-specs-gate.test.ts`), so this
 * runs a real integration file in a child vitest pointed at ports where
 * nothing listens, and asserts both arms: failure by default, visible skips
 * under the opt-out — and never a pass.
 */
/* eslint-disable n/no-sync */
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const API_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The child target: the smallest integration file, so each spawn pays for one
 * app import, not the suite.
 */
const TARGET = 'tests/integration/cors.test.ts';

/**
 * Run TARGET in a child vitest against ports where nothing listens.
 * @param extraEnv - Env overrides for the child (the opt-out flag).
 * @returns The completed child process result.
 */
function runAgainstDeadStack(extraEnv: Record<string, string>): SpawnSyncReturns<string> {
  return spawnSync('npx', ['vitest', 'run', TARGET], {
    cwd: API_ROOT,
    encoding: 'utf8',
    timeout: 120_000,
    env: {
      ...process.env,
      // TCP port 1 on localhost: connection refused immediately, nothing to
      // wait out. Chosen over a fake host so DNS cannot slow the probe down.
      DB_HOST: '127.0.0.1',
      DB_PORT: '1',
      REDIS_HOST: '127.0.0.1',
      REDIS_PORT: '1',
      ...extraEnv,
    },
  });
}

describe('integration availability gate (#170)', () => {
  it('fails loudly by default when the stack is unreachable', () => {
    const result = runAgainstDeadStack({ INTEGRATION_DB_OPTIONAL: '' });
    const output = result.stdout + result.stderr;

    expect(result.status, `child vitest passed against a dead stack:\n${output}`).not.toBe(0);
    // The failure must carry operator guidance, not a bare connection error.
    expect(output).toContain('Integration stack unreachable');
    expect(output).toContain('docker compose up -d mysql redis');
    // And it must be a failure, never a green run that asserted nothing.
    expect(output).not.toMatch(/\d+ passed/);
  }, 120_000);

  it('reports tests as skipped — never passed — under INTEGRATION_DB_OPTIONAL=1', () => {
    const result = runAgainstDeadStack({ INTEGRATION_DB_OPTIONAL: '1' });
    const output = result.stdout + result.stderr;

    expect(result.status, `opt-out run did not exit cleanly:\n${output}`).toBe(0);
    expect(output).toMatch(/skipped/);
    expect(output).not.toMatch(/\d+ passed/);
  }, 120_000);
});
