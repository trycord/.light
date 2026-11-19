import jwt from 'jsonwebtoken';
import config from './config.js';
import { getDb } from './db.js';
import { verifyPassword, hashPassword } from './security.js';
import { unauthorized, forbidden, badRequest, validateEmail, validatePassword, id, now } from './util.js';

const AUDIENCE = 'trycord-light';
const ISSUER = 'trycord-light';

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role, teamId: user.team_id, tv: user.token_version || 0 },
    config.jwtSecret,
    { expiresIn: '24h', audience: AUDIENCE, issuer: ISSUER }
  );
}

export function verifyToken(token) {
  return jwt.verify(token, config.jwtSecret, { audience: AUDIENCE, issuer: ISSUER });
}

function bearer(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

export function nodeToken(req) {
  return req.headers['x-node-token'] || bearer(req);
}

export function requireAuth(req, res, next) {
  try {
    const token = bearer(req);
    if (!token) throw unauthorized();
    const payload = verifyToken(token);
    const user = getDb().prepare('SELECT * FROM users WHERE id = ? AND status = ?').get(payload.sub, 'active');
    if (!user) throw unauthorized();
    if ((payload.tv || 0) !== (user.token_version || 0)) throw unauthorized('session_expired');
    req.user = user;
    req.teamId = user.team_id;
    next();
  } catch (error) { next(error); }
}

export function requireAdmin(req, res, next) {
  requireAuth(req, res, (error) => {
    if (error) return next(error);
    if (req.user.role !== 'admin') return next(forbidden('admin_required'));
    next();
  });
}

export function requireNode(req, res, next) {
  try {
    const token = nodeToken(req);
    if (!token) throw unauthorized('node_token_required');
    const node = getDb().prepare('SELECT * FROM nodes WHERE token = ?').get(token);
    if (!node) throw unauthorized('invalid_node_token');
    req.node = node;
    next();
  } catch (error) { next(error); }
}

export function requireTeamMember(req, res, next) {
  requireAuth(req, res, (error) => {
    if (error) return next(error);
    const teamId = req.params.teamId || req.body?.teamId || req.query.teamId || req.teamId;
    const member = getDb().prepare('SELECT role FROM team_members WHERE team_id = ? AND user_id = ?').get(teamId, req.user.id);
    if (!member && req.user.role !== 'admin') return next(forbidden());
    req.teamId = teamId;
    req.memberRole = member?.role || (req.user.role === 'admin' ? 'owner' : undefined);
    next();
  });
}

export function authenticate(email, password) {
  if (!validateEmail(email)) throw badRequest('invalid_email');
  const user = getDb().prepare('SELECT * FROM users WHERE email = ?').get(String(email).toLowerCase());
  if (!user || user.status !== 'active' || !verifyPassword(password, user.password_hash)) throw unauthorized('invalid_credentials');
  getDb().prepare('UPDATE users SET last_login = ? WHERE id = ?').run(now(), user.id);
  return user;
}

export function register(email, password, name) {
  if (!validateEmail(email)) throw badRequest('invalid_email');
  if (!validatePassword(password)) throw badRequest('password_too_short');
  if (!config.allowSignup) throw forbidden('signup_disabled');
  const normalized = String(email).toLowerCase();
  const db = getDb();
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(normalized)) throw conflictError('email_exists');
  const userCount = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  const role = userCount === 0 ? 'admin' : 'user';
  const ts = now();
  const uid = id('usr');
  const teamId = id('team');
  const teamName = name ? `${String(name).slice(0, 60)}'s workspace` : 'My workspace';
  db.transaction(() => {
    db.prepare('INSERT INTO teams (id, name, owner_id, plan_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(teamId, teamName, uid, 'free', ts, ts);
    db.prepare('INSERT INTO users (id, email, name, password_hash, role, team_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(uid, normalized, String(name || '').slice(0, 80), hashPassword(password), role, teamId, ts, ts);
    db.prepare('INSERT INTO team_members (team_id, user_id, role, created_at) VALUES (?, ?, ?, ?)').run(teamId, uid, 'owner', ts);
  })();
  return db.prepare('SELECT * FROM users WHERE id = ?').get(uid);
}

function conflictError(message) { const e = unauthorized(message); e.status = 409; return e; }
