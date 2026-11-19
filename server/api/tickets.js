// .light — support tickets: customer-facing and administration APIs.
import { Router } from 'express';
import { getDb } from '../db.js';
import { requireAuth, requireAdmin } from '../auth.js';
import { requirePermission } from '../permissions.js';
import { asyncRoute, badRequest, notFound, str, id, now } from '../util.js';
import { audit } from '../audit.js';
import { createNotification, notifyAdmins, notifyUsers } from '../notifications.js';

const CATEGORIES = ['general', 'billing', 'technical', 'account', 'feature'];
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const STATUSES = ['open', 'pending', 'closed'];

const view = (t) => ({
  id: t.id, teamId: t.team_id, userId: t.user_id, subject: t.subject, category: t.category,
  priority: t.priority, status: t.status, assignedTo: t.assigned_to || null,
  createdAt: t.created_at, updatedAt: t.updated_at, closedAt: t.closed_at || null,
});

function ticketWithMessages(t) {
  const messages = getDb().prepare('SELECT * FROM support_ticket_messages WHERE ticket_id = ? ORDER BY created_at, id').all(t.id)
    .map((m) => ({ id: m.id, userId: m.user_id, message: m.message, isStaff: !!m.is_staff, createdAt: m.created_at,
      author: getDb().prepare('SELECT name, email FROM users WHERE id = ?').get(m.user_id) || null }));
  return { ...view(t), messages };
}

function assertAccess(req, t) {
  if (req.user.role !== 'admin' && t.team_id !== req.teamId) throw notFound();
}

