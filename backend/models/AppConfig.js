const { DataTypes } = require('sequelize');

let AppConfig;

const initAppConfigModel = (sequelize) => {
  if (!sequelize) return null;

  AppConfig = sequelize.define('AppConfig', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    banners: {
      type: DataTypes.TEXT,
      defaultValue: '[]',
      get() {
        const val = this.getDataValue('banners');
        try { return val ? JSON.parse(val) : []; } catch { return []; }
      },
      set(val) {
        this.setDataValue('banners', typeof val === 'string' ? val : JSON.stringify(val));
      }
    },
    categories: {
      type: DataTypes.TEXT,
      defaultValue: '[]',
      get() {
        const val = this.getDataValue('categories');
        try { return val ? JSON.parse(val) : []; } catch { return []; }
      },
      set(val) {
        this.setDataValue('categories', typeof val === 'string' ? val : JSON.stringify(val));
      }
    },
    maintenanceMode: { type: DataTypes.BOOLEAN, defaultValue: false },
    campusOpen: { type: DataTypes.BOOLEAN, defaultValue: true },
    activeTheme: { type: DataTypes.STRING, defaultValue: 'default' },
    globalAnnouncement: { type: DataTypes.TEXT, defaultValue: '' },
    lastUpdatedBy: { type: DataTypes.UUID, allowNull: true }
  }, { timestamps: true });

  return AppConfig;
};

const handler = {
  get(target, prop) {
    if (prop === 'initAppConfigModel') return initAppConfigModel;
    if (prop === 'getAppConfigModel') return () => AppConfig;
    if (!AppConfig) {
      throw new Error("AppConfig model not initialized yet.");
    }
    return AppConfig[prop];
  },
  construct(target, argumentsList) {
    if (!AppConfig) {
      throw new Error("AppConfig model not initialized yet.");
    }
    return new AppConfig(...argumentsList);
  }
};

module.exports = new Proxy(function(){}, handler);
