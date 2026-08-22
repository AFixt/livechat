#!/usr/bin/env node
//
// Static-host security-header gate (issue #61).
//
// Tradeoff — this is a CONFIG LINT, not a live probe. Booting nginx with the
// built assets inside CI is impractical (it needs a full Docker build first),
// so instead of curling running servers this parses ui/nginx.conf and
// widget/nginx.conf and asserts that every required security header is present,
// with the expected value, in every block that emits headers.
//
// Why "every block": nginx's `add_header` does not merge. A `location` block
// that sets any `add_header` inherits NONE of the server-level ones (the exact
// footgun called out in scripts/semgrep.sh). So the rule enforced here is:
//   - the server block must declare the full required set, AND
//   - any location block that declares an add_header must repeat the full set.
// A location with no add_header at all correctly inherits and is left alone.
//
// Run: `npm run security:headers`. Sets a non-zero exit code (and prints every
// drift) if any required directive is missing or wrong.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const CONSOLE_CSP =
  "Content-Security-Policy \"default-src 'self'; base-uri 'self'; object-src 'none'; " +
  "frame-ancestors 'none'; form-action 'self'; script-src 'self'; " +
  "style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; " +
  "connect-src 'self' https://api.livechat.afixt.com wss://api.livechat.afixt.com\"";

const WIDGET_CSP =
  "Content-Security-Policy \"default-src 'self'; base-uri 'self'; object-src 'none'; " +
  "frame-ancestors *; form-action 'self'; script-src 'self'; " +
  "style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; " +
  "connect-src 'self' https://api.livechat.afixt.com wss://api.livechat.afixt.com\"";

const HSTS = 'Strict-Transport-Security "max-age=63072000; includeSubDomains; preload"';

/** @type {{ file: string, label: string, required: string[], forbidden: string[] }[]} */
const HOSTS = [
  {
    file: 'ui/nginx.conf',
    label: 'console (ui)',
    required: [
      CONSOLE_CSP,
      'Cross-Origin-Opener-Policy "same-origin"',
      'Cross-Origin-Resource-Policy "same-origin"',
      // Console only. Cross-origin isolation; it loads no cross-origin
      // subresources, so require-corp costs nothing here (ADR-0012, #131).
      'Cross-Origin-Embedder-Policy "require-corp"',
      HSTS,
      'X-Content-Type-Options "nosniff"',
      'X-Frame-Options "DENY"',
      'Referrer-Policy "strict-origin-when-cross-origin"',
    ],
    // The console must never be framable.
    forbidden: ['frame-ancestors *', 'Cross-Origin-Resource-Policy "cross-origin"'],
  },
  {
    file: 'widget/nginx.conf',
    label: 'widget',
    required: [
      WIDGET_CSP,
      'Cross-Origin-Opener-Policy "same-origin"',
      'Cross-Origin-Resource-Policy "cross-origin"',
      HSTS,
      'Access-Control-Allow-Origin "*"',
      'X-Content-Type-Options "nosniff"',
      'Referrer-Policy "strict-origin-when-cross-origin"',
    ],
    // The widget must stay embeddable — no frame busting.
    // COEP is deliberately absent on the widget: it is embedded *into* customer
    // pages, so COEP on its responses would govern the host page's context
    // rather than protect the widget, and CORP `cross-origin` is what makes the
    // embed work (ADR-0012, #131).
    forbidden: ['X-Frame-Options', "frame-ancestors 'none'", 'Cross-Origin-Embedder-Policy'],
  },
];

/**
 * Drop full-line `#` comments so prose like "every location below" is not
 * mistaken for a `location` directive during brace matching.
 * @param {string} text - Full nginx config source.
 * @returns {string} Source with comment-only lines removed.
 */
function stripComments(text) {
  return text
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
}

/**
 * Index of the `}` that closes the `{` at `openIndex`.
 * @param {string} text - Source text.
 * @param {number} openIndex - Index of the opening brace.
 * @returns {number} Index of the matching closing brace.
 */
function matchBrace(text, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '{') depth += 1;
    else if (ch === '}' && (depth -= 1) === 0) return i;
  }
  throw new Error('unbalanced braces in nginx config');
}

/**
 * Body of the first `server { ... }` block (braces excluded).
 * @param {string} text - Comment-stripped nginx source.
 * @returns {string} The server block body.
 */
function serverBlock(text) {
  const open = text.indexOf('{', text.indexOf('server'));
  return text.slice(open + 1, matchBrace(text, open));
}

/**
 * Split a server body into its own directives (location blocks removed) plus
 * the body of each nested location block.
 * @param {string} body - The server block body.
 * @returns {{ own: string, locations: string[] }} Server-own text and locations.
 */
function splitLocations(body) {
  const locations = [];
  let own = '';
  let i = 0;
  while (i < body.length) {
    if (!body.startsWith('location', i)) {
      own += body[i];
      i += 1;
      continue;
    }
    const open = body.indexOf('{', i);
    const close = matchBrace(body, open);
    locations.push(body.slice(open + 1, close));
    i = close + 1;
  }
  return { own, locations };
}

/**
 * Blocks that actually emit headers: the server-own directives plus every
 * location that sets at least one add_header (those inherit nothing).
 * @param {string} body - The server block body.
 * @returns {{ name: string, text: string }[]} Emitting blocks.
 */
function emittingBlocks(body) {
  const { own, locations } = splitLocations(body);
  const blocks = [{ name: 'server block', text: own }];
  locations.forEach((loc, idx) => {
    if (loc.includes('add_header')) {
      blocks.push({ name: `location #${String(idx + 1)}`, text: loc });
    }
  });
  return blocks;
}

const failures = [];

/**
 * Check one host's config and record any drift.
 * @param {{ file: string, label: string, required: string[], forbidden: string[] }} host - Host spec.
 * @returns {void}
 */
function checkHost(host) {
  console.log(`\nChecking ${host.label} — ${host.file}`);
  // Path is a hardcoded literal from HOSTS, never user input.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const body = serverBlock(stripComments(readFileSync(resolve(repoRoot, host.file), 'utf8')));
  const before = failures.length;

  for (const block of emittingBlocks(body)) {
    for (const directive of host.required) {
      if (!block.text.includes(directive)) {
        failures.push(`${host.file} ${block.name}: missing \`add_header ${directive}\``);
      }
    }
  }
  for (const bad of host.forbidden) {
    if (body.includes(bad)) failures.push(`${host.file}: must not contain \`${bad}\``);
  }

  if (failures.length === before) {
    console.log('  ✓ all required headers present in every emitting block');
  }
}

HOSTS.forEach(checkHost);

if (failures.length > 0) {
  console.error('');
  for (const message of failures) console.error(`  ✗ ${message}`);
  console.error(`\n${String(failures.length)} header check failure(s).`);
  process.exitCode = 1;
} else {
  console.log('\nAll static-host security headers present.');
}
