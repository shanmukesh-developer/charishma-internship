const { Sequelize } = require('sequelize');
const path = require('path');

const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: path.join(__dirname, 'local_dev.sqlite.bak'),
  logging: false
});

async function run() {
  const [restaurants] = await sequelize.query("SELECT * FROM Restaurants");
  console.log('--- ALL RESTAURANTS IN local_dev.sqlite.bak ---');
  for (const r of restaurants) {
    console.log(`- ID: ${r.id}, Name: ${r.name}, VendorType: ${r.vendorType}, isOffline: ${r.isOffline}, isActive: ${r.isActive}`);
  }
}

run().catch(console.error);