function addMessage(ticketId, userId, message, isStaff) {
  const mid = id('msg');
  getDb().prepare('INSERT INTO support_ticket_messages (id, ticket_id, user_id, message, is_staff, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(mid, ticketId, userId, str(message, 8000), isStaff ? 1 : 0, now());
  getDb().prepare('UPDATE support_tickets SET updated_at = ? WHERE id = ?').run(now(), ticketId);
  return mid;
}

export function ticketsRoutes() {
  const router = Router();
  router.use(requireAuth);

  router.get('/', asyncRoute(async (req, res) => {
    // Administrators can opt into seeing every ticket with ?all=true.
    const all = req.query.all === 'true' && req.user.role === 'admin';
    const rows = all
      ? getDb().prepare('SELECT t.*, u.email AS user_email FROM support_tickets t LEFT JOIN users u ON u.id = t.user_id ORDER BY t.updated_at DESC LIMIT 300').all()
      : getDb().prepare('SELECT t.*, u.email AS user_email FROM support_tickets t LEFT JOIN users u ON u.id = t.user_id WHERE t.team_id = ? ORDER BY t.updated_at DESC LIMIT 300').all(req.teamId);
    res.json({ tickets: rows.map((t) => ({ ...view(t), userEmail: t.user_email,
      messageCount: getDb().prepare('SELECT COUNT(*) AS c FROM support_ticket_messages WHERE ticket_id = ?').get(t.id).c })) });
  }));

  router.post('/', asyncRoute(async (req, res) => {
    const b = req.body || {};
    const subject = str(b.subject, 200).trim();
    const message = str(b.message, 8000).trim();
    if (!subject || !message) throw badRequest('subject_and_message_required');
    const category = CATEGORIES.includes(b.category) ? b.category : 'general';
    const priority = PRIORITIES.includes(b.priority) ? b.priority : 'normal';
    const tid = id('tkt'); const ts = now();
    getDb().prepare(`INSERT INTO support_tickets (id, team_id, user_id, subject, category, priority, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)`).run(tid, req.teamId, req.user.id, subject, category, priority, ts, ts);
    addMessage(tid, req.user.id, message, false);
    notifyAdmins({ type: 'ticket', title: 'New support ticket', message: subject, data: { ticketId: tid } });
    audit(req, 'support.ticket.create', 'ticket', tid, { subject, category });
    res.status(201).json({ ticket: ticketWithMessages(getDb().prepare('SELECT * FROM support_tickets WHERE id = ?').get(tid)) });
  }));

  router.get('/:id', asyncRoute(async (req, res) => {
    const t = getDb().prepare('SELECT * FROM support_tickets WHERE id = ?').get(req.params.id);
    if (!t) throw notFound();
    assertAccess(req, t);
    res.json({ ticket: ticketWithMessages(t) });
  }));

  router.post('/:id/messages', asyncRoute(async (req, res) => {
    const t = getDb().prepare('SELECT * FROM support_tickets WHERE id = ?').get(req.params.id);
    if (!t) throw notFound();
    assertAccess(req, t);
    if (t.status === 'closed') throw badRequest('ticket_closed');
    const message = str(req.body?.message, 8000).trim();
    if (!message) throw badRequest('message_required');
    const isStaff = req.user.role === 'admin';
    addMessage(t.id, req.user.id, message, isStaff);
    if (isStaff) {
      notifyUsers([t.user_id], { type: 'ticket', title: 'Support reply', message: t.subject, data: { ticketId: t.id }, teamId: t.team_id });
    } else {
      notifyAdmins({ type: 'ticket', title: 'New ticket reply', message: t.subject, data: { ticketId: t.id } });
    }
    audit(req, 'support.ticket.reply', 'ticket', t.id, { isStaff });
    res.status(201).json({ ticket: ticketWithMessages(getDb().prepare('SELECT * FROM support_tickets WHERE id = ?').get(t.id)) });
  }));

  router.patch('/:id', asyncRoute(async (req, res) => {
    const t = getDb().prepare('SELECT * FROM support_tickets WHERE id = ?').get(req.params.id);
    if (!t) throw notFound();
    assertAccess(req, t);
    const status = req.body?.status;
    if (!STATUSES.includes(status)) throw badRequest('invalid_status');
    getDb().prepare('UPDATE support_tickets SET status = ?, closed_at = ?, updated_at = ? WHERE id = ?')
      .run(status, status === 'closed' ? now() : null, now(), t.id);
    audit(req, 'support.ticket.status', 'ticket', t.id, { status });
    res.json({ ticket: ticketWithMessages(getDb().prepare('SELECT * FROM support_tickets WHERE id = ?').get(t.id)) });
  }));

  return router;
}

export function adminTicketRoutes() {
  const router = Router();
  router.use(requireAdmin, requirePermission('tickets.read'));

  router.get('/', asyncRoute(async (req, res) => {
    const status = req.query.status;
    const rows = STATUSES.includes(status)
      ? getDb().prepare('SELECT t.*, u.email AS user_email FROM support_tickets t LEFT JOIN users u ON u.id = t.user_id WHERE t.status = ? ORDER BY t.updated_at DESC LIMIT 500').all(status)
      : getDb().prepare('SELECT t.*, u.email AS user_email FROM support_tickets t LEFT JOIN users u ON u.id = t.user_id ORDER BY t.updated_at DESC LIMIT 500').all();
    res.json({ tickets: rows.map((t) => ({ ...view(t), userEmail: t.user_email,
      messageCount: getDb().prepare('SELECT COUNT(*) AS c FROM support_ticket_messages WHERE ticket_id = ?').get(t.id).c })) });
  }));

  router.get('/:id', asyncRoute(async (req, res) => {
    const t = getDb().prepare('SELECT * FROM support_tickets WHERE id = ?').get(req.params.id);
    if (!t) throw notFound();
    res.json({ ticket: ticketWithMessages(t) });
  }));

  router.patch('/:id', requirePermission('tickets.write'), asyncRoute(async (req, res) => {
    const t = getDb().prepare('SELECT * FROM support_tickets WHERE id = ?').get(req.params.id);
    if (!t) throw notFound();
    const b = req.body || {}; const sets = []; const values = [];
    if (b.status !== undefined) {
      if (!STATUSES.includes(b.status)) throw badRequest('invalid_status');
      sets.push('status = ?'); values.push(b.status);
      sets.push('closed_at = ?'); values.push(b.status === 'closed' ? now() : null);
    }
    if (b.priority !== undefined) { if (!PRIORITIES.includes(b.priority)) throw badRequest('invalid_priority'); sets.push('priority = ?'); values.push(b.priority); }
    if (b.category !== undefined) { if (!CATEGORIES.includes(b.category)) throw badRequest('invalid_category'); sets.push('category = ?'); values.push(b.category); }
    if (b.assignedTo !== undefined) { sets.push('assigned_to = ?'); values.push(str(b.assignedTo, 100) || null); }
    if (sets.length) { sets.push('updated_at = ?'); values.push(now(), t.id); getDb().prepare(`UPDATE support_tickets SET ${sets.join(', ')} WHERE id = ?`).run(...values); }
    if (b.status && b.status !== t.status) notifyUsers([t.user_id], { type: 'ticket', title: `Ticket ${b.status}`, message: t.subject, data: { ticketId: t.id }, teamId: t.team_id });
    audit(req, 'admin.ticket.update', 'ticket', t.id, b);
    res.json({ ticket: ticketWithMessages(getDb().prepare('SELECT * FROM support_tickets WHERE id = ?').get(t.id)) });
  }));

  router.post('/:id/messages', requirePermission('tickets.write'), asyncRoute(async (req, res) => {
    const t = getDb().prepare('SELECT * FROM support_tickets WHERE id = ?').get(req.params.id);
    if (!t) throw notFound();
    const message = str(req.body?.message, 8000).trim();
    if (!message) throw badRequest('message_required');
    addMessage(t.id, req.user.id, message, true);
    notifyUsers([t.user_id], { type: 'ticket', title: 'Support reply', message: t.subject, data: { ticketId: t.id }, teamId: t.team_id });
    audit(req, 'admin.ticket.reply', 'ticket', t.id, {});
    res.status(201).json({ ticket: ticketWithMessages(getDb().prepare('SELECT * FROM support_tickets WHERE id = ?').get(t.id)) });
  }));

  return router;
}
