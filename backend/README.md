# Swapify Tasks Backend

A zero-dependency (except the `pg` PostgreSQL driver) Node.js HTTP API for task
management **with user authentication**. Tasks are persisted in PostgreSQL and
scoped per user.

## Features

**Authentication**
- `POST /api/auth/register` — create an account (email + password, scrypt hashing)
- `POST /api/auth/login` — authenticate and receive a signed JWT token

**Task management** (all require a Bearer token)
1. **Add a task** — `POST /api/tasks`
2. **Mark complete / incomplete** — `PATCH /api/tasks/:id/status`
3. **Edit task details** (title, description) — `PATCH /api/tasks/:id`
4. **Delete a task** — `DELETE /api/tasks/:id`
5. **Search** (by title) — `GET /api/tasks?search=term`
6. **Filter** — `GET /api/tasks?filter=all|completed|incomplete`
   - Search and filter compose: `GET /api/tasks?search=term&filter=completed`

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Ensure PostgreSQL is running and create the database (defaults assume a
   `postgres` superuser with password `postgres` and a `swapify` database):
   ```bash
   psql -U postgres -h localhost -c "CREATE DATABASE swapify;"
   psql -U postgres -h localhost -c "ALTER USER postgres WITH PASSWORD 'postgres';"
   ```
3. (Optional) Override connection/credentials via environment variables:
   `PGUSER`, `PGHOST`, `PGDATABASE`, `PGPASSWORD`, `PGPORT`, `JWT_SECRET`, `PORT`.

## Run

```bash
npm start          # http://localhost:3001
npm test           # runs the end-to-end auth + task test suite
```

The schema (users + tasks tables) is created automatically on startup.

## API Reference

### Auth
| Method | Path | Body | Success |
| ------ | ---- | ---- | ------- |
| POST | `/api/auth/register` | `{ email, password }` | 201 `{ token, user }` |
| POST | `/api/auth/login` | `{ email, password }` | 200 `{ token, user }` |

### Tasks (header: `Authorization: Bearer <token>`)
| Method | Path | Body | Success |
| ------ | ---- | ---- | ------- |
| GET | `/api/tasks?search=&filter=` | — | 200 `{ tasks, count }` |
| POST | `/api/tasks` | `{ title, description? }` | 201 `{ task }` |
| PATCH | `/api/tasks/:id` | `{ title?, description?, completed? }` | 200 `{ task }` |
| PATCH | `/api/tasks/:id/status` | `{ completed: boolean }` | 200 `{ task }` |
| DELETE | `/api/tasks/:id` | — | 200 `{ task }` |

## Security notes
- Passwords are hashed with scrypt + per-user salt (Node `crypto`).
- Tokens are self-contained HMAC-SHA256 JWTs (no external lib), expiring after
  `TOKEN_TTL` seconds (default 7 days).
- All task queries are scoped to the authenticated `user_id`; cross-user access
  returns `404`.
- Set a strong `JWT_SECRET` in production.