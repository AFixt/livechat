/**
 * Generate the OpenAPI document to a file (or stdout) without booting the API.
 *
 * Importing the route barrel runs each route module's top-level
 * `openApiRegistry.registerPath(...)` side effects, populating the shared
 * registry; `buildOpenApiSpec` then serializes it. No DB/Redis connection and
 * no full env validation are required — only API_URL is read (for the server
 * URL), defaulting to a placeholder when unset.
 *
 * Usage:
 *   tsx api/src/scripts/generate-openapi.ts [outfile]
 *   API_URL=https://api.example.com tsx api/src/scripts/generate-openapi.ts spec.json
 *
 * Consumed by scripts/api-fuzz.sh (Schemathesis) and the ZAP API scan.
 */
import { writeFileSync } from 'node:fs';

// Side-effect import: registers every route's OpenAPI path into openApiRegistry.
import '../routes/index.js';
import { buildOpenApiSpec } from '../config/swagger.js';

const apiUrl = process.env.API_URL ?? 'http://localhost:3000';
// Typed as unknown: this script only serializes the document and counts paths,
// so it deliberately does not depend on the generator's inferred shape.
const spec: unknown = buildOpenApiSpec({ API_URL: apiUrl });
const paths = (spec as { paths?: Record<string, unknown> }).paths ?? {};

const outPath = process.argv[2];
const json = JSON.stringify(spec, null, 2);

if (outPath === undefined || outPath === '-') {
  process.stdout.write(json + '\n');
} else {
  // outPath is an operator-supplied CLI argument, not external/network input.
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- CLI arg, trusted caller
  writeFileSync(outPath, json);
}

const pathCount = Object.keys(paths).length;
// Diagnostics go to stderr so `... > spec.json` still yields clean JSON.
process.stderr.write(`Generated OpenAPI spec: ${String(pathCount)} path(s), server ${apiUrl}\n`);
