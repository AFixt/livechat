import { describe, expect, it } from 'vitest';

import { isWithinSupportHours, parseSupportHours } from './support-hours.js';

describe('parseSupportHours', () => {
  it('returns null for absent settings', () => {
    expect(parseSupportHours(undefined)).toBeNull();
    expect(parseSupportHours(null)).toBeNull();
  });

  it('returns null for a malformed schedule rather than throwing', () => {
    expect(parseSupportHours({ tz: 'UTC', days: { mon: [['9am', '5pm']] } })).toBeNull();
    expect(parseSupportHours({ days: {} })).toBeNull();
  });

  it('parses a valid schedule', () => {
    const hours = parseSupportHours({
      tz: 'UTC',
      days: { mon: [['09:00', '17:00']] },
      text: 'Mon 9-5',
    });
    expect(hours?.tz).toBe('UTC');
    expect(hours?.text).toBe('Mon 9-5');
  });
});

describe('isWithinSupportHours', () => {
  it('treats an unconfigured (null) schedule as always open', () => {
    expect(isWithinSupportHours(null, new Date('2026-01-01T03:00:00Z'))).toBe(true);
  });

  it('is within hours during an open window in the tenant timezone', () => {
    const hours = parseSupportHours({ tz: 'UTC', days: { thu: [['09:00', '17:00']] } });
    // 2026-01-01 is a Thursday. 12:00 UTC is inside 09:00-17:00.
    expect(isWithinSupportHours(hours, new Date('2026-01-01T12:00:00Z'))).toBe(true);
  });

  it('is outside hours before the window opens and after it closes', () => {
    const hours = parseSupportHours({ tz: 'UTC', days: { thu: [['09:00', '17:00']] } });
    expect(isWithinSupportHours(hours, new Date('2026-01-01T08:59:00Z'))).toBe(false);
    expect(isWithinSupportHours(hours, new Date('2026-01-01T17:00:00Z'))).toBe(false);
  });

  it('is closed on a day with no configured windows', () => {
    const hours = parseSupportHours({ tz: 'UTC', days: { mon: [['09:00', '17:00']] } });
    // Thursday has no windows.
    expect(isWithinSupportHours(hours, new Date('2026-01-01T12:00:00Z'))).toBe(false);
  });

  it('honours the tenant timezone when picking the local day/time', () => {
    // 2026-01-01T02:00:00Z is Wed 21:00 in New York (UTC-5), outside Thu hours.
    const hours = parseSupportHours({
      tz: 'America/New_York',
      days: { thu: [['09:00', '17:00']] },
    });
    expect(isWithinSupportHours(hours, new Date('2026-01-01T02:00:00Z'))).toBe(false);
    // 2026-01-01T18:00:00Z is Thu 13:00 in New York, inside the window.
    expect(isWithinSupportHours(hours, new Date('2026-01-01T18:00:00Z'))).toBe(true);
  });
});
