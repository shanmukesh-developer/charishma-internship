const { Sequelize } = require('sequelize');
const path = require('path');

const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: path.join(__dirname, 'local_dev.sqlite'),
  logging: false
});

async function run() {
  try {
    const [tables] = await sequelize.query("SELECT name FROM sqlite_master WHERE type='table'");
    console.log('Tables:', tables.map(t => t.name));

    // Try BirthdayCelebrations table name (could be pluralized with different casing)
    for (const t of tables) {
      if (t.name.toLowerCase().includes('birthday')) {
        console.log(`\nTable ${t.name} contents:`);
        const [rows] = await sequelize.query(`SELECT id, "candidateName", "candidatePhotoUrl", "status" FROM "${t.name}"`);
        console.log(JSON.stringify(rows, null, 2));
      }
    }
  } catch (err) {
    console.error('Error querying DB:', err);
  } finally {
    process.exit();
  }
}

run();
