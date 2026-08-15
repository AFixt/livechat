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
// NOTE: rules 1 (chat-lookup) and 2 (tenant-owned) carry a `paths: include`
// restricted to api/src/io and api/src/routes; `semgrep --test` evaluates
// patterns against the fixture regardless of that production path filter, so
// the annotations below still exercise them.

import cors from 'cors';
import jwt from 'jsonwebtoken';
import { Server } from 'socket.io';

declare const app: { use: (m: unknown) => void };
declare const httpServer: unknown;
declare const req: { headers: { origin: string } };
declare const res: {
  cookie: (name: string, value: string, opts?: Record<string, unknown>) => void;
};
declare const token: string;
declare const secret: string;

// --- Rule 1: chat-lookup-must-go-through-scoped-service ----------------------
declare const Chat: { findByPk: (...a: unknown[]) => unknown; findOne: (...a: unknown[]) => unknown };
declare const ChatMessage: { findAll: (...a: unknown[]) => unknown };

// ruleid: chat-lookup-must-go-through-scoped-service
Chat.findByPk('some-id');
// ruleid: chat-lookup-must-go-through-scoped-service
ChatMessage.findAll({ where: { chatId: 'x' } });

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
app.use(cors({ origin: 'https://app.example.com', credentials: true }));

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
// ruleid: jwt-decode-instead-of-verify
jwt.decode(token);

// --- Rule 7: cookie-missing-httponly-secure ----------------------------------
// ruleid: cookie-missing-httponly-secure
res.cookie('sid', 'v');
// ruleid: cookie-missing-httponly-secure
res.cookie('sid', 'v', { sameSite: 'lax' });
// ruleid: cookie-missing-httponly-secure
res.cookie('sid', 'v', { httpOnly: true });
// ok: cookie-missing-httponly-secure
res.cookie('sid', 'v', { httpOnly: true, secure: true, sameSite: 'lax' });
