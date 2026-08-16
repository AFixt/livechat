/* eslint-disable n/no-sync, security/detect-non-literal-fs-filename, security/detect-unsafe-regex -- build-time meta-test that scans this repo's own widget source tree; inputs and patterns are trusted static values, not user data */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SRC_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * Source extensions that ship in the widget bundle. Test files are excluded —
 * they legitimately contain URL literals (like this one).
 */
const SCANNED = /\.(ts|tsx|css)$/;
const IS_TEST = /\.test\.(ts|tsx)$/;

/**
 * Absolute `http(s)://` URLs — simple, linear-time (no nested quantifiers).
 *
 * Limitation: protocol-relative origins (`//host/…`) are NOT matched here,
 * because `//` is also the JS line-comment marker and a structural match would
 * false-positive on ordinary comments. Such a host is still caught if it is in
 * {@link BANNED_HOSTS}; a novel protocol-relative tracker host would slip past
 * this scan. The bundle is same-origin-only, so this is an accepted gap.
 */
const ABSOLUTE_URL = /https?:\/\/[^\s"'`)]+/gi;
/** Local dev hosts that are allowed to appear (never shipped to visitors). */
const LOCAL_HOST = /^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?/i;

/** Known third-party tracker / font / analytics hosts that must never appear. */
const BANNED_HOSTS = [
  'google-analytics.com',
  'googletagmanager.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'doubleclick.net',
  'facebook.net',
  'connect.facebook',
  'segment.com',
  'segment.io',
  'mixpanel.com',
  'hotjar.com',
  'sentry.io',
  'cdn.jsdelivr.net',
  'unpkg.com',
];

/**
 * Recursively list scanned, non-test source files under the widget `src` tree.
 * @param dir - Directory to walk.
 * @returns Absolute file paths.
 */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (SCANNED.test(entry.name) && !IS_TEST.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe('widget references no third-party origins', () => {
  const files = sourceFiles(SRC_DIR);

  it('finds source files to scan', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('contains no absolute external origins', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(ABSOLUTE_URL)) {
        if (!LOCAL_HOST.test(match[0])) {
          offenders.push(`${file.replace(SRC_DIR, 'src')}: ${match[0]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('references no known tracker, analytics, or third-party font hosts', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8').toLowerCase();
      for (const host of BANNED_HOSTS) {
        if (text.includes(host)) offenders.push(`${file.replace(SRC_DIR, 'src')}: ${host}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
