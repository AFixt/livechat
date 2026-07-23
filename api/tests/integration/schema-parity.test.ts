import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { resetSchemaFromMigrations } from '../../src/db/migrator.js';

import { probeHarness } from './setup.js';

import type { Sequelize } from 'sequelize';

type Harness = Awaited<ReturnType<typeof probeHarness>>;

let harness: Harness;

/** A column as the database reports it, reduced to what the ORM depends on. */
interface ColumnShape {
  type: string;
  allowNull: boolean;
}

/** One table's structure, as introspected from a live database. */
interface TableShape {
  columns: Record<string, ColumnShape>;
  /** Sorted "col_a+col_b" keys of the table's UNIQUE indexes. */
  unique: string[];
  /** Sorted "col_a+col_b" keys of the table's non-unique indexes. */
  nonUnique: string[];
}

/** Sequelize's `showIndex` rows, narrowed to the fields used here. */
interface IndexRow {
  name: string;
  unique: boolean;
  fields?: { attribute: string }[];
}

/**
 * Introspect every table in the connected database.
 *
 * Reads through the same MySQL information_schema in both directions, so types
 * come back in MySQL's canonical form and are directly comparable rather than
 * reflecting how each side happened to declare them.
 * @param sequelize - Connection to introspect.
 * @returns Table name to structure.
 */
async function introspect(sequelize: Sequelize): Promise<Record<string, TableShape>> {
  const queryInterface = sequelize.getQueryInterface();
  const tables = (await queryInterface.showAllTables()).filter((t) => t !== 'SequelizeMeta');
  const out: Record<string, TableShape> = {};

  for (const table of tables.sort()) {
    const described = await queryInterface.describeTable(table);
    const columns: Record<string, ColumnShape> = {};
    for (const [name, info] of Object.entries(described)) {
      columns[name] = { type: info.type.toUpperCase(), allowNull: info.allowNull };
    }

    const indexes = (await queryInterface.showIndex(table)) as unknown as IndexRow[];
    const unique: string[] = [];
    const nonUnique: string[] = [];
    for (const index of indexes) {
      if (index.name === 'PRIMARY') continue;
      const key = (index.fields ?? [])
        .map((f) => f.attribute)
        .sort()
        .join('+');
      if (key === '') continue;
      (index.unique ? unique : nonUnique).push(key);
    }
    out[table] = {
      columns,
      unique: [...new Set(unique)].sort(),
      nonUnique: [...new Set(nonUnique)].sort(),
    };
  }
  return out;
}

describe('schema parity: migrations vs models (integration)', () => {
  beforeAll(async () => {
    harness = await probeHarness();
    if (harness === null) {
      console.warn('[integration] MySQL or Redis not reachable — skipping');
    }
  }, 60_000);

  afterAll(async () => {
    // Leave the database in the canonical, migration-built state for whatever
    // runs next, then close.
    if (harness !== null) {
      await resetSchemaFromMigrations(harness.sequelize);
      await harness.cleanup();
    }
  }, 60_000);

  test('the migrated schema matches what the models would create', async () => {
    if (harness === null) return;
    const { sequelize } = harness;

    // probeHarness already built the schema from the real migrations.
    const migrated = await introspect(sequelize);
    // Rebuild the same database from the models and introspect again.
    await sequelize.sync({ force: true });
    const modelled = await introspect(sequelize);

    // 1. Same tables on both sides.
    expect(Object.keys(migrated).sort()).toEqual(Object.keys(modelled).sort());

    // 2. Same columns, with the same type and nullability. This is the class
    //    of drift that breaks the ORM outright — a model selecting a column
    //    the migrations never created (see issue #37), or a type the data
    //    will not round-trip through.
    const columnDiffs: string[] = [];
    for (const [table, modelShape] of Object.entries(modelled)) {
      const migratedShape = migrated[table];
      if (migratedShape === undefined) continue;
      const names = new Set([
        ...Object.keys(modelShape.columns),
        ...Object.keys(migratedShape.columns),
      ]);
      for (const column of [...names].sort()) {
        const fromModel = modelShape.columns[column];
        const fromMigration = migratedShape.columns[column];
        if (fromModel === undefined) {
          columnDiffs.push(`${table}.${column}: in migrations, not in models`);
          continue;
        }
        if (fromMigration === undefined) {
          columnDiffs.push(`${table}.${column}: in models, not in migrations`);
          continue;
        }
        if (fromModel.type !== fromMigration.type) {
          columnDiffs.push(
            `${table}.${column}: type ${fromMigration.type} (migrations) vs ${fromModel.type} (models)`,
          );
        }
        // Nullability is asserted in one direction only.
        //
        // Dangerous: the model requires a value but the database permits
        // NULL. The ORM then assumes an invariant the database will not
        // enforce, and any other writer can violate it.
        //
        // Safe, and currently true of ~30 columns: the migrations declare
        // NOT NULL while the model attribute omits `allowNull: false`. The
        // database is stricter than the model, TypeScript already types the
        // field as non-nullable, and every suite builds its schema from the
        // migrations. Tightening those model declarations to match would be
        // an improvement, but it is a separate change and not a correctness
        // gate.
        if (!fromModel.allowNull && fromMigration.allowNull) {
          columnDiffs.push(`${table}.${column}: models require NOT NULL but migrations allow NULL`);
        }
      }
    }
    expect(columnDiffs).toEqual([]);

    // 3. Every UNIQUE constraint the models expect must exist in the migrated
    //    schema. Uniqueness is a correctness guarantee, not a hint — a model
    //    relying on one the database lacks admits duplicate rows.
    //    Extra indexes in the migrations are fine and not asserted: a
    //    performance index nobody declared on the model breaks nothing.
    const uniqueDiffs: string[] = [];
    for (const [table, modelShape] of Object.entries(modelled)) {
      const migratedShape = migrated[table];
      if (migratedShape === undefined) continue;
      for (const key of modelShape.unique) {
        if (!migratedShape.unique.includes(key)) {
          uniqueDiffs.push(`${table}: models declare UNIQUE(${key}); migrations do not`);
        }
      }
    }
    expect(uniqueDiffs).toEqual([]);
  }, 120_000);
});
