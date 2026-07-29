const { Sequelize } = require('sequelize');

async function run() {
  const dbUrl = 'postgresql://hostelbites_user:b7Wz3ybgQuTcyIVAJb0R4ZDw6H1FfEEY@dpg-d7id3okvikkc73efva60.virginia-postgres.render.com/hostelbites?ssl=true';
  const sequelize = new Sequelize(dbUrl, {
    dialect: 'postgres',
    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false
      }
    },
    logging: false
  });

  try {
    await sequelize.authenticate();
    console.log('Connected to remote Postgres.');

    const [users] = await sequelize.query('SELECT id, name, phone, role FROM "Users"');
    console.log('--- ALL USERS IN PRODUCTION POSTGRES ---');
    for (const u of users) {
      console.log(`- ${u.name} (Phone: ${u.phone}, Role: ${u.role}, ID: ${u.id})`);
    }

    const [riders] = await sequelize.query('SELECT id, name, phone, "isApproved" FROM "DeliveryPartners"');
    console.log('\n--- ALL RIDERS IN PRODUCTION POSTGRES ---');
    for (const r of riders) {
      console.log(`- ${r.name} (Phone: ${r.phone}, Approved: ${r.isApproved}, ID: ${r.id})`);
    }

  } catch (err) {
    console.error('Failed:', err);
  } finally {
    await sequelize.close();
  }
}

run();
