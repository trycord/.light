// .light — in-product notification helpers. Notifications are persisted per user
// (or per team broadcast) and never pretend to have been delivered by email.
import { getDb } from './db.js';
import { id, now, str, json } from './util.js';

export const NOTIFICATION_TYPES = Object.freeze(['info', 'success', 'warning', 'danger', 'ticket', 'billing', 'deployment']);

export function createNotification({ userId = null, teamId = null, type = 'info', title, message = '', data = {} }) {
  const db = getDb();
  const nid = id('ntf');
  db.prepare(`INSERT INTO notifications (id, user_id, team_id, type, title, message, data, read, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`)
    .run(nid, userId || null, teamId || null,
      NOTIFICATION_TYPES.includes(type) ? type : 'info',
      str(title, 200), str(message, 2000), JSON.stringify(data || {}), now());
  return db.prepare('SELECT * FROM notifications WHERE id = ?').get(nid);
}

/** Notify a set of user ids. */
export function notifyUsers(userIds, payload) {
  const results = [];
  for (const uid of new Set((userIds || []).filter(Boolean))) results.push(createNotification({ ...payload, userId: uid }));
  return results;
}

/** Notify every member of a team. */
export function notifyTeam(teamId, payload) {
  if (!teamId) return [];
  const users = getDb().prepare('SELECT id FROM users WHERE team_id = ?').all(teamId).map((u) => u.id);
  return notifyUsers(users, { ...payload, teamId });
}

/** Notify every administrator (real admins only, not custom roles). */
export function notifyAdmins(payload) {
  const users = getDb().prepare("SELECT id FROM users WHERE role = 'admin' AND status = 'active'").all();
  return notifyUsers(users.map((u) => u.id), payload);
}

export function unreadCount(userId) {
  return getDb().prepare('SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND read = 0').get(userId).count;
}

export function viewNotification(n) {
  return { id: n.id, userId: n.user_id, teamId: n.team_id, type: n.type, title: n.title,
    message: n.message, data: json(n.data, {}), read: !!n.read, createdAt: n.created_at };
}
