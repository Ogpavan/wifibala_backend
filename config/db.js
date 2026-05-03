import pkg from "pg";
const { Pool } = pkg;
import dotenv from "dotenv";

dotenv.config();

const pool = new Pool({
  user: process.env.DB_USER,               // must match DB user
  host: process.env.DB_HOST,               // your PostgreSQL host (IP or localhost)
  database: process.env.DB_NAME,           // DB name
  password: process.env.DB_PASSWORD,       // DB password as string
  port: Number(process.env.DB_PORT),       // port must be number
  ssl: false,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on("error", (err) => {
  console.error("🔥 PG POOL ERROR (connection dropped):", err.message);
});

(async () => {
  try {
    await pool.query("SELECT 1");
    console.log("✅ PostgreSQL connected successfully");
  } catch (err) {
    console.error("❌ PostgreSQL connection failed:", err.message);
  }
})();

export default pool;
