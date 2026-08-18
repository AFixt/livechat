import { describe, expect, it } from 'vitest';

import { coarsenGeo, truncateIp } from './pii-minimize.js';

describe('truncateIp', () => {
  it('zeroes the last octet of an IPv4 address', () => {
    expect(truncateIp('203.0.113.42')).toBe('203.0.113.0');
    expect(truncateIp('192.168.1.255')).toBe('192.168.1.0');
    expect(truncateIp('8.8.8.8')).toBe('8.8.8.0');
  });

  it('minimizes an IPv4-mapped IPv6 address as IPv4', () => {
    expect(truncateIp('::ffff:203.0.113.42')).toBe('203.0.113.0');
  });

  it('keeps the /48 prefix of an IPv6 address and zeroes the rest', () => {
    expect(truncateIp('2001:db8:85a3:8d3:1319:8a2e:370:7348')).toBe('2001:db8:85a3::');
  });

  it('handles compressed IPv6 (::) forms', () => {
    expect(truncateIp('2001:db8::1')).toBe('2001:db8:0::');
    expect(truncateIp('fe80::1234:5678')).toBe('fe80:0:0::');
  });

  it('strips leading zeroes within retained hextets', () => {
    expect(truncateIp('2001:0db8:0000:0000:0000:0000:0000:0001')).toBe('2001:db8:0::');
  });

  it('returns null for blank, missing, or unparseable input', () => {
    expect(truncateIp(null)).toBeNull();
    expect(truncateIp(undefined)).toBeNull();
    expect(truncateIp('')).toBeNull();
    expect(truncateIp('   ')).toBeNull();
    expect(truncateIp('not-an-ip')).toBeNull();
    expect(truncateIp('999.999.999.999')).toBeNull();
  });

  it('returns null for colon-bearing garbage rather than storing it', () => {
    // A colon is not enough to make a string an IPv6 address; each group must
    // be a valid 1–4 digit hextet or nothing is stored.
    expect(truncateIp('foo:bar:baz::')).toBeNull();
    expect(truncateIp('zzzz:gggg::')).toBeNull();
    expect(truncateIp('a:b:c:d:e:f:g:h')).toBeNull(); // g/h are not hex
    expect(truncateIp('12345::')).toBeNull(); // hextet too long
    expect(truncateIp(':::')).toBeNull(); // more than one '::'
    expect(truncateIp('2001:db8::1.2.3.4')).toBeNull(); // embedded IPv4 literal
    expect(truncateIp('1:2:3:4:5:6:7:8::')).toBeNull(); // trailing '::' with 8 groups
  });
});

describe('coarsenGeo', () => {
  it('keeps country and drops city and region', () => {
    expect(coarsenGeo({ country: 'US', city: 'Baltimore', region: 'MD' })).toEqual({
      country: 'US',
      city: null,
    });
  });

  it('trims and normalizes an absent country to null', () => {
    expect(coarsenGeo({ country: '  ', city: 'Berlin' })).toEqual({ country: null, city: null });
    expect(coarsenGeo({})).toEqual({ country: null, city: null });
    expect(coarsenGeo({ country: null })).toEqual({ country: null, city: null });
  });

  it('never emits a city even when only a city is provided', () => {
    expect(coarsenGeo({ city: 'Paris' }).city).toBeNull();
  });
});
