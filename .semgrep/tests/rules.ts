// Semgrep rule-test fixtures for .semgrep/rules.yml.
//
// Run: semgrep --test --config .semgrep/rules.yml .semgrep/tests/
//
// A "rule id" annotation on the line above a snippet asserts that rule MUST
// match; an "ok" annotation asserts it MUST NOT. This file is intentionally
// full of insecure snippets — it is EXCLUDED from the real gate in
// scripts/semgrep.sh (`--exclude='.semgrep'`) so these fixtures never fail the
// scan.
//
// NOTE: several rules carry a `paths: include` restricted to api/src/{io,routes,
// services} (rules 1, 2, 9). `semgrep --test` evaluates patterns against the
// fixture regardless of that production path filter, so the annotations below
// still exercise them. (On semgrep 1.157 `--test` itself crashes with an
// unrelated IndexError; verify by scanning this file with the path filters
// stripped and mapping findings to the annotations — see the PR description.)

import cors from 'cors';
import jwt from 'jsonwebtoken';
import { Server } from 'socket.io';

declare const app: { use: (m: unknown) => void };
declare const httpServer: unknown;
declare const req: { headers: { origin: string }; body: { url: string } };
declare const res: {
  cookie: (name: string, value: string, opts?: Record<string, unknown>) => void;
};
declare const token: string;
declare const secret: string;
declare const env: { APP_URL: string; WIDGET_ORIGIN: string };
declare const allow: string[];

// --- Rule 1: chat-lookup-must-go-through-scoped-service ----------------------
declare const Chat: {
  findByPk: (...a: unknown[]) => unknown;
  findOne: (...a: unknown[]) => unknown;
};
declare const ChatMessage: { findAll: (...a: unknown[]) => unknown };
declare const chatService: { getChatForVisitor: (...a: unknown[]) => unknown };

// ruleid: chat-lookup-must-go-through-scoped-service
Chat.findByPk('some-id');
// ruleid: chat-lookup-must-go-through-scoped-service
ChatMessage.findAll({ where: { chatId: 'x' } });
// ok: chat-lookup-must-go-through-scoped-service
chatService.getChatForVisitor('some-id', 'visitor-id');

// --- Rule 2: tenant-owned-lookup-needs-scope ---------------------------------
declare const VisitorSession: {
  findByPk: (...a: unknown[]) => unknown;
  findOne: (...a: unknown[]) => unknown;
};

// ruleid: tenant-owned-lookup-needs-scope
VisitorSession.findByPk('id');
// ruleid: tenant-owned-lookup-needs-scope
VisitorSession.findOne({ where: { id: 'id' } });
// ok: tenant-owned-lookup-needs-scope
VisitorSession.findOne({ where: { tenantId: 't', id: 'id' } });

// --- Rule 3: cors-permissive-origin ------------------------------------------
// ruleid: cors-permissive-origin
app.use(cors({ origin: true, credentials: true }));
// ruleid: cors-permissive-origin
app.use(cors({ origin: '*' }));
// ruleid: cors-permissive-origin
new Server(httpServer, { cors: { origin: true, credentials: true } });
// ok: cors-permissive-origin
app.use(cors({ origin: 'https://app.example.com' }));

// --- Rule 4: cors-reflects-request-origin ------------------------------------
// ruleid: cors-reflects-request-origin
app.use(cors({ origin: req.headers.origin, credentials: true }));
app.use(
  cors({
    origin: (reqOrigin: string, cb: (e: unknown, ok: unknown) => void) => {
      // ruleid: cors-reflects-request-origin
      cb(null, reqOrigin);
    },
  }),
);
// ok: cors-reflects-request-origin
app.use(cors({ origin: 'https://app.example.com' }));

// --- Rule 5: jwt-verify-without-algorithm-pin --------------------------------
// ruleid: jwt-verify-without-algorithm-pin
jwt.verify(token, secret);
// ruleid: jwt-verify-without-algorithm-pin
jwt.verify(token, secret, { audience: 'x' });
// ok: jwt-verify-without-algorithm-pin
jwt.verify(token, secret, { algorithms: ['HS256'] });

