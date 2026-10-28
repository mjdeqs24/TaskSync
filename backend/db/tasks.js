/**
 * Task data-access layer (PostgreSQL). All queries are scoped to a user_id
 * so users only ever see and modify their own tasks.
 */

const { pool } = require('../db');

async function createTask(userId, title, description) {
  const now = Date.now();
  const result = await pool.query(
    `INSERT INTO tasks (user_id, title, description, completed, created_at, updated_at)
     VALUES ($1, $2, $3, FALSE, $4, $5)
     RETURNING id, user_id, title, description, completed, created_at, updated_at`,
    [userId, title, description, now, now]
  );
  return result.rows[0];
}

// Search + filter combined, scoped to the user.
async function listTasks(userId, { search, filter }) {
  const conditions = ['user_id = $1'];
  const params = [userId];
  let idx = 2;

  const status = (filter || 'all').toString().toLowerCase();
  if (status === 'completed') {
    conditions.push(`completed = $${idx++}`);
    params.push(true);
  } else if (status === 'incomplete') {
    conditions.push(`completed = $${idx++}`);
    params.push(false);
  }

  const term = (search || '').toString().trim();
  if (term) {
    conditions.push(`LOWER(title) LIKE $${idx++}`);
    params.push(`%${term.toLowerCase()}%`);
  }

  const where = conditions.join(' AND ');
  const result = await pool.query(
    `SELECT id, user_id, title, description, completed, created_at, updated_at
     FROM tasks
     WHERE ${where}
     ORDER BY created_at DESC`,
    params
  );
  return result.rows;
}

async function findById(userId, taskId) {
  const result = await pool.query(
    `SELECT id, user_id, title, description, completed, created_at, updated_at
     FROM tasks WHERE user_id = $1 AND id = $2`,
    [userId, taskId]
  );
  return result.rows[0] || null;
}

// Update title/description/completed. Returns the updated row or null.
async function updateTask(userId, taskId, fields) {
  const sets = [];
  const params = [userId, taskId];
  let idx = 3;

  if (fields.title !== undefined) {
    sets.push(`title = $${idx++}`);
    params.push(fields.title);
  }
  if (fields.description !== undefined) {
    sets.push(`description = $${idx++}`);
    params.push(fields.description);
  }
  if (fields.completed !== undefined) {
    sets.push(`completed = $${idx++}`);
    params.push(fields.completed);
  }
  sets.push(`updated_at = $${idx++}`);
  params.push(Date.now());

  if (sets.length === 1) return null; // only updated_at — nothing to change

  const result = await pool.query(
    `UPDATE tasks SET ${sets.join(', ')}
     WHERE user_id = $1 AND id = $2
     RETURNING id, user_id, title, description, completed, created_at, updated_at`,
    params
  );
  return result.rows[0] || null;
}

async function deleteTask(userId, taskId) {
  const result = await pool.query(
    `DELETE FROM tasks WHERE user_id = $1 AND id = $2
     RETURNING id, user_id, title, description, completed, created_at, updated_at`,
    [userId, taskId]
  );
  return result.rows[0] || null;
}

module.exports = { createTask, listTasks, findById, updateTask, deleteTask };