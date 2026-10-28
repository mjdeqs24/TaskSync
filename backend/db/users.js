/**
 * User data-access layer (PostgreSQL).
 */

const { pool } = require('../db');

async function createUser(email, passwordHash) {
  const now = Date.now();
  const result = await pool.query(
    `INSERT INTO users (email, password_hash, created_at)
     VALUES ($1, $2, $3)
     RETURNING id, email, created_at`,
    [email.toLowerCase().trim(), passwordHash, now]
  );
  return result.rows[0];
}

async function findByEmail(email) {
  const result = await pool.query(
    `SELECT id, email, password_hash, created_at FROM users WHERE email = $1`,
    [email.toLowerCase().trim()]
  );
  return result.rows[0] || null;
}

async function findById(id) {
  const result = await pool.query(
    `SELECT id, email, created_at FROM users WHERE id = $1`,
    [id]
  );
  return result.rows[0] || null;
}

module.exports = { createUser, findByEmail, findById };