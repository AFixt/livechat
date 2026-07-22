import { readdir } from 'node:fs/promises';

import { Sequelize as SequelizeLib } from 'sequelize';

import type { Sequelize } from 'sequelize';

/** The shape every migration file in `src/db/migrations` exports. */
interface Migration {
  up: (
    queryInterface: ReturnType<Sequelize['getQueryInterface']>,
    sequelize: unknown,
  ) => Promise<void>;
}

const MIGRATIONS_DIR = new URL('./migrations/', import.meta.url);

/**
 * Rebuild a database's schema by running the **real migrations**, not `sync()`.
 *
 * Test harnesses reach for `sequelize.sync({ force: true })` because it is one
 * line, but it builds tables from the models — so the models become the source
 * of truth for both the code under test and the schema it runs against, and the
 * two can never disagree. Migration drift is then structurally invisible: six
 * tables once shipped without the `deleted_at` column that the global
 * `paranoid: true` default requires, and every suite stayed green until the
 * widget returned a 500 in a browser.
 *
 * Drops every table, then applies the full migration history in filename order
 * — the same path a real deployment takes.
 *
 * Destructive by design: only point this at a dedicated test/e2e database.
 * @param sequelize - Connection to the database to rebuild.
 */
export async function resetSchemaFromMigrations(sequelize: Sequelize): Promise<void> {
  const queryInterface = sequelize.getQueryInterface();

  // Pin one connection for the drops: FOREIGN_KEY_CHECKS is session-scoped, so
  // toggling it on a pooled connection other than the one running the DROPs
  // would not take effect.
  await sequelize.transaction(async (transaction) => {
    const tables = await queryInterface.showAllTables({ transaction });
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 0', { transaction });
    for (const table of tables) {
      await sequelize.query(`DROP TABLE IF EXISTS \`${table}\``, { transaction });
    }
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 1', { transaction });
  });

  // eslint-disable-next-line security/detect-non-literal-fs-filename -- module constant, no external input
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.cjs')).sort();
  for (const file of files) {
    const loaded = (await import(new URL(file, MIGRATIONS_DIR).href)) as {
      default?: Migration;
    } & Migration;
    const migration = loaded.default ?? loaded;
    // Migrations receive the Sequelize class itself (for `Sequelize.DATE` etc.),
    // exactly as sequelize-cli passes it.
    await migration.up(queryInterface, SequelizeLib);
  }
}