// --- Rule 6: jwt-decode-instead-of-verify ------------------------------------
declare const base64url: { decode: (v: string) => string };

// ruleid: jwt-decode-instead-of-verify
jwt.decode(token);
// ok: jwt-decode-instead-of-verify — a non-jwt `.decode()` must not trip.
base64url.decode(token);

// --- Rule 7: cookie-missing-httponly-secure ----------------------------------
// ruleid: cookie-missing-httponly-secure
res.cookie('sid', 'v');
// ruleid: cookie-missing-httponly-secure
res.cookie('sid', 'v', { sameSite: 'lax' });
// ruleid: cookie-missing-httponly-secure
res.cookie('sid', 'v', { httpOnly: true });
// ok: cookie-missing-httponly-secure
res.cookie('sid', 'v', { httpOnly: true, secure: true, sameSite: 'lax' });

// --- Rule 8: cors-credentialed-fixed-origin ----------------------------------
// ruleid: cors-credentialed-fixed-origin
app.use(cors({ origin: 'https://fixed.example.com', credentials: true }));
// ruleid: cors-credentialed-fixed-origin
app.use(cors({ origin: env.WIDGET_ORIGIN, credentials: true }));
// ruleid: cors-credentialed-fixed-origin
new Server(httpServer, { cors: { origin: 'https://fixed.example.com', credentials: true } });
// ok: cors-credentialed-fixed-origin — sanctioned console origin (#74 carve-out).
app.use(cors({ origin: env.APP_URL, credentials: true }));
// ok: cors-credentialed-fixed-origin — socket console origin (#74 carve-out).
new Server(httpServer, { cors: { origin: env.APP_URL, credentials: true } });
// ok: cors-credentialed-fixed-origin — per-tenant delegate callback.
app.use(
  cors({
    origin: (o: string, cb: (e: unknown, ok: boolean) => void) => {
      cb(null, allow.includes(o));
    },
    credentials: true,
  }),
);
// ok: cors-credentialed-fixed-origin — explicit array allowlist.
app.use(cors({ origin: ['https://a.example.com', 'https://b.example.com'], credentials: true }));

// --- Rule 9: raw-sql-string-interpolation ------------------------------------
declare const sequelize: { query: (...a: unknown[]) => unknown };
const userId = 'u';

// ruleid: raw-sql-string-interpolation
sequelize.query(`SELECT * FROM users WHERE id = ${userId}`);
// ruleid: raw-sql-string-interpolation
sequelize.query('SELECT * FROM users WHERE id = ' + userId);
// ok: raw-sql-string-interpolation — parameterized.
sequelize.query('SELECT * FROM users WHERE id = :id', { replacements: { id: userId } });

// --- Rule 10: child-process-command-injection --------------------------------
declare const cp: { exec: (...a: unknown[]) => unknown; execSync: (...a: unknown[]) => unknown };
declare function execFile(file: string, args: string[]): void;
const dir = 'd';

// ruleid: child-process-command-injection
cp.exec(`ls ${dir}`);
// ruleid: child-process-command-injection
cp.execSync(`rm -rf ${dir}`);
// ok: child-process-command-injection — argument array, no shell.
execFile('ls', [dir]);

// --- Rule 11: outbound-fetch-user-input-ssrf ---------------------------------
const ALLOWED_BASE = 'https://api.internal';

// ruleid: outbound-fetch-user-input-ssrf
void fetch(req.body.url);
// ok: outbound-fetch-user-input-ssrf — fixed base, not the raw request value.
void fetch(ALLOWED_BASE + '/health');

// --- Rule 12: unsafe-dynamic-code-execution ----------------------------------
// ruleid: unsafe-dynamic-code-execution
eval(userId);
// ruleid: unsafe-dynamic-code-execution
const fn = new Function('return 1');
// ok: unsafe-dynamic-code-execution — JSON parsing, not code execution.
JSON.parse(userId);
void fn;
