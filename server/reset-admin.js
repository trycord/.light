// One-time admin reset utility. Run with: node server/reset-admin.js [password]
// Resets the designated administrator account with a provisionary password.
import dotenv from 'dotenv';
dotenv.config();
import { initDb, getDb, closeDb } from './db.js';
import { hashPassword } from './security.js';

const email = (process.env.BOOTSTRAP_ADMIN_EMAIL || 'admin@trycord.dev').toLowerCase();
const name = process.env.BOOTSTRAP_ADMIN_NAME || 'trycord_administrator';
const provisionary = process.argv[2] || 'LightAdmin2026!';

const db = initDb() || getDb();
const ts = Date.now();
let user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
if (!user) {
  const uid = 'usr_' + ts.toString(36);
  const teamId = 'team_' + ts.toString(36);
  db.prepare('INSERT OR IGNORE INTO teams (id, name, owner_id, plan_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(teamId, 'Administration', uid, 'free', ts, ts);
  db.prepare('INSERT INTO users (id, email, name, password_hash, role, team_id, status, email_verified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(uid, email, name, hashPassword(provisionary), 'admin', teamId, 'active', 1, ts, ts);
  db.prepare('INSERT OR IGNORE INTO team_members (team_id, user_id, role, created_at) VALUES (?, ?, ?, ?)').run(teamId, uid, 'owner', ts);
  console.log('CREATED admin account');
} else {
  db.prepare("UPDATE users SET password_hash = ?, role = 'admin', status = 'active', email_verified = 1, failed_logins = 0, locked_until = NULL, token_version = COALESCE(token_version,0)+1, name = ?, updated_at = ? WHERE id = ?")
    .run(hashPassword(provisionary), name, ts, user.id);
  console.log('RESET admin account');
}
closeDb();
console.log('============================================');
console.log('  .light PROVISIONARY ADMIN CREDENTIALS');
console.log('============================================');
console.log('  Email:    ' + email);
console.log('  Password: ' + provisionary);
console.log('  Role:     admin');
console.log('============================================');
console.log('Change this password immediately after first login.');
