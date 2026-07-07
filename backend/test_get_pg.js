const { connectDB, getSequelize } = require('./config/db');

async function test() {
  await connectDB();
  const sequelize = getSequelize();
  const PGHostel = sequelize.models.PGHostel;
  const PGRoom = sequelize.models.PGRoom;
  
  try {
    const pg = await PGHostel.findOne();
    if (!pg) {
      console.log('No PGs found in DB.');
      return;
    }
    console.log('Found PG:', pg.id, pg.name);
    console.log('Querying with include...');
    const pgDetails = await PGHostel.findByPk(pg.id, {
      include: [{ model: PGRoom, as: 'rooms', where: { isActive: true }, required: false }]
    });
    console.log('Successfully fetched PG details with rooms:', pgDetails.name);
  } catch (err) {
    console.error('Error during query:', err);
  }
  process.exit(0);
}

test();
