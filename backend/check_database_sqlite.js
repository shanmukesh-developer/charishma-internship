const { Sequelize } = require('sequelize');
const path = require('path');

const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: path.join(__dirname, 'database.sqlite'),
  logging: false
});

async function run() {
  const [restaurants] = await sequelize.query("SELECT * FROM Restaurants");
  console.log('--- ALL RESTAURANTS IN database.sqlite ---');
  for (const r of restaurants) {
    console.log(`- Name: ${r.name}, VendorType: ${r.vendorType}, isOffline: ${r.isOffline}, isActive: ${r.isActive}`);
  }
}

run().catch(console.error);
