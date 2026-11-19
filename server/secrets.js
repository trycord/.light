import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const DATA_DIR = process.env.DATA_DIR || process.env.AGENT_DATA_DIR || (process.env.DATABASE_PATH ? path.dirname(process.env.DATABASE_PATH) : './data');
const SECRETS_FILE = path.join(DATA_DIR, '.secrets.json');

function loadSecrets() {
  try {
    if (fs.existsSync(SECRETS_FILE)) return JSON.parse(fs.readFileSync(SECRETS_FILE, 'utf8'));
  } catch { /* ignore */ }
  return {};
}

function saveSecrets(secrets) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SECRETS_FILE, JSON.stringify(secrets, null, 2), { mode: 0o600 });
  } catch (error) { console.error('[.light] could not persist secrets:', error.message); }
}

function generate() {
  const secrets = loadSecrets();
  if (!secrets.JWT_SECRET) secrets.JWT_SECRET = crypto.randomBytes(48).toString('hex');
  if (!secrets.NODE_TOKEN) secrets.NODE_TOKEN = 'n_' + crypto.randomBytes(32).toString('hex');
  // Persisted values win over env unless env is explicitly set by operator.
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = secrets.JWT_SECRET;
  if (!process.env.NODE_TOKEN) process.env.NODE_TOKEN = secrets.NODE_TOKEN;
  saveSecrets(secrets);
  return secrets;
}

export default generate;
