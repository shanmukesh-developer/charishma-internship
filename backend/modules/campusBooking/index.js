// In-Campus Booking (pickup orders paid straight to the stall by UPI). Entry point used by config/db.js and server.js.
const { initCampusBookingModels } = require('./models');

let sequelizeRef = null;

const init = (sequelize) => {
  if (!sequelize) return {};
  sequelizeRef = sequelize;
  return initCampusBookingModels(sequelize);
};

const getSequelize = () => sequelizeRef;
const getModel = (name) => (sequelizeRef && sequelizeRef.models[name]) || null;

module.exports = { initCampusBookingModels: init, getModel, getSequelize };
