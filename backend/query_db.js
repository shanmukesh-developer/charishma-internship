const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.join(__dirname, 'local_dev.sqlite');

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error connecting to database:', err);
    return;
  }
  console.log('Connected to SQLite database at', dbPath);
});

db.all('SELECT id, name, vendorType FROM Restaurants', [], (err, rows) => {
  if (err) {
    console.error('Error querying Restaurants:', err);
    return;
  }
  console.log('--- RESTAURANTS IN DATABASE ---');
  rows.forEach((row) => {
    console.log(`ID: ${row.id} | Name: ${row.name} | Type: ${row.vendorType}`);
  });
  console.log('-------------------------------');
  db.close();
});
