// ZCS PG Partner (the PG owner app, package com.srm.zenvypgowner). Entry point used by config/db.js
// (models) and server.js (routers: modules/pgOwner/routes.js).
const { initPgOwnerModels } = require('./models');

let sequelizeRef = null;

const init = (sequelize) => {
  if (!sequelize) return {};
  sequelizeRef = sequelize;
  return initPgOwnerModels(sequelize);
};

const getSequelize = () => sequelizeRef;
const getModel = (name) => (sequelizeRef && sequelizeRef.models[name]) || null;

module.exports = { initPgOwnerModels: init, getModel, getSequelize };
