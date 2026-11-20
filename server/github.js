// .light — GitHub integration service.
import { getDb } from './db.js';
import { encrypt, decrypt } from './crypto.js';
import { id, now } from './util.js';
import crypto from 'crypto';

const GITHUB_API = 'https://api.github.com';

function getToken(teamId) {
  const row = getDb().prepare("SELECT access_token_encrypted FROM github_connections WHERE team_id = ? AND status = 'active'").get(teamId);
  return row ? decrypt(row.access_token_encrypted) : '';
}

export function isConnected(teamId) { return Boolean(getToken(teamId)); }

export function connect(teamId, accessToken, accountLogin) {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM github_connections WHERE team_id = ?').get(teamId);
  if (existing) {
    db.prepare("UPDATE github_connections SET access_token_encrypted = ?, account_login = ?, status = 'active', updated_at = ? WHERE team_id = ?")
      .run(encrypt(accessToken), accountLogin || '', now(), teamId);
  } else {
    db.prepare(`INSERT INTO github_connections (id, team_id, account_login, access_token_encrypted, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?)`)
      .run(id('gh'), teamId, accountLogin || '', encrypt(accessToken), now(), now());
  }
  return { connected: true, account: accountLogin };
}

export function disconnect(teamId) {
  getDb().prepare("UPDATE github_connections SET status = 'revoked', access_token_encrypted = '', updated_at = ? WHERE team_id = ?").run(now(), teamId);
  return { connected: false };
}

async function gh(path, teamId) {
  const token = getToken(teamId);
  if (!token) throw new Error('github_not_connected');
  const res = await fetch(GITHUB_API + path, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': '.light' },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `github_${res.status}`);
  return data;
}

export async function listRepos(teamId, page = 1) {
  const repos = await gh(`/user/repos?per_page=50&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`, teamId);
  return repos.map((r) => ({ fullName: r.full_name, name: r.name, private: r.private, defaultBranch: r.default_branch, cloneUrl: r.clone_url }));
}

export async function listBranches(teamId, repo) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('invalid_repo');
  const branches = await gh(`/repos/${repo}/branches?per_page=100`, teamId);
  return branches.map((b) => b.name);
}

export async function verifyToken(teamId) {
  try { const u = await gh('/user', teamId); return { valid: true, login: u.login }; }
  catch (e) { return { valid: false, error: e.message }; }
}

export function oauthState(teamId) {
  const state = id('state');
  getDb().prepare('INSERT INTO oauth_states (state, team_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(state, teamId, now(), now() + 600000);
  return state;
}

export function oauthConfig() {
  const clientId = process.env.GITHUB_CLIENT_ID || '';
  const callback = process.env.GITHUB_CALLBACK_URL || `${process.env.CONTROL_BASE_URL || ''}/api/github/callback`;
  return { configured: Boolean(clientId), clientId, callbackUrl: callback, authorizeUrl: clientId ? `https://github.com/login/oauth/authorize?client_id=${clientId}&scope=repo,read:user&state=` : '' };
}

export async function exchangeCode(code) {
  const clientId = process.env.GITHUB_CLIENT_ID || '';
  const secret = process.env.GITHUB_CLIENT_SECRET || '';
  if (!clientId || !secret) throw new Error('github_oauth_not_configured');
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ client_id: clientId, client_secret: secret, code }),
  });
  const data = await res.json().catch(() => ({}));
  if (data.error || !data.access_token) throw new Error(data.error_description || 'oauth_exchange_failed');
  return data.access_token;
}

export function verifyWebhookSignature(rawBody, signatureHeader) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET || '';
  if (!secret || !signatureHeader) return false;
  const digest = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signatureHeader)); } catch { return false; }
}
