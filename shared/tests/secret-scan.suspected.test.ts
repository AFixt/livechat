/**
 * Fixture test for the `suspected` secret-scan tier (issue #82, AC#6).
 *
 * The suspected tier's whole value is being a future-failure guard: it must
 * actually surface a detector hit that verification can't confirm, WITHOUT
 * blocking (exit 0). This test exercises the real `scripts/secret-scan.sh`
 * against a throwaway git repo so a regression that silently no-ops the tier
 * (or turns it into a blocking gate) fails CI.
 *
 * It is deliberately hermetic: it copies the script into a scratch repo that
 * contains ONLY a synthetic, high-entropy, AWS-shaped fake credential (randomly
 * generated at run time — never a real secret), so the assertions never depend
 * on the livechat repo's own contents.
 *
 * trufflehog is an external binary; when it is absent the suite skips with a
 * clear message, mirroring the script's own fallback.
 */
/*
 * This is a shell-integration test: it spins up throwaway git repos on disk and
 * invokes a bash script, so synchronous fs/child_process and computed temp
 * paths are intentional. Those two rules are disabled for this file only.
 */
/* eslint-disable n/no-sync, security/detect-non-literal-fs-filename */
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Walk up from `start` until the directory holding `scripts/secret-scan.sh`. */
function findRepoRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, 'scripts', 'secret-scan.sh'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('could not locate scripts/secret-scan.sh from ' + start);
}

const REPO_ROOT = findRepoRoot(HERE);
const SCRIPT = join(REPO_ROOT, 'scripts', 'secret-scan.sh');

/** trufflehog is an optional external tool; skip cleanly when it is missing. */
function trufflehogAvailable(): boolean {
  const probe = spawnSync('trufflehog', ['--version'], { encoding: 'utf8' });
  return probe.status === 0 || probe.status === 1; // some versions exit 1 on --version
}

/** A random, high-entropy AWS access-key id — matches the AKIA shape, not real. */
function fakeAwsAccessKeyId(): string {
  // Built from char codes (A–Z) rather than a literal so the entropy scanner
  // doesn't flag the alphabet itself as a secret.
  const alphabet = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i)).join('');
  const raw = randomBytes(16);
  let body = '';
  for (const byte of raw) body += alphabet.charAt(byte % alphabet.length);
  return `AKIA${body}`;
}

/** A random, high-entropy 40-char AWS-secret-shaped string — not a real secret. */
function fakeAwsSecret(): string {
  return randomBytes(30).toString('base64').replace(/[^A-Za-z0-9]/g, 'A').slice(0, 40);
}

const scratchDirs: string[] = [];

/**
 * Build a throwaway git repo containing `files`, drop in the real script, run
 * the given tier, and return the combined output + exit status.
 */
function runTierAgainst(files: Record<string, string>, tier: string): { output: string; status: number | null } {
  const dir = mkdtempSync(join(tmpdir(), 'secret-scan-'));
  scratchDirs.push(dir);
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  copyFileSync(SCRIPT, join(dir, 'scripts', 'secret-scan.sh'));
  for (const [name, contents] of Object.entries(files)) writeFileSync(join(dir, name), contents);

  const gitEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  const git = (args: string[]): void => {
    execFileSync('git', args, { cwd: dir, env: gitEnv, stdio: 'ignore' });
  };
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'fixture@example.test']);
  git(['config', 'user.name', 'fixture']);
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'fixture']);

  const run = spawnSync('bash', [join(dir, 'scripts', 'secret-scan.sh'), tier], {
    cwd: dir,
    encoding: 'utf8',
  });
  return { output: [run.stdout, run.stderr].join(''), status: run.status };
}

afterAll(() => {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
});

const skip = !trufflehogAvailable();
if (skip) {
  console.warn('skip: trufflehog not installed — suspected-tier fixture test not run.');
}

describe.skipIf(skip)('secret-scan.sh suspected tier', () => {
  it('surfaces an unverified fake secret and still exits 0 (warn, not fail)', () => {
    const accessKey = fakeAwsAccessKeyId();
    const { output, status } = runTierAgainst(
      { 'config.txt': `aws_access_key_id = ${accessKey}\naws_secret_access_key = ${fakeAwsSecret()}\n` },
      'suspected',
    );
    // Warn tier must never block, even when it finds something.
    expect(status).toBe(0);
    // The finding must actually be surfaced (the tier is not a silent no-op).
    expect(output).toMatch(/Found (unverified|unknown) result/i);
    expect(output).toContain('Detector Type: AWS');
    // The exact synthetic key we planted was reported — proves discrimination.
    expect(output).toContain(accessKey);
    expect(output).toMatch(/"unverified_secrets": *1/);
  }, 60_000);

  it('reports no finding for clean input (and exits 0)', () => {
    const { output, status } = runTierAgainst(
      { 'readme.txt': 'just some ordinary prose with no credentials in it\n' },
      'suspected',
    );
    expect(status).toBe(0);
    expect(output).not.toMatch(/Found (unverified|unknown) result/i);
    expect(output).not.toContain('Detector Type:');
    expect(output).toMatch(/"unverified_secrets": *0/);
  }, 60_000);
});
