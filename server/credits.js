// .light — temporary credit wallet.
// Users earn credits by watching ads; credits pay for orders until Stripe is
// enabled. Every movement is recorded in an append-only ledger.
import { getDb } from './db.js';
import { id, now } from './util.js';

export function account(teamId) {
  const db = getDb();
  let row = db.prepare('SELECT * FROM credit_accounts WHERE team_id = ?').get(teamId);
  if (!row) {
    db.prepare('INSERT INTO credit_accounts (team_id, balance, created_at, updated_at) VALUES (?, 0, ?, ?)').run(teamId, now(), now());
    row = db.prepare('SELECT * FROM credit_accounts WHERE team_id = ?').get(teamId);
  }
  return row;
}

function move(teamId, amount, type, description, reference) {
  const db = getDb();
  const acc = account(teamId);
  const balance = acc.balance + amount;
  if (balance < 0) throw Object.assign(new Error('Insufficient credits.'), { status: 409, code: 'insufficient_credits' });
  const ts = now();
  const txId = id('ctx');
  db.transaction(() => {
    db.prepare('UPDATE credit_accounts SET balance=?, lifetime_earned=?, lifetime_spent=?, updated_at=? WHERE team_id=?')
      .run(balance, acc.lifetime_earned + Math.max(0, amount), acc.lifetime_spent + Math.max(0, -amount), ts, teamId);
    db.prepare('INSERT INTO credit_transactions (id, team_id, type, amount, balance_after, description, reference, created_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(txId, teamId, type, amount, balance, description, reference || '', ts);
  })();
  return { id: txId, balance, amount };
}

export function earn(teamId, amount, reason, reference) { return move(teamId, Math.abs(amount), 'earn', reason, reference); }
export function spend(teamId, amount, reason, reference) { return move(teamId, -Math.abs(amount), 'spend', reason, reference); }

export function history(teamId, limit = 50) {
  return getDb().prepare('SELECT id, type, amount, balance_after, description, created_at FROM credit_transactions WHERE team_id=? ORDER BY created_at DESC LIMIT ?').all(teamId, Math.min(200, Number(limit) || 50));
}

/** Balances are stored in cents (same unit as order totals). */
export function view(teamId) {
  const a = account(teamId);
  return {
    balance: a.balance, lifetimeEarned: a.lifetime_earned, lifetimeSpent: a.lifetime_spent,
    balanceDollars: a.balance / 100, currency: 'USD',
    label: 'Provisionary Credits',
    note: 'Temporary credits used in place of Stripe. Each $1 of credit pays $1 toward an order. Phased out when payments launch.',
  };
}

/**
 * Baked-in offers — small profile/setup tasks that award credits.
 * "Ads" here means these built-in offers, not a third-party ad network.
 * Each offer can be completed ONCE per user (except daily ones).
 */
export const OFFERS = [
  { id: 'add-email', title: 'Add your email', description: 'Set a contact email on your account.', reward: 150, rewardLabel: '$1.50', type: 'once' },
  { id: 'change-avatar', title: 'Change your profile picture', description: 'Pick an avatar so your account stands out.', reward: 100, rewardLabel: '$1.00', type: 'once' },
  { id: 'enable-2fa', title: 'Secure your account with 2FA', description: 'Turn on two-factor authentication.', reward: 250, rewardLabel: '$2.50', type: 'once' },
  { id: 'deploy-service', title: 'Deploy your first service', description: 'Pick a product and launch a service.', reward: 300, rewardLabel: '$3.00', type: 'once' },
  { id: 'add-friend', title: 'Add a friend', description: 'Invite a friend to .light by adding their email.', reward: 200, rewardLabel: '$2.00', type: 'once' },
  { id: 'daily-checkin', title: 'Daily check-in', description: 'Visit the dashboard each day.', reward: 50, rewardLabel: '$0.50', type: 'daily' },
];

export function offers(teamId, userId) {
  const db = getDb();
  const done = db.prepare('SELECT offer_id, completed_at FROM offer_completions WHERE user_id=?').all(userId);
  const byId = Object.fromEntries(done.map(d => [d.offer_id, d.completed_at]));
  const today = new Date().toISOString().slice(0, 10);
  return OFFERS.map(o => {
    const at = byId[o.id];
    const available = o.type === 'daily' ? (!at || !new Date(at).toISOString().slice(0,10).match(today)) : !at;
    return { ...o, completed: Boolean(at), available, completedAt: at || null };
  });
}

export function completeOffer(offerId, teamId, userId) {
  const offer = OFFERS.find(o => o.id === offerId);
  if (!offer) throw Object.assign(new Error('That offer is not available.'), { status: 404, code: 'offer_not_found' });
  const db = getDb();
  const prior = db.prepare('SELECT completed_at FROM offer_completions WHERE user_id=? AND offer_id=?').get(userId, offerId);
  if (prior) {
    if (offer.type === 'daily' && new Date(prior.completed_at).toISOString().slice(0,10) === new Date().toISOString().slice(0,10)) {
      throw Object.assign(new Error('You have already claimed this offer today.'), { status: 429, code: 'offer_already_claimed' });
    }
    if (offer.type === 'once') throw Object.assign(new Error('You have already claimed this offer.'), { status: 409, code: 'offer_already_claimed' });
  }
  // Verify the user actually did the thing the offer asks for.
  if (offerId === 'add-email' || offerId === 'change-avatar') {
    const cols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
    const u = db.prepare(`SELECT email${cols.includes('avatar') ? ', avatar' : ''} FROM users WHERE id=?`).get(userId);
    if (!u) throw Object.assign(new Error('Account not found.'), { status: 404 });
    if (offerId === 'add-email' && !u.email) throw Object.assign(new Error('Add an email to your account first.'), { status: 400 });
    if (offerId === 'change-avatar') {
      const settings = JSON.parse((db.prepare('SELECT settings FROM users WHERE id=?').get(userId)?.settings) || '{}');
      const avatar = u.avatar || settings.avatar;
      if (!avatar) throw Object.assign(new Error('Set a profile picture first.'), { status: 400 });
    }
  }
  if (offerId === 'enable-2fa') {
    const t = db.prepare('SELECT enabled FROM two_factor WHERE user_id=?').get(userId);
    if (!t?.enabled) throw Object.assign(new Error('Enable two-factor authentication first.'), { status: 400, code: 'offer_requirement_unmet' });
  }
  if (offerId === 'deploy-service') {
    const c = db.prepare("SELECT COUNT(*) c FROM instances WHERE team_id=? AND status!='error'").get(teamId);
    if (!c.c) throw Object.assign(new Error('Deploy a service first.'), { status: 400, code: 'offer_requirement_unmet' });
  }
  if (offerId === 'add-friend') {
    const f = db.prepare('SELECT COUNT(*) c FROM friendships WHERE user_id=?').get(userId);
    if (!f.c) throw Object.assign(new Error('Add a friend by their .light email first.'), { status: 400, code: 'offer_requirement_unmet' });
  }
  const ts = now();
  db.prepare('INSERT OR REPLACE INTO offer_completions (user_id, team_id, offer_id, completed_at) VALUES (?,?,?,?)').run(userId, teamId, offerId, ts);
  const result = earn(teamId, offer.reward, `Offer: ${offer.title}`, offerId);
  return { reward: offer.reward, balance: result.balance, offerId };
}
