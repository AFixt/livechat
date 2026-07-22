import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Guards against schema/model drift in the migrations.
 *
 * `createSequelize` sets `paranoid: true`, `timestamps: true` as global
 * `define` defaults, so every model emits `deleted_at` in its SELECT field list
 * and appends `deleted_at IS NULL` to every WHERE. A table whose migrations
 * never produce the column yields a database the ORM cannot read —
 * `ER_BAD_FIELD_ERROR: Unknown column 'deleted_at'` on the first query.
 *
 * Six tables shipped that way (visitor_sessions, chat_events, user_sessions,
 * jwt_blacklist, audit_logs, staff_tenants) and it reached a running stack,
 * because the e2e seeder and the integration suite both build their schema with
 * `sync({ force: true })` — from the models, which always include the column —
 * so nothing exercised the migrated schema. This test closes that gap
 * statically, without needing a database.
 *
 * It replays the migrations in filename order and accumulates each table's
 * effective column set, so a column introduced by a later `addColumn` counts
 * just as much as one declared in the original `createTable`.
 */

const MIGRATIONS_DIR = join(import.meta.dirname, '../../src/db/migrations');

/**
 * Columns every table must end up with.
 *
 * Only `deleted_at` is universal: `paranoid: true` is a global define default
 * and no model overrides it to `false`, so every table is read with a
 * `deleted_at IS NULL` predicate. `updated_at` is deliberately NOT asserted —
 * append-only models (audit_logs, chat_events, jwt_blacklist, staff_tenants,
 * chat_attachments) legitimately set `updatedAt: false`.
 */
const REQUIRED_COLUMNS = ['created_at', 'deleted_at'] as const;

/**
 * Find the matching close brace for the `{` that begins at `from`.
 * @param source - Text to scan.
 * @param from - Index just past the opening brace.
 * @returns Index just past the matching close brace.
 */
function matchBrace(source: string, from: number): number {
  let depth = 1;
  let i = from;
  while (i < source.length && depth > 0) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    i += 1;
  }
  return i;
}

/**
 * Replay every migration and build each table's effective column set.
 * @param sources - Migration file contents, in filename order.
 * @returns Map of table name to the columns its migrations produce.
 */
function effectiveColumns(sources: string[]): Map<string, Set<string>> {
  const tables = new Map<string, Set<string>>();

  for (const source of sources) {
    const creates = /createTable\(\s*['"`]([a-z_]+)['"`]\s*,\s*\{/g;
    let m: RegExpExecArray | null;
    while ((m = creates.exec(source)) !== null) {
      const table = m[1];
      if (table === undefined) continue;
      const end = matchBrace(source, creates.lastIndex);
      const body = source.slice(creates.lastIndex, end);
      const cols = new Set<string>();
      for (const c of body.matchAll(/^\s*([a-z_]+)\s*:/gm)) {
        if (c[1] !== undefined) cols.add(c[1]);
      }
      tables.set(table, cols);
    }

    // addColumn('table', 'column', …) — including loops over a table list,
    // which is how the corrective migration backfills several tables at once.
    for (const a of source.matchAll(
      /addColumn\(\s*(?:['"`]([a-z_]+)['"`]|[A-Za-z_$][\w$]*)\s*,\s*['"`]([a-z_]+)['"`]/g,
    )) {
      const [, literalTable, column] = a;
      if (column === undefined) continue;
      if (literalTable !== undefined) {
        (tables.get(literalTable) ?? tables.set(literalTable, new Set()).get(literalTable))?.add(
          column,
        );
        continue;
      }
      // Variable table name: applies to every table named in the file, which
      // for our loop-style migrations is the declared TABLES array.
      for (const t of source.matchAll(/['"`]([a-z_]+)['"`]\s*,?\s*$/gm)) {
        const name = t[1];
        if (name !== undefined && tables.has(name)) tables.get(name)?.add(column);
      }
    }
  }
  return tables;
}

describe('migration schema drift', () => {
  it('every migrated table ends up with the columns the define defaults require', async () => {
    // Both paths derive from MIGRATIONS_DIR, a module constant resolved from
    // import.meta.dirname — no external input reaches them, so the non-literal
    // filename rule is a false positive here.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.cjs')).sort();
    expect(files.length).toBeGreaterThan(0);

    const sources = await Promise.all(
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      files.map(async (f) => readFile(join(MIGRATIONS_DIR, f), 'utf8')),
    );
    const tables = effectiveColumns(sources);
    expect(tables.size).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const [table, columns] of tables) {
      for (const required of REQUIRED_COLUMNS) {
        if (!columns.has(required)) offenders.push(`${table} is missing ${required}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
