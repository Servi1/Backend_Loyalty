require('dotenv').config();
const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });
  
  try {
    await client.connect();
    console.log("Connected to PostgreSQL using:", process.env.DATABASE_URL);
    
    const res = await client.query(`
      SELECT table_schema, table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `);
    
    console.log("Found tables in public schema:");
    if (res.rows.length === 0) {
      console.log("  (None)");
    } else {
      res.rows.forEach(r => {
        console.log(`  - ${r.table_schema}.${r.table_name}`);
      });
    }
  } catch (err) {
    console.error("Connection failed:", err.message);
  } finally {
    await client.end();
  }
}

run();
