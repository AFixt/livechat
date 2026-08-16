import { describe, expect, it } from 'vitest';

import { cspReportSchema, toCspLogFields } from './csp-report.js';

describe('cspReportSchema', () => {
  it('accepts a classic report-uri payload', () => {
    const parsed = cspReportSchema.safeParse({
      'csp-report': {
        'document-uri': 'https://client.example.com/page',
        'violated-directive': 'script-src',
        'blocked-uri': 'https://evil.example.com/x.js',
        'status-code': 200,
      },
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts a Reporting-API report-to array', () => {
    const parsed = cspReportSchema.safeParse([
      {
        type: 'csp-violation',
        url: 'https://client.example.com/page',
        body: { documentURL: 'https://client.example.com/page', blockedURL: 'inline' },
      },
    ]);
    expect(parsed.success).toBe(true);
  });

  it('rejects a body that matches neither shape', () => {
    expect(cspReportSchema.safeParse({ foo: 'bar' }).success).toBe(false);
    expect(cspReportSchema.safeParse('a long string').success).toBe(false);
    expect(cspReportSchema.safeParse([]).success).toBe(false);
  });

  it('rejects an over-length field', () => {
    const parsed = cspReportSchema.safeParse({
      'csp-report': { 'blocked-uri': 'x'.repeat(4000) },
    });
    expect(parsed.success).toBe(false);
  });

  it('caps the report-to array length', () => {
    const entry = { type: 'csp-violation', body: {} };
    const parsed = cspReportSchema.safeParse(Array.from({ length: 51 }, () => entry));
    expect(parsed.success).toBe(false);
  });

  it('strips unknown keys rather than failing on them', () => {
    const parsed = cspReportSchema.safeParse({
      'csp-report': { 'document-uri': 'https://a.example', 'future-field': 'ignored' },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success && !Array.isArray(parsed.data)) {
      expect(parsed.data['csp-report']).not.toHaveProperty('future-field');
    }
  });
});

describe('toCspLogFields', () => {
  it('normalises a report-uri body and never leaks sample/original-policy', () => {
    const fields = toCspLogFields({
      'csp-report': {
        'document-uri': 'https://client.example.com/page',
        'violated-directive': 'script-src',
        'blocked-uri': 'https://evil.example.com/x.js',
        'original-policy': "default-src 'self'",
        'script-sample': 'alert(document.cookie)',
      },
    });
    expect(fields).toMatchObject({
      reportType: 'report-uri',
      documentUri: 'https://client.example.com/page',
      violatedDirective: 'script-src',
      blockedUri: 'https://evil.example.com/x.js',
    });
    expect(fields).not.toHaveProperty('originalPolicy');
    expect(JSON.stringify(fields)).not.toContain('document.cookie');
    expect(JSON.stringify(fields)).not.toContain("default-src 'self'");
  });

  it('normalises a report-to body to the same flat shape', () => {
    const fields = toCspLogFields([
      {
        type: 'csp-violation',
        body: {
          documentURL: 'https://client.example.com/page',
          violatedDirective: 'img-src',
          blockedURL: 'https://cdn.evil/x.png',
          sample: 'secret',
        },
      },
    ]);
    expect(fields).toMatchObject({
      reportType: 'report-to',
      documentUri: 'https://client.example.com/page',
      violatedDirective: 'img-src',
      blockedUri: 'https://cdn.evil/x.png',
    });
    expect(JSON.stringify(fields)).not.toContain('secret');
  });
});
