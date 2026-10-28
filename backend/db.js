/**
 * PostgreSQL connection pool and schema initialization for the
 * Swapify Tasks backend. Tasks are scoped to users once auth is enabled.
 */

const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool(config.db);

// One-time schema bootstrap. Idempotent — safe to run on every startup.
async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at BIGINT NOT NULL
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      completed BOOLEAN NOT NULL DEFAULT FALSE,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );
  `);

  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id);`
  );
}

module.exports = { pool, initSchema };