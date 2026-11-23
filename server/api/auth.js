// .light — extended authentication API with verification, recovery, and sessions.
import { Router } from 'express';
import crypto from 'crypto';
import config from '../config.js';
import { getDb } from '../db.js';
import { requireAuth, signToken, authenticate, register } from '../auth.js';
import { asyncRoute, badRequest, unauthorized, forbidden, notFound, validateEmail, validatePassword, id, now, str } from '../util.js';
import { emailEnabled, sendEmail } from '../email/service.js';
import { verificationEmail, passwordResetEmail, welcomeEmail } from '../email/templates.js';

const pub = (u) => ({ id: u.id, email: u.email, name: u.name, username: u.username, role: u.role, teamId: u.team_id, emailVerified: !!u.email_verified, createdAt: u.created_at });

function token() { return crypto.randomBytes(32).toString('hex'); }
function hashToken(t) { return crypto.createHash('sha256').update(t).digest('hex'); }

function baseUrl(req) {
  return `${req.protocol}://${req.get('host')}`;
}

export function authRoutes() {
  const router = Router();

  router.post('/register', asyncRoute(async (req, res) => {
    const b = req.body || {};
    const user = register(b.email, b.password, b.name || b.username);
    const db = getDb();
    const username = str(b.username || b.name || '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 30);
    if (username) db.prepare('UPDATE users SET username = ?, accept_terms = ? WHERE id = ?').run(username, b.acceptTerms ? 1 : 0, user.id);
    if (b.acceptTerms === false || b.acceptTerms === 'false') {
      // Terms acceptance is required; mark unverified until accepted.
      db.prepare('UPDATE users SET accept_terms = 0 WHERE id = ?').run(user.id);
    }

    let verifyRequired = false;
    if (emailEnabled()) {
      const vtoken = token();
      db.prepare('UPDATE users SET email_verified = 0, verification_token = ?, verification_expires = ? WHERE id = ?')
        .run(hashToken(vtoken), now() + 24 * 3600 * 1000, user.id);
      const link = `${baseUrl(req)}/index.html#/verify?token=${vtoken}`;
      sendEmail(verificationEmail(link, config.brand.product)).catch(() => {});
      verifyRequired = true;
    } else {
      // Email disabled: verification is optional and login works immediately.
      sendEmail(welcomeEmail(config.brand.product)).catch(() => {});
    }
    const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    res.status(201).json({ user: pub(fresh), token: signToken(fresh), verifyRequired, emailEnabled: emailEnabled() });
  }));

  router.post('/verify', asyncRoute(async (req, res) => {
    const t = str(req.body?.token, 200);
    if (!t) throw badRequest('token_required');
    const user = getDb().prepare('SELECT * FROM users WHERE verification_token = ? AND verification_expires > ?').get(hashToken(t), now());
    if (!user) throw badRequest('invalid_or_expired_token');
    getDb().prepare('UPDATE users SET email_verified = 1, verification_token = NULL, verification_expires = NULL WHERE id = ?').run(user.id);
    res.json({ ok: true, emailVerified: true });
  }));

  router.post('/resend-verification', requireAuth, asyncRoute(async (req, res) => {
    if (!emailEnabled()) return res.json({ ok: false, reason: 'email_disabled' });
    if (req.user.email_verified) return res.json({ ok: true, alreadyVerified: true });
    const t = token();
    getDb().prepare('UPDATE users SET verification_token = ?, verification_expires = ? WHERE id = ?').run(hashToken(t), now() + 3600000, req.user.id);
    const link = `${baseUrl(req)}/index.html#/verify?token=${t}`;
    const r = await sendEmail(verificationEmail(link, config.brand.product));
    res.json({ ok: r.delivered === true, reason: r.delivered ? undefined : r.error });
  }));

  router.post('/login', asyncRoute(async (req, res) => {
    const { email, password } = req.body || {};
    const db = getDb();
    const identity = String(email || '').toLowerCase().trim();
    const user = db.prepare('SELECT * FROM users WHERE email = ? OR lower(username) = ?').get(identity, identity);
    if (user && user.locked_until && user.locked_until > now()) throw unauthorized('This account is temporarily locked. Try again later or contact support.');
    let authed;
    try { authed = authenticate(email, password); }
    catch (error) {
      if (user) {
        const fails = (user.failed_logins || 0) + 1;
        const lock = fails >= 5 ? now() + 15 * 60000 : null;
        db.prepare('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?').run(fails, lock, user.id);
      }
      throw error;
    }
    db.prepare('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?').run(authed.id);
    const sid = id('ses');
    db.prepare('INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, last_seen, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(sid, authed.id, hashToken(signToken(authed)), now(), now() + 24 * 3600000, now(), req.ip || '', str(req.headers['user-agent'], 300));
    res.json({ user: pub(authed), token: signToken(authed), sessionId: sid });
  }));

  router.post('/logout', requireAuth, asyncRoute(async (req, res) => {
    getDb().prepare('UPDATE users SET token_version = COALESCE(token_version,0) + 1 WHERE id = ?').run(req.user.id);
    getDb().prepare('DELETE FROM sessions WHERE user_id = ?').run(req.user.id);
    res.json({ ok: true });
  }));

  router.post('/forgot-password', asyncRoute(async (req, res) => {
    const identity = String(req.body?.email || '').toLowerCase().trim();
    if (!identity) throw badRequest('invalid_identity');
    const user = getDb().prepare('SELECT * FROM users WHERE email = ? OR lower(username) = ?').get(identity, identity);
    const email = user?.email || identity;
    // Always respond generically to avoid account enumeration.
    if (!user) return res.json({ ok: true, emailEnabled: emailEnabled() });
    if (!emailEnabled()) {
      return res.json({ ok: false, reason: 'email_disabled', message: 'Contact your administrator for assisted password recovery.' });
    }
    const t = token();
    getDb().prepare('UPDATE users SET reset_token = ?, reset_expires = ? WHERE id = ?').run(hashToken(t), now() + 1800000, user.id);
    const link = `${baseUrl(req)}/index.html#/reset?token=${t}`;
    const r = await sendEmail(passwordResetEmail(link, config.brand.product));
    res.json({ ok: r.delivered === true, emailEnabled: true, reason: r.delivered ? undefined : r.error });
  }));

  router.post('/reset-password', asyncRoute(async (req, res) => {
    const t = str(req.body?.token, 200);
    const password = req.body?.password;
    if (!validatePassword(password)) throw badRequest('password_too_short');
    const user = getDb().prepare('SELECT * FROM users WHERE reset_token = ? AND reset_expires > ?').get(hashToken(t), now());
    if (!user) throw badRequest('invalid_or_expired_token');
    const { hashPassword } = await import('../security.js');
    getDb().prepare('UPDATE users SET password_hash = ?, reset_token = NULL, reset_expires = NULL, failed_logins = 0, locked_until = NULL, token_version = COALESCE(token_version,0)+1 WHERE id = ?')
      .run(hashPassword(password), user.id);
    res.json({ ok: true });
  }));

  router.get('/me', requireAuth, asyncRoute(async (req, res) => {
    const u = req.user;
    res.json({ user: pub(u), emailEnabled: emailEnabled(), branding: config.brand,
      impersonatedBy: req.impersonatedBy || null, permissions: req.permissions });
  }));

  router.post('/password', requireAuth, asyncRoute(async (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    if (!validatePassword(newPassword)) throw badRequest('password_too_short');
    const { verifyPassword, hashPassword } = await import('../security.js');
    if (!verifyPassword(currentPassword, req.user.password_hash)) throw badRequest('invalid_current_password');
    getDb().prepare('UPDATE users SET password_hash = ?, token_version = COALESCE(token_version,0)+1, updated_at = ? WHERE id = ?')
      .run(hashPassword(newPassword), now(), req.user.id);
    const fresh = getDb().prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    res.json({ token: signToken(fresh) });
  }));

  router.patch('/profile', requireAuth, asyncRoute(async (req, res) => {
    const b = req.body || {};
    const updates = []; const values = [];
    if (b.name !== undefined) { updates.push('name = ?'); values.push(str(b.name, 80)); }
    if (b.username !== undefined) { updates.push('username = ?'); values.push(str(b.username, 30).toLowerCase().replace(/[^a-z0-9_]/g, '')); }
    if (b.theme !== undefined && ['dark','light'].includes(b.theme)) { updates.push('theme = ?'); values.push(b.theme); }
    if (b.notificationsEnabled !== undefined) { updates.push('notifications_enabled = ?'); values.push(b.notificationsEnabled ? 1 : 0); }
    if (updates.length) { values.push(now(), req.user.id); getDb().prepare(`UPDATE users SET ${updates.join(', ')}, updated_at = ? WHERE id = ?`).run(...values); }
    res.json({ user: pub(getDb().prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)) });
  }));

  router.get('/sessions', requireAuth, asyncRoute(async (req, res) => {
    res.json({ sessions: getDb().prepare('SELECT id, created_at, expires_at, last_seen, ip, user_agent FROM sessions WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id) });
  }));

  router.delete('/sessions/:id', requireAuth, asyncRoute(async (req, res) => {
    getDb().prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
    res.json({ ok: true });
  }));

  router.delete('/account', requireAuth, asyncRoute(async (req, res) => {
    const confirm = str(req.body?.confirm, 50);
    if (confirm !== 'DELETE') throw badRequest('confirmation_required');
    const db = getDb();
    db.transaction(() => {
      // Only remove the requesting user. Never destroy a shared workspace.
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(req.user.id);
      db.prepare('DELETE FROM team_members WHERE user_id = ?').run(req.user.id);
      db.prepare('DELETE FROM notifications WHERE user_id = ?').run(req.user.id);
      db.prepare('DELETE FROM two_factor WHERE user_id = ?').run(req.user.id);
      db.prepare("UPDATE support_tickets SET status = 'closed' WHERE user_id = ?").run(req.user.id);
      db.prepare('DELETE FROM users WHERE id = ?').run(req.user.id);
      // A sole owner leaving dissolves their own workspace; shared ones persist.
      const remaining = db.prepare('SELECT COUNT(*) AS c FROM team_members WHERE team_id = ?').get(req.teamId).c;
      if (remaining === 0) {
        const instances = db.prepare('SELECT id FROM instances WHERE team_id = ?').all(req.teamId).map((r) => r.id);
        for (const iid of instances) {
          for (const t of ['deployments','logs','metric_samples','backups','schedules','domains','node_commands']) {
            try { db.prepare(`DELETE FROM ${t} WHERE instance_id = ?`).run(iid); } catch {}
          }
        }
        db.prepare('DELETE FROM instances WHERE team_id = ?').run(req.teamId);
        db.prepare('DELETE FROM teams WHERE id = ?').run(req.teamId);
      }
    })();
    res.json({ ok: true });
  }));

  return router;
}
