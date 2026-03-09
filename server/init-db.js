require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.PGHOST || "localhost",
  port: Number(process.env.PGPORT) || 5432,
  database: process.env.PGDATABASE || "vrumexp",
  user: process.env.PGUSER || "postgres",
  password: process.env.PGPASSWORD != null ? String(process.env.PGPASSWORD) : undefined,
});

async function main() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  console.log("Table 'reports' ready.");
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
