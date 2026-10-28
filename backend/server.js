/**
 * Swapify Tasks Backend (with Authentication)
 * ------------------------------------------
 * Zero-dependency Node.js HTTP server (only the `pg` driver) providing a
 * REST API for task management with user registration & login.
 *
 * Features:
 *   Auth:  Register, Login (PostgreSQL-backed, scrypt password hashing,
 *          HMAC-signed JWT tokens)
 *   Tasks: 1. Add  2. Mark complete/incomplete  3. Edit  4. Delete
 *          5. Search (by title)  6. Filter (all|completed|incomplete),
 *          where search + filter compose.
 *
 * All task routes require a valid Bearer token; tasks are scoped per user.
 */

const http = require('http');
const crypto = require('crypto');
const config = require('./config');
const { pool, initSchema } = require('./db');
const auth = require('./auth');
const usersDb = require('./db/users');
const tasksDb = require('./db/tasks');

const PORT = config.port;

/* ----------------------------- Helpers ----------------------------- */

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendError(res, statusCode, message) {
  sendJson(res, statusCode, { error: message });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (_) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

// Wrap an async handler; injects req.user after auth check.
function withAuth(handler) {
  return (req, res) =>
    auth.authenticate(req, res, () => handler(req, res, req.user));
}

function publicUser(row) {
  return { id: row.id, email: row.email, createdAt: row.created_at };
}

/* ----------------------------- Router ----------------------------- */

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;
  const method = req.method.toUpperCase();

  try {
    // ----- Health -----
    if (pathname === '/' && method === 'GET') {
      return sendJson(res, 200, { message: 'Swapify Tasks API is running.' });
    }

    // ----- POST /api/auth/register -----
    if (pathname === '/api/auth/register' && method === 'POST') {
      const body = await readBody(req);
      const email = (body.email || '').toString().trim().toLowerCase();
      const password = body.password || '';

      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return sendError(res, 400, 'A valid email is required.');
      }
      if (!password || password.length < 6) {
        return sendError(res, 400, 'Password must be at least 6 characters.');
      }
      const existing = await usersDb.findByEmail(email);
      if (existing) {
        return sendError(res, 409, 'An account with this email already exists.');
      }
      const passwordHash = auth.hashPassword(password);
      const user = await usersDb.createUser(email, passwordHash);
      const token = auth.sign({ sub: user.id, email: user.email });
      return sendJson(res, 201, { token, user: publicUser(user) });
    }

    // ----- POST /api/auth/login -----
    if (pathname === '/api/auth/login' && method === 'POST') {
      const body = await readBody(req);
      const email = (body.email || '').toString().trim().toLowerCase();
      const password = body.password || '';

      const user = await usersDb.findByEmail(email);
      if (!user || !auth.verifyPassword(password, user.password_hash)) {
        return sendError(res, 401, 'Invalid email or password.');
      }
      const token = auth.sign({ sub: user.id, email: user.email });
      return sendJson(res, 200, { token, user: publicUser(user) });
    }

    // ----- Auth-protected task routes below -----

    // GET /api/tasks?search=&filter=  (search + filter, features 5 & 6)
    if (pathname === '/api/tasks' && method === 'GET') {
      return withAuth(async (req, res, user) => {
        const search = url.searchParams.get('search') || '';
        const filter = url.searchParams.get('filter') || 'all';
        const tasks = await tasksDb.listTasks(user.id, { search, filter });
        return sendJson(res, 200, { tasks, count: tasks.length });
      })(req, res);
    }

    // POST /api/tasks  (feature 1: add a task)
    if (pathname === '/api/tasks' && method === 'POST') {
      return withAuth(async (req, res, user) => {
        const body = await readBody(req);
        const title = (body.title || '').toString().trim();
        const description = (body.description || '').toString();
        if (!title) return sendError(res, 400, 'Task title is required.');
        const task = await tasksDb.createTask(user.id, title, description);
        return sendJson(res, 201, { task });
      })(req, res);
    }

    // PATCH /api/tasks/:id/status  (feature 2: mark complete/incomplete)
    let match = pathname.match(/^\/api\/tasks\/([^/]+)\/status$/);
    if (match && method === 'PATCH') {
      return withAuth(async (req, res, user) => {
        const id = decodeURIComponent(match[1]);
        const body = await readBody(req);
        if (typeof body.completed !== 'boolean') {
          return sendError(res, 400, 'Field "completed" (boolean) is required.');
        }
        const updated = await tasksDb.updateTask(user.id, id, {
          completed: body.completed,
        });
        if (!updated) return sendError(res, 404, 'Task not found.');
        return sendJson(res, 200, { task: updated });
      })(req, res);
    }

    // PATCH /api/tasks/:id  (feature 3: edit task details)
    match = pathname.match(/^\/api\/tasks\/([^/]+)$/);
    if (match && method === 'PATCH') {
      return withAuth(async (req, res, user) => {
        const id = decodeURIComponent(match[1]);
        const body = await readBody(req);
        const fields = {};
        if (body.title !== undefined) {
          const title = body.title.toString().trim();
          if (!title) return sendError(res, 400, 'Task title cannot be empty.');
          fields.title = title;
        }
        if (body.description !== undefined) fields.description = body.description.toString();
        if (typeof body.completed === 'boolean') fields.completed = body.completed;
        const updated = await tasksDb.updateTask(user.id, id, fields);
        if (!updated) return sendError(res, 404, 'Task not found.');
        return sendJson(res, 200, { task: updated });
      })(req, res);
    }

    // DELETE /api/tasks/:id  (feature 4: delete task)
    match = pathname.match(/^\/api\/tasks\/([^/]+)$/);
    if (match && method === 'DELETE') {
      return withAuth(async (req, res, user) => {
        const id = decodeURIComponent(match[1]);
        const removed = await tasksDb.deleteTask(user.id, id);
        if (!removed) return sendError(res, 404, 'Task not found.');
        return sendJson(res, 200, { task: removed, message: 'Task deleted.' });
      })(req, res);
    }

    return sendError(res, 404, 'Not found.');
  } catch (err) {
    if (err.message === 'Invalid JSON body') return sendError(res, 400, 'Invalid JSON body.');
    if (err.message === 'Payload too large') return sendError(res, 413, 'Payload too large.');
    console.error('Unhandled error:', err);
    return sendError(res, 500, 'Internal server error.');
  }
}

/* ----------------------------- Bootstrap ----------------------------- */

async function start() {
  await initSchema();
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method.toUpperCase() === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }
    handleRequest(req, res);
  });

  server.listen(PORT, () => {
    console.log(`Swapify Tasks backend listening on http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

module.exports = { start };