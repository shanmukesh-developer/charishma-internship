const { Sequelize } = require('sequelize');

async function run() {
  const dbUrl = 'postgresql://hostelbites_user:b7Wz3ybgQuTcyIVAJb0R4ZDw6H1FfEEY@dpg-d7id3okvikkc73efva60-a.virginia-postgres.render.com/hostelbites?ssl=true';
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
    
    // Auto-alter the table to ensure friendCode exists (Sequelize postgres handles alter well)
    const { initUserModel, getUserModel } = require('../models/User');
    initUserModel(sequelize);
    const User = getUserModel();
    
    // Add columns just in case
    await sequelize.query(`ALTER TABLE "Users" ADD COLUMN IF NOT EXISTS "friendCode" VARCHAR(255) UNIQUE;`).catch(() => {});
    
    const users = await User.findAll();
    let updated = 0;
    
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for (const user of users) {
      if (!user.friendCode) {
        let code = '';
        for (let i = 0; i < 5; i++) {
          code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        user.friendCode = 'ZNV-' + code;
        await user.save();
        updated++;
      }
    }
    console.log(`Backfilled ${updated} users on production!`);
  } catch (err) {
    console.error('Failed:', err);
  } finally {
    await sequelize.close();
  }
}

run();
