import { Router } from 'express';
import config from '../config.js';
import { getDb } from '../db.js';
import { authenticate, register, signToken, requireAuth } from '../auth.js';
import { asyncRoute, badRequest, id, now, str, validatePassword } from '../util.js';
import { hashPassword, verifyPassword } from '../security.js';

export function authRoutes() {
  const router = Router();

  router.post('/register', asyncRoute(async (req, res) => {
    const { email, password, name } = req.body || {};
    const user = register(email, password, name);
    res.status(201).json({ user: publicUser(user), token: signToken(user) });
  }));

  router.post('/login', asyncRoute(async (req, res) => {
    const { email, password } = req.body || {};
    const user = authenticate(email, password);
    res.json({ user: publicUser(user), token: signToken(user) });
  }));

  router.get('/me', requireAuth, asyncRoute(async (req, res) => {
    const team = getDb().prepare('SELECT * FROM teams WHERE id = ?').get(req.user.team_id);
    res.json({ user: publicUser(req.user), team: team || null, signupEnabled: config.allowSignup });
  }));

  router.post('/password', requireAuth, asyncRoute(async (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    if (!validatePassword(newPassword)) throw badRequest('password_too_short');
    if (!verifyPassword(currentPassword, req.user.password_hash)) throw badRequest('invalid_current_password');
    getDb().prepare('UPDATE users SET password_hash = ?, token_version = COALESCE(token_version,0) + 1, updated_at = ? WHERE id = ?')
      .run(hashPassword(newPassword), now(), req.user.id);
    const user = getDb().prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    res.json({ token: signToken(user) });
  }));

  return router;
}

export function publicUser(user) {
  return { id: user.id, email: user.email, name: user.name, role: user.role, teamId: user.team_id, createdAt: user.created_at, lastLogin: user.last_login };
}
