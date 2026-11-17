/**
 * Guard for `scripts/zap-baseline.sh`, the local equivalent of the `zap-pr`
 * job in `.github/workflows/zap.yml` (#205).
 *
 * The script exists so the DAST scan can run without GitHub Actions. Two ways
 * it could quietly stop meaning that: it drifts from the job (a different
 * nginx image, rules file or ZAP options, so a local green no longer predicts
 * the job), or it stops being able to fail (exit status swallowed, or a
 * missing Docker reported as a pass where nobody is watching). These cases run
 * the real script with a stubbed `docker` on PATH that records every call, and
 * read the workflow for the parity checks. The real scan was proven against
 * the shipped config separately (green, and red through rule 10020 with the
 * clickjacking headers removed): see docs/security/zap.md.
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
const SCRIPT = 'scripts/zap-baseline.sh';
const RULES = '.github/zap/rules.tsv';
const WORKFLOW = '.github/workflows/zap.yml';

/**
 * Walk up from `start` until the directory holding the script.
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

/** Stub docker: log each call, then answer per the STUB_* variables. */
const DOCKER_STUB = [
  '#!/usr/bin/env bash',
  'echo "$*" >> "$DOCKER_LOG"',
  'case "$1" in',
  '  info) exit "${STUB_DOCKER_INFO_EXIT:-0}" ;;',
  '  run)',
  '    for arg in "$@"; do',
  '      if [ "$arg" = zap-baseline.py ]; then exit "${STUB_ZAP_EXIT:-0}"; fi',
  '    done',
  '    echo stub-container-id ;;',
  'esac',
  'exit 0',
  '',
].join('\n');

/**
 * Build a throwaway repo holding the real script and rules file, a minimal
 * ui/ (nginx config and a built index.html), and the docker stub.
 * @returns The fixture directory.
 */
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'zap-baseline-'));
  scratchDirs.push(root);
  for (const dir of ['scripts', '.github/zap', 'ui/dist', 'stub']) {
    mkdirSync(join(root, dir), { recursive: true });
  }
  copyFileSync(join(REPO_ROOT, SCRIPT), join(root, SCRIPT));
  copyFileSync(join(REPO_ROOT, RULES), join(root, RULES));
  writeFileSync(join(root, 'ui/nginx.conf'), 'server { listen 80; }\n');
  writeFileSync(join(root, 'ui/dist/index.html'), '<!doctype html>\n');
  writeFileSync(join(root, 'stub/docker'), DOCKER_STUB, { mode: 0o755 });
  return root;
}

/**
 * Run the real script inside a fixture.
 * @param root - Fixture directory.
 * @param env - Extra environment for this case.
 * @returns Exit status, combined output, and the docker calls in order.
 */
function runScript(
  root: string,
  env: Record<string, string>,
): { status: number | null; output: string; calls: string[] } {
  const log = join(root, 'docker.log');
  const baseEnv: Record<string, string | undefined> = { ...process.env };
  // The skip-versus-fail decision keys on CI; each case sets it explicitly.
  delete baseEnv['CI'];
  const run = spawnSync('bash', [SCRIPT], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...baseEnv,
      PATH: `${join(root, 'stub')}:${process.env['PATH'] ?? ''}`,
      DOCKER_LOG: log,
      ZAP_REPORT_DIR: join(root, 'reports'),
      ...env,
    },
  });
  const calls = existsSync(log)
    ? readFileSync(log, 'utf8')
        .split('\n')
        .filter((line) => line !== '')
    : [];
  return { status: run.status, output: [run.stdout, run.stderr].join(''), calls };
}

/**
 * The single docker call that ran ZAP.
 * @param calls - Recorded docker calls.
 * @returns That call's argument string.
 */
function zapCall(calls: string[]): string {
  const found = calls.filter((call) => call.includes('zap-baseline.py'));
  expect(found).toHaveLength(1);
  return found[0] ?? '';
}

