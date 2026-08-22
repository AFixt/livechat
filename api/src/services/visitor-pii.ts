/**
 * The visitor-session columns that hold personal data.
 *
 * Shared by the scheduled retention sweep (#57) and on-demand data-subject
 * erasure (#121) so the two cannot drift: a new PII column added to
 * `visitor_sessions` and forgotten in one of them would leave data behind on
 * exactly the path a regulator asks about.
 */
export const VISITOR_PII_COLUMNS = [
  'ipAddress',
  'userAgent',
  'country',
  'city',
  'currentUrl',
  'referrer',
  'identityTokenSub',
] as const;

/** A visitor-session PII column name. */
export type VisitorPiiColumn = (typeof VISITOR_PII_COLUMNS)[number];

/**
 * The update payload that clears every PII column, keeping the row so chat
 * transcripts stay referentially intact.
 * @returns An object mapping every PII column to null.
 */
export function visitorPiiNulls(): Record<VisitorPiiColumn, null> {
  return Object.fromEntries(VISITOR_PII_COLUMNS.map((c) => [c, null])) as Record<
    VisitorPiiColumn,
    null
  >;
}
