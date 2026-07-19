const { connectDB, getSequelize } = require('../config/db');

(async () => {
  try {
    await connectDB();
    const sequelize = getSequelize();
    const [results] = await sequelize.query("SELECT name FROM sqlite_master WHERE type='table';");
    console.log('Tables in Database:', results.map(r => r.name));
    
    // Check columns of BirthdayCelebrations
    try {
      const [cols] = await sequelize.query("PRAGMA table_info(BirthdayCelebrations);");
      console.log('BirthdayCelebrations Columns:', cols.map(c => c.name));
    } catch (e) {
      console.log('Error checking BirthdayCelebrations columns:', e.message);
    }
  } catch (err) {
    console.error('Database connection failed:', err);
  }
})();
