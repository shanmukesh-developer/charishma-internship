const { Sequelize } = require('sequelize');
const path = require('path');

const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: path.join(__dirname, 'local_dev.sqlite'),
  logging: false
});

async function run() {
  const [users] = await sequelize.query("SELECT id, name, phone, statusText, statusEmoji FROM Users");
  console.log('--- ALL USERS IN local_dev.sqlite ---');
  for (const u of users) {
    console.log(`- ${u.name} (Phone: ${u.phone}, statusText: ${u.statusText}, statusEmoji: ${u.statusEmoji})`);
  }
}

run().catch(console.error);
