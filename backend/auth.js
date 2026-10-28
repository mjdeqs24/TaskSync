/**
 * Authentication helpers: password hashing (scrypt, built-in crypto),
 * signed token issuance/verification (HMAC-SHA256, self-contained, no deps),
 * and an Express-style Express-less auth middleware.
 */

const crypto = require('crypto');
const config = require('./config');

/* --------------------------- Password hashing --------------------------- */

// Hash a password with a random salt: "salt:hash" (both hex, 64-byte key).
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

// Constant-time comparison of a plaintext password against a stored hash.
function verifyPassword(password, stored) {
  const [salt, hash] = (stored || '').split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return crypto.timingSafeEqual(candidate, expected);
}

/* ----------------------------- Token (JWT) ----------------------------- */

// Minimal, dependency-free JWT: header.payload.signature (HMAC-SHA256).
function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function sign(data) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    ...data,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + config.tokenTtl,
  };
  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto
    .createHmac('sha256', config.jwtSecret)
    .update(signingInput)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${signingInput}.${signature}`;
}

function verify(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [encodedHeader, encodedPayload, signature] = parts;
  const expectedSig = crypto
    .createHmac('sha256', config.jwtSecret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  // Timing-safe signature comparison.
  const a = Buffer.from(signature);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64').toString('utf-8'));
  } catch (_) {
    return null;
  }
  if (!payload.exp || payload.exp * 1000 < Date.now()) return null;
  return payload;
}

/* ------------------------------ Middleware ------------------------------ */

// Attaches req.user = { id, email } when a valid Bearer token is present.
function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return sendUnauthorized(res);
  }
  const payload = verify(match[1]);
  if (!payload) {
    return sendUnauthorized(res);
  }
  req.user = { id: payload.sub, email: payload.email };
  next();
}

function sendUnauthorized(res) {
  res.writeHead(401, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Unauthorized' }));
}

module.exports = { hashPassword, verifyPassword, sign, verify, authenticate };