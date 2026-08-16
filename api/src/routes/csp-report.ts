import { z } from 'zod';

/**
 * Bounds for individual CSP-report string fields. Reports arrive on an
 * unauthenticated public endpoint, so every string is length-capped to keep a
 * hostile client from turning the log sink into an unbounded write.
 */
const URI = z.string().max(2048);
const DIRECTIVE = z.string().max(256);
const SHORT = z.string().max(64);

/**
 * Body of a classic `report-uri` violation report (the object nested under the
 * `csp-report` key). Unknown keys are stripped rather than rejected — browsers
 * add fields over time — but the recognisable shape is still required.
 */
const cspReportUriBodySchema = z
  .object({
    'document-uri': URI.optional(),
    'referrer': URI.optional(),
    'violated-directive': DIRECTIVE.optional(),
    'effective-directive': DIRECTIVE.optional(),
    'original-policy': z.string().max(4096).optional(),
    'disposition': SHORT.optional(),
    'blocked-uri': URI.optional(),
    'status-code': z.number().int().optional(),
    'source-file': URI.optional(),
    'line-number': z.number().int().optional(),
    'column-number': z.number().int().optional(),
    'script-sample': z.string().max(512).optional(),
  })
  .strip();

/**
 * Classic `Content-Type: application/csp-report` payload:
 * `{ "csp-report": { ... } }`.
 */
export const cspReportUriSchema = z.object({ 'csp-report': cspReportUriBodySchema }).strip();

/**
 * Body of a Reporting-API (`report-to`) CSP violation entry. Same information
 * as the classic form, camelCased.
 */
const cspReportToBodySchema = z
  .object({
    documentURL: URI.optional(),
    referrer: URI.optional(),
    violatedDirective: DIRECTIVE.optional(),
    effectiveDirective: DIRECTIVE.optional(),
    originalPolicy: z.string().max(4096).optional(),
    disposition: SHORT.optional(),
    blockedURL: URI.optional(),
    statusCode: z.number().int().optional(),
    sourceFile: URI.optional(),
    lineNumber: z.number().int().optional(),
    columnNumber: z.number().int().optional(),
    sample: z.string().max(512).optional(),
  })
  .strip();

/**
 * A single Reporting-API report envelope. Only `type` and `body` are required;
 * `url`/`age`/`user_agent` are optional metadata the browser may attach.
 */
const cspReportToEntrySchema = z
  .object({
    type: SHORT,
    url: URI.optional(),
    age: z.number().int().optional(),
    user_agent: z.string().max(512).optional(),
    body: cspReportToBodySchema,
  })
  .strip();

/**
 * Reporting-API (`Content-Type: application/reports+json`) payload: a bounded
 * array of report envelopes. Capped at 50 to keep a single POST small.
 */
export const cspReportToSchema = z.array(cspReportToEntrySchema).min(1).max(50);

/**
 * Accepted CSP-report body — either the classic `report-uri` object or the
 * Reporting-API array. Anything that matches neither is rejected (400).
 */
export const cspReportSchema = z.union([cspReportUriSchema, cspReportToSchema]);
/**
 * Parsed CSP report, in whichever wire form the browser used.
 */
export type CspReport = z.infer<typeof cspReportSchema>;

/**
 * The whitelist of fields that are safe to log. `original-policy` and the
 * violation `sample`/`script-sample` are deliberately excluded — they can be
 * large and can echo page content back into the logs. Optional fields are
 * typed to include `undefined`: absent fields serialise away in the JSON log
 * line, so the log carries only what the report actually supplied.
 */
export interface CspLogFields {
  reportType: 'report-uri' | 'report-to';
  documentUri?: string | undefined;
  referrer?: string | undefined;
  violatedDirective?: string | undefined;
  effectiveDirective?: string | undefined;
  blockedUri?: string | undefined;
  disposition?: string | undefined;
  statusCode?: number | undefined;
  sourceFile?: string | undefined;
  lineNumber?: number | undefined;
  columnNumber?: number | undefined;
}

/**
 * Reduce a validated CSP report to the bounded, whitelisted fields that are
 * safe to log. Normalises both wire forms to one flat shape; never returns the
 * raw body, the original policy, or the violation sample.
 * @param report - A report already validated by {@link cspReportSchema}.
 * @returns The loggable subset.
 */
export function toCspLogFields(report: CspReport): CspLogFields {
  if (Array.isArray(report)) {
    const body = report[0]?.body ?? {};
    return {
      reportType: 'report-to',
      documentUri: body.documentURL,
      referrer: body.referrer,
      violatedDirective: body.violatedDirective,
      effectiveDirective: body.effectiveDirective,
      blockedUri: body.blockedURL,
      disposition: body.disposition,
      statusCode: body.statusCode,
      sourceFile: body.sourceFile,
      lineNumber: body.lineNumber,
      columnNumber: body.columnNumber,
    };
  }
  const body = report['csp-report'];
  return {
    reportType: 'report-uri',
    documentUri: body['document-uri'],
    referrer: body.referrer,
    violatedDirective: body['violated-directive'],
    effectiveDirective: body['effective-directive'],
    blockedUri: body['blocked-uri'],
    disposition: body.disposition,
    statusCode: body['status-code'],
    sourceFile: body['source-file'],
    lineNumber: body['line-number'],
    columnNumber: body['column-number'],
  };
}
