'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('tenants', {
      id: { type: Sequelize.UUID, primaryKey: true, defaultValue: Sequelize.UUIDV4 },
      inc: { type: Sequelize.MEDIUMINT.UNSIGNED, autoIncrement: true, unique: true },
      name: { type: Sequelize.STRING(255), allowNull: false },
      slug: { type: Sequelize.STRING(100), allowNull: false, unique: true },
      domain: { type: Sequelize.STRING(255), allowNull: true },
      status: {
        type: Sequelize.ENUM('active', 'suspended', 'archived'),
        defaultValue: 'active',
        allowNull: false,
      },
      expires_at: { type: Sequelize.DATE, allowNull: true },
      settings: { type: Sequelize.JSON, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
      deleted_at: { type: Sequelize.DATE, allowNull: true },
    });
    await queryInterface.addIndex('tenants', ['status']);
    await queryInterface.addIndex('tenants', ['expires_at']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('tenants');
  },
};