describe('zap-baseline.sh (#205)', () => {
  it('serves the build through the shipped nginx config and scans it with the job options', () => {
    const root = fixture();
    const { status, calls } = runScript(root, { ZAP_SKIP_BUILD: '1' });

    expect(status).toBe(0);
    const nginx = calls.find((call) => call.startsWith('run -d'));
    expect(nginx).toBeDefined();
    expect(nginx).toContain(`${root}/ui/nginx.conf:/etc/nginx/conf.d/default.conf:ro`);
    expect(nginx).toContain(`${root}/ui/dist:/usr/share/nginx/html:ro`);
    expect(nginx).toContain('nginx:1.27-alpine');

    // ZAP must reach nginx: same network, target is the nginx container.
    const network = /--network (livechat-zap-\S+)/u.exec(nginx ?? '')?.[1];
    const container = /--name (livechat-zap-ui-\S+)/u.exec(nginx ?? '')?.[1];
    const zap = zapCall(calls);
    expect(zap).toContain(`--network ${String(network)}`);
    expect(zap).toContain(`-t http://${String(container)} -c rules.tsv -a -j -I`);

    // Nothing left behind: the container and network are removed.
    expect(calls).toContain(`rm -f ${String(container)}`);
    expect(calls).toContain(`network rm ${String(network)}`);
  });

  it('fails when a FAIL-tier rule fires, so the gate can go red', () => {
    const root = fixture();
    const { status, output, calls } = runScript(root, { ZAP_SKIP_BUILD: '1', STUB_ZAP_EXIT: '1' });

    expect(status).toBe(1);
    expect(output).toContain('ZAP exited 1');
    // Cleanup still runs on the failing path.
    expect(calls.some((call) => call.startsWith('rm -f livechat-zap-ui-'))).toBe(true);
  });

  it('scans ZAP_TARGET_URL directly, with no nginx and no network', () => {
    const root = fixture();
    const { status, calls } = runScript(root, { ZAP_TARGET_URL: 'https://staging.example.com' });

    expect(status).toBe(0);
    expect(calls.some((call) => call.startsWith('run -d'))).toBe(false);
    expect(calls.some((call) => call.startsWith('network'))).toBe(false);
    expect(zapCall(calls)).toContain('-t https://staging.example.com -c rules.tsv -a -j -I');
  });

  it('refuses to scan a missing build rather than scanning nothing', () => {
    const root = fixture();
    rmSync(join(root, 'ui/dist/index.html'));
    const { status, output, calls } = runScript(root, { ZAP_SKIP_BUILD: '1' });

    expect(status).toBe(1);
    expect(output).toContain('ui/dist/index.html not found');
    expect(calls.some((call) => call.includes('zap-baseline.py'))).toBe(false);
  });

  it('skips without Docker locally, but fails under CI', () => {
    const local = runScript(fixture(), { STUB_DOCKER_INFO_EXIT: '1' });
    expect(local.status).toBe(0);
    expect(local.output).toContain('skip: docker not available');

    const ci = runScript(fixture(), { STUB_DOCKER_INFO_EXIT: '1', CI: 'true' });
    expect(ci.status).toBe(1);
    expect(ci.output).toContain('CI is set');
  });

  it('matches the zap-pr job: nginx image, rules file and ZAP options', () => {
    // A local green only predicts the job if they scan the same way.
    const workflow = readFileSync(join(REPO_ROOT, WORKFLOW), 'utf8');
    const script = readFileSync(join(REPO_ROOT, SCRIPT), 'utf8');

    expect(workflow).toContain('nginx:1.27-alpine');
    expect(script).toContain('NGINX_IMAGE="${ZAP_NGINX_IMAGE:-nginx:1.27-alpine}"');
    expect(workflow).toContain(`rules_file_name: ${RULES}`);
    expect(script).toContain(`RULES_FILE="$ROOT/${RULES}"`);
    expect(workflow).toContain('cmd_options: "-a -j -I"');
    expect(script).toContain('ZAP_OPTIONS=(-a -j -I)');
  });
});
