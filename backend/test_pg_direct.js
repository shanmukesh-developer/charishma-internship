const { Client } = require('pg');

async function run() {
  const connectionString = 'postgresql://hostelbites_user:b7Wz3ybgQuTcyIVAJb0R4ZDw6H1FfEEY@dpg-d7id3okvikkc73efva60.virginia-postgres.render.com/hostelbites?ssl=true';
  const client = new Client({
    connectionString,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    await client.connect();
    console.log('Successfully connected directly via pg!');
    
    // Check tables
    const res = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public'");
    console.log('Tables:', res.rows.map(r => r.table_name));
    
    // Check Users table columns
    const cols = await client.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='Users'");
    console.log('Users columns:', cols.rows.map(c => `${c.column_name} (${c.data_type})`));
    
  } catch (err) {
    console.error('Connection failed:', err.message);
  } finally {
    await client.end();
  }
}

run();
