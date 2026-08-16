/**
 * PII-minimization helpers applied at the point visitor data is captured.
 *
 * Truncating the IP address and coarsening geolocation to country level keeps
 * the data useful for abuse handling and geo routing while shrinking the
 * personal data the service retains. Applied in
 * {@link ../services/visitor-session-service} and specified in
 * `docs/adr/0011-geo-retention-minimization.md`.
 *
 * @module
 */

/**
 * True when `value` is a syntactically valid dotted-quad IPv4 address.
 * @param value - Candidate string.
 * @returns Whether every octet is a 0–255 integer.
 */
function isIpv4(value: string): boolean {
  const octets = value.split('.');
  if (octets.length !== 4) return false;
  return octets.every((octet) => {
    if (!/^\d{1,3}$/.test(octet)) return false;
    const n = Number(octet);
    return n >= 0 && n <= 255;
  });
}

/**
 * Zero the final octet of a dotted-quad IPv4 address.
 * @param value - A validated IPv4 address.
 * @returns The address with its host octet set to `0` (e.g. `203.0.113.0`).
 */
function truncateIpv4(value: string): string {
  const octets = value.split('.');
  return `${octets[0] ?? '0'}.${octets[1] ?? '0'}.${octets[2] ?? '0'}.0`;
}

/**
 * True when `value` is a single valid IPv6 hextet: one to four hex digits.
 * @param value - Candidate group.
 * @returns Whether the group is a syntactically valid 16-bit hextet.
 */
function isHextet(value: string): boolean {
  return /^[0-9a-f]{1,4}$/i.test(value);
}

/**
 * Split one side of a `::`-separated IPv6 address into its colon-separated
 * groups; an empty side yields no groups.
 * @param half - The head or tail substring (may be undefined/empty).
 * @returns The group strings on that side.
 */
function splitHextetGroups(half: string | undefined): string[] {
  const raw = half ?? '';
  return raw === '' ? [] : raw.split(':');
}

/**
 * Expand an IPv6 address (including `::` compressed forms) into its eight
 * 16-bit hextet groups. Rejects malformed input — a group that is not a valid
 * hextet (non-hex characters, an over-long group, or an embedded IPv4 literal)
 * yields null so the caller stores nothing rather than a bogus value.
 * @param value - Candidate IPv6 address, without a zone or embedded IPv4.
 * @returns Eight hextet strings, or null if the input is malformed.
 */
function expandIpv6(value: string): string[] | null {
  const halves = value.split('::');
  if (halves.length > 2) return null;
  const head = splitHextetGroups(halves[0]);
  const tail = splitHextetGroups(halves.length === 2 ? halves[1] : '');
  if (![...head, ...tail].every(isHextet)) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const missing = 8 - head.length - tail.length;
  if (missing < 1) return null;
  return [...head, ...Array.from({ length: missing }, () => '0'), ...tail];
}

/**
 * Keep the network-identifying first 48 bits of an IPv6 address and zero the
 * remaining 80 bits (the interface identifier and lower subnet bits).
 * @param value - Candidate IPv6 address.
 * @returns A `/48` prefix in compressed form (e.g. `2001:db8:85a3::`), or null
 *   if the address cannot be parsed.
 */
function truncateIpv6(value: string): string | null {
  const groups = expandIpv6(value);
  if (groups === null) return null;
  const prefix = groups
    .slice(0, 3)
    .map((group) => group.toLowerCase().replace(/^0+(?=.)/, ''));
  return `${prefix.join(':')}::`;
}

/**
 * Truncate an IP address so it can no longer identify a single device: the
 * last octet of an IPv4 address is zeroed, and the last 80 bits of an IPv6
 * address are zeroed (retaining the `/48` network prefix). IPv4-mapped IPv6
 * addresses (`::ffff:a.b.c.d`) are minimized as IPv4. Blank or unparseable
 * input yields `null` — better to store nothing than to keep an address we
 * could not minimize.
 * @param ip - The raw client IP (e.g. Express `req.ip`), or null/undefined.
 * @returns The minimized address, or null.
 */
export function truncateIp(ip: string | null | undefined): string | null {
  if (ip === null || ip === undefined) return null;
  const trimmed = ip.trim();
  if (trimmed.length === 0) return null;
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(trimmed);
  const candidate = mapped?.[1] ?? trimmed;
  if (isIpv4(candidate)) return truncateIpv4(candidate);
  if (trimmed.includes(':')) return truncateIpv6(trimmed);
  return null;
}

/**
 * Raw geolocation as it might arrive from a future geo-IP lookup.
 */
export interface GeoInput {
  /** ISO country name or code. */
  country?: string | null;
  /** City name — dropped by minimization. */
  city?: string | null;
  /** Region/subdivision — dropped by minimization. */
  region?: string | null;
}

/**
 * Coarse geolocation retained after minimization: country only.
 */
export interface CoarseGeo {
  /** Country, trimmed, or null when absent. */
  country: string | null;
  /** Always null — city is never retained. */
  city: null;
}

/**
 * Coarsen geolocation to country level, discarding city and region. This is
 * the only geo granularity the product stores; see the geo-retention ADR.
 * @param geo - Raw geolocation fields.
 * @returns Country-only coarse geo.
 */
export function coarsenGeo(geo: GeoInput): CoarseGeo {
  const country = geo.country?.trim();
  return {
    country: country !== undefined && country.length > 0 ? country : null,
    city: null,
  };
}
