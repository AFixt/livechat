import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';

import { detach } from './detach.js';

import type { Logger } from 'pino';

/**
 * A logger that records `error` calls instead of writing them.
 * @returns The stub logger and the recorded calls.
 */
function stubLogger(): { logger: Logger; errors: { err: unknown; msg: string }[] } {
  const errors: { err: unknown; msg: string }[] = [];
  const base = pino({ level: 'silent' });
  const logger = Object.create(base) as Logger;
  logger.error = ((obj: { err: unknown }, msg: string) => {
    errors.push({ err: obj.err, msg });
  }) as Logger['error'];
  return { logger, errors };
}

const boom = new Error('redis went away');

/** Work that fails, as a rejected promise. */
const failing = (): Promise<never> => Promise.reject(boom);

describe('detach', () => {
  it('runs the work and reports nothing when it resolves', async () => {
    const { logger, errors } = stubLogger();
    const run = vi.fn((): Promise<string> => Promise.resolve('ok'));
    detach(logger, 'should not appear', run);
    await vi.waitFor(() => {
      expect(run).toHaveBeenCalledTimes(1);
    });
    expect(errors).toEqual([]);
  });

  it('logs the rejection instead of leaving it unhandled', async () => {
    const { logger, errors } = stubLogger();
    detach(logger, 'presence update failed', failing);
    await vi.waitFor(() => {
      expect(errors).toHaveLength(1);
    });
    expect(errors[0]?.err).toBe(boom);
    expect(errors[0]?.msg).toBe('presence update failed');
  });

  it('does not rethrow, so a failing handler cannot reject its caller', () => {
    const { logger } = stubLogger();
    expect(() => {
      detach(logger, 'swallowed', failing);
    }).not.toThrow();
  });
});
