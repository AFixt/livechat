'use strict';

const crypto = require('node:crypto');

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('tenants', 'embed_secret', {
      type: Sequelize.STRING(128),
      allowNull: true,
    });
    await queryInterface.addColumn('tenants', 'allowed_origins', {
      type: Sequelize.JSON,
      allowNull: true,
    });

    // Backfill existing tenants with fresh secrets, then tighten NOT NULL.
    const [rows] = await queryInterface.sequelize.query('SELECT id FROM tenants');
    for (const row of rows) {
      const secret = crypto.randomBytes(32).toString('hex');
      await queryInterface.sequelize.query(
        'UPDATE tenants SET embed_secret = :secret WHERE id = :id',
        { replacements: { secret, id: row.id } },
      );
    }

    await queryInterface.changeColumn('tenants', 'embed_secret', {
      type: Sequelize.STRING(128),
      allowNull: false,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('tenants', 'embed_secret');
    await queryInterface.removeColumn('tenants', 'allowed_origins');
  },
};
