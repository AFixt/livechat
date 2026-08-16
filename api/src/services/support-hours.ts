import { supportHoursSchema, supportHoursDayKeys, type SupportHours } from '@livechat/shared';

/**
 * Parse a raw `Tenant.settings.supportHours` value into a validated
 * {@link SupportHours}, or `null` when it is absent/malformed. Malformed
 * schedules are treated as "unconfigured" (always open) rather than throwing,
 * so a bad settings blob can never take support offline.
 * @param raw - The raw JSON value from `tenant.settings.supportHours`.
 * @returns The parsed schedule, or `null` when unconfigured/invalid.
 */
export function parseSupportHours(raw: unknown): SupportHours | null {
  if (raw === undefined || raw === null) return null;
  const result = supportHoursSchema.safeParse(raw);
  return result.success ? result.data : null;
}

/**
 * Minutes-since-midnight for an `HH:MM` string.
 * @param hhmm - Time in 24-hour `HH:MM`.
 * @returns Minutes since midnight.
 */
function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
}

/**
 * Extract the tenant-local weekday key and minutes-since-midnight for an
 * instant, using the schedule's IANA timezone.
 * @param hours - The support-hours schedule (for its `tz`).
 * @param now - The instant to evaluate.
 * @returns The lowercase weekday key and minutes since local midnight.
 */
function localDayAndMinutes(hours: SupportHours, now: Date): { day: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: hours.tz,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const lookup = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  const day = lookup('weekday').toLowerCase().slice(0, 3);
  // `hour` can render as "24" at midnight in some runtimes; normalise to 0.
  const hour = Number(lookup('hour')) % 24;
  const minutes = hour * 60 + Number(lookup('minute'));
  return { day, minutes };
}

/**
 * Is the given instant inside the tenant's configured support hours? When
 * `hours` is `null` (unconfigured) support is always open, so this returns
 * `true`.
 * @param hours - The parsed schedule, or `null` for 24/7.
 * @param now - The instant to test (defaults to `new Date()`).
 * @returns Whether support is currently within hours.
 */
export function isWithinSupportHours(hours: SupportHours | null, now: Date = new Date()): boolean {
  if (hours === null) return true;
  const { day, minutes } = localDayAndMinutes(hours, now);
  if (!(supportHoursDayKeys as readonly string[]).includes(day)) return false;
  const windows = hours.days[day as (typeof supportHoursDayKeys)[number]] ?? [];
  return windows.some(([open, close]) => {
    const openMin = toMinutes(open);
    const closeMin = toMinutes(close);
    return minutes >= openMin && minutes < closeMin;
  });
}
