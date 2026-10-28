/**
 * End-to-end test for the Swapify Tasks backend (auth + tasks).
 * Requires ./server.js (which starts listening + inits schema on import),
 * then exercises register, login, token protection, and all task features.
 */

const http = require('http');
const assert = require('assert');

process.env.PORT = process.env.PORT || '3002';
process.env.PGDATABASE = process.env.PGDATABASE || 'swapify';
process.env.PGPASSWORD = process.env.PGPASSWORD || 'postgres';

require('./server.js'); // boots server + schema

const BASE = `http://localhost:${process.env.PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function request(method, pathname, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (data) headers['Content-Length'] = Buffer.byteLength(data);
    const req = http.request(
      `${BASE}${pathname}`,
      { method, headers },
      (res) => {
        let out = '';
        res.on('data', (c) => (out += c));
        res.on('end', () => {
          let json = null;
          try {
            json = out ? JSON.parse(out) : null;
          } catch (_) {
            json = out;
          }
          resolve({ status: res.statusCode, body: json });
        });
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// Clean DB between runs (truncate tasks + users so each run starts fresh).
async function cleanDb() {
  const { pool } = require('./db');
  await pool.query('TRUNCATE tasks, users RESTART IDENTITY CASCADE');
}

async function run() {
  await sleep(500);
  await cleanDb();

  console.log('== Register ==');
  const email = `user${Date.now()}@example.com`;
  const reg = await request('POST', '/api/auth/register', {
    email,
    password: 'secret123',
  });
  assert.strictEqual(reg.status, 201, 'register returns 201');
  assert.ok(reg.body.token, 'token returned');
  assert.strictEqual(reg.body.user.email, email);
  const token = reg.body.token;

  // Duplicate email -> 409
  const dup = await request('POST', '/api/auth/register', {
    email,
    password: 'secret123',
  });
  assert.strictEqual(dup.status, 409);

  // Invalid email -> 400
  const badEmail = await request('POST', '/api/auth/register', {
    email: 'not-an-email',
    password: 'secret123',
  });
  assert.strictEqual(badEmail.status, 400);

  // Short password -> 400
  const badPw = await request('POST', '/api/auth/register', {
    email: 'other@example.com',
    password: '123',
  });
  assert.strictEqual(badPw.status, 400);

  console.log('== Login ==');
  const login = await request('POST', '/api/auth/login', {
    email,
    password: 'secret123',
  });
  assert.strictEqual(login.status, 200);
  assert.ok(login.body.token);

  const loginBad = await request('POST', '/api/auth/login', {
    email,
    password: 'wrongpassword',
  });
  assert.strictEqual(loginBad.status, 401);

  console.log('== Token protection ==');
  const noAuth = await request('GET', '/api/tasks');
  assert.strictEqual(noAuth.status, 401, 'tasks without token -> 401');

  // Garbage token -> 401
  const badToken = await request('GET', '/api/tasks', null, 'garbage.token.here');
  assert.strictEqual(badToken.status, 401);

  console.log('== Tasks (user-scoped) ==');
  const c1 = await request('POST', '/api/tasks', { title: 'Write report' }, token);
  assert.strictEqual(c1.status, 201);
  const id1 = c1.body.task.id;
  const c2 = await request('POST', '/api/tasks', { title: 'Buy groceries' }, token);
  const id2 = c2.body.task.id;
  const c3 = await request('POST', '/api/tasks', { title: 'Write tests' }, token);
  const id3 = c3.body.task.id;

  const list = await request('GET', '/api/tasks', null, token);
  assert.strictEqual(list.body.count, 3);

  console.log('== Mark complete / incomplete ==');
  await request('PATCH', `/api/tasks/${id1}/status`, { completed: true }, token);
  await request('PATCH', `/api/tasks/${id2}/status`, { completed: true }, token);

  const completed = await request('GET', '/api/tasks?filter=completed', null, token);
  assert.strictEqual(completed.body.count, 2);
  const incomplete = await request('GET', '/api/tasks?filter=incomplete', null, token);
  assert.strictEqual(incomplete.body.count, 1);

  console.log('== Edit ==');
  const edit = await request(
    'PATCH',
    `/api/tasks/${id1}`,
    { title: 'Write final report', description: 'updated' },
    token
  );
  assert.strictEqual(edit.body.task.title, 'Write final report');

  console.log('== Search + filter combined ==');
  const combo = await request('GET', '/api/tasks?search=write&filter=completed', null, token);
  // id1 "Write final report" is completed, id3 "Write tests" is incomplete.
  assert.strictEqual(combo.body.count, 1);
  assert.strictEqual(combo.body.tasks[0].id, id1);

  console.log('== Isolation between users ==');
  const reg2 = await request('POST', '/api/auth/register', {
    email: `user2${Date.now()}@example.com`,
    password: 'secret123',
  });
  const token2 = reg2.body.token;
  const list2 = await request('GET', '/api/tasks', null, token2);
  assert.strictEqual(list2.body.count, 0, 'user2 sees no tasks from user1');

  console.log('== Delete ==');
  const del = await request('DELETE', `/api/tasks/${id3}`, null, token);
  assert.strictEqual(del.status, 200);
  const afterDel = await request('GET', '/api/tasks', null, token);
  assert.strictEqual(afterDel.body.count, 2);
  // Delete by wrong user -> 404
  const delByOther = await request('DELETE', `/api/tasks/${id1}`, null, token2);
  assert.strictEqual(delByOther.status, 404);

  console.log('\nALL AUTH + TASK TESTS PASSED ✓');
  process.exit(0);
}

run().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});