import { describe, expect, test } from 'vitest';

import {
  hashSessionId,
  mintVisitorCookie,
  verifyVisitorCookie,
} from '../../src/services/visitor-cookie.js';
import { ApiError } from '../../src/utils/api-error.js';

const SECRET = 'unit-test-cookie-secret';

describe('visitor-cookie signing (unit)', () => {
  test('a freshly minted cookie verifies back to its session id', () => {
    const { sessionId, cookieValue } = mintVisitorCookie(SECRET);
    expect(cookieValue).toContain('.');
    expect(verifyVisitorCookie(cookieValue, SECRET)).toBe(sessionId);
  });

  test('a tampered signature is rejected (401)', () => {
    const { sessionId, cookieValue } = mintVisitorCookie(SECRET);
    const forged = `${sessionId}.${'0'.repeat(cookieValue.split('.')[1]?.length ?? 64)}`;
    expect(forged).not.toBe(cookieValue);
    expect(() => verifyVisitorCookie(forged, SECRET)).toThrow(ApiError);
    try {
      verifyVisitorCookie(forged, SECRET);
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(401);
    }
  });

  test('a tampered session id (re-signed body no longer matches) is rejected', () => {
    const { sessionId, cookieValue } = mintVisitorCookie(SECRET);
    const sig = cookieValue.split('.')[1] ?? '';
    // Keep the original signature but swap the session id it was signed over.
    const swapped = `${sessionId.slice(0, -1)}${sessionId.endsWith('a') ? 'b' : 'a'}.${sig}`;
    expect(() => verifyVisitorCookie(swapped, SECRET)).toThrow(ApiError);
  });

  test('a cookie signed with a different secret does not verify', () => {
    const { cookieValue } = mintVisitorCookie(SECRET);
    expect(() => verifyVisitorCookie(cookieValue, 'a-different-secret')).toThrow(ApiError);
  });

  test('a structurally malformed cookie (no separator) is rejected', () => {
    expect(() => verifyVisitorCookie('no-separator-here', SECRET)).toThrow(ApiError);
  });

  test('an empty cookie value is rejected', () => {
    expect(() => verifyVisitorCookie('', SECRET)).toThrow(ApiError);
  });

  test('hashSessionId is deterministic and secret-dependent', () => {
    const { sessionId } = mintVisitorCookie(SECRET);
    expect(hashSessionId(sessionId, SECRET)).toBe(hashSessionId(sessionId, SECRET));
    expect(hashSessionId(sessionId, SECRET)).not.toBe(hashSessionId(sessionId, 'other'));
  });
});
