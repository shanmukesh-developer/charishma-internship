const { Sequelize } = require('sequelize');
const path = require('path');

const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: path.join(__dirname, 'local_dev.sqlite'),
  logging: false
});

async function run() {
  const [riders] = await sequelize.query("SELECT id, name, phone FROM DeliveryPartners");
  console.log('--- ALL RIDERS IN local_dev.sqlite ---');
  for (const r of riders) {
    console.log(`- ${r.name} (Phone: ${r.phone}, ID: ${r.id})`);
  }
}

run().catch(console.error);
