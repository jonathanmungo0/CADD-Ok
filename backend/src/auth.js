import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { pool } from './config/db.js';

const scrypt = promisify(crypto.scrypt);
const tokenLifetimeSeconds = 60 * 60 * 24 * 7;
const tokenSecret = process.env.AUTH_SECRET || crypto.randomBytes(32).toString('hex');

if (!process.env.AUTH_SECRET) {
  console.warn('AUTH_SECRET is not configured. Authentication tokens will be invalidated when the server restarts.');
}

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derivedKey = await scrypt(password, salt, 64);
  return `${salt.toString('base64url')}:${derivedKey.toString('base64url')}`;
}

export async function verifyPassword(password, passwordHash) {
  if (typeof passwordHash !== 'string') return false;
  const [saltValue, keyValue, extra] = passwordHash.split(':');
  if (!saltValue || !keyValue || extra !== undefined) return false;

  try {
    const salt = Buffer.from(saltValue, 'base64url');
    const expected = Buffer.from(keyValue, 'base64url');
    if (salt.length !== 16 || expected.length !== 64) return false;
    const actual = await scrypt(password, salt, expected.length);
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function createToken(user) {
  const payload = Buffer.from(JSON.stringify({
    sub: user.id,
    exp: Math.floor(Date.now() / 1000) + tokenLifetimeSeconds
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', tokenSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function readToken(token) {
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra !== undefined) return null;

  const expected = crypto.createHmac('sha256', tokenSecret).update(payload).digest();
  const actual = Buffer.from(signature, 'base64url');
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;

  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof claims.sub !== 'string' || !Number.isInteger(claims.exp) || claims.exp <= Date.now() / 1000) return null;
    return claims;
  } catch {
    return null;
  }
}

export function requireAuth(req, res, next) {
  const authorization = req.get('authorization') || '';
  const match = authorization.match(/^Bearer ([^\s]+)$/i);
  const claims = match ? readToken(match[1]) : null;
  if (!claims) return res.status(401).json({ error: 'Sign in to continue.' });

  pool.query(
    `SELECT id,full_name,email,phone,role,farm_name,farm_location,preferred_language,is_active,created_at
     FROM users WHERE id = $1`,
    [claims.sub]
  ).then(({ rows }) => {
    const user = rows[0];
    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'This account is unavailable. Please contact an administrator.' });
    }
    req.user = user;
    next();
  }).catch(error => {
    console.error('Authentication account lookup failed:', error.message);
    res.status(503).json({ error: 'Could not verify your account. Please try again.' });
  });
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'administrator') {
    return res.status(403).json({ error: 'Administrator access is required.' });
  }
  next();
}