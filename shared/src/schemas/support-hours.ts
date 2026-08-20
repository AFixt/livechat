import { z } from 'zod';

/**
 * Explicit staff availability status. Availability is a per-user choice that
 * persists across reconnects/reloads — it is no longer a side effect of
 * having a socket open. New users default to `away` and opt in to
 * `available`.
 */
export const availabilityStatusSchema = z.enum(['available', 'away']);
/**
 * Availability status value.
 */
export type AvailabilityStatus = z.infer<typeof availabilityStatusSchema>;

/**
 * A single `HH:MM`-`HH:MM` open window in 24-hour local time.
 */
export const supportHoursWindowSchema = z
  .tuple([
    z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:MM'),
    z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:MM'),
  ])
  .describe('An [open, close] window in 24-hour HH:MM local time.');
/**
 * One open window: `["09:00", "17:00"]`.
 */
export type SupportHoursWindow = z.infer<typeof supportHoursWindowSchema>;

/**
 * Weekday keys used by the support-hours schedule.
 */
export const supportHoursDayKeys = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

/**
 * Per-tenant weekly support-hours schedule, stored under
 * `Tenant.settings.supportHours`. Each weekday maps to zero or more open
 * windows; a day with no windows (or omitted) is closed. `tz` is an IANA
 * timezone the windows are interpreted in. When the whole object is absent,
 * support is treated as always open (24/7) so availability depends solely on
 * whether an agent is explicitly available.
 */
export const supportHoursSchema = z.object({
  tz: z.string().min(1).max(64),
  days: z.partialRecord(z.enum(supportHoursDayKeys), z.array(supportHoursWindowSchema)),
  /** Optional human-readable string surfaced to the widget's no-support state. */
  text: z.string().max(200).optional(),
});
/**
 * Weekly support-hours schedule.
 */
export type SupportHours = z.infer<typeof supportHoursSchema>;
