import fs from 'fs';
import path from 'path';
import { instanceDir, volumeDir } from './docker.js';

// Customers only ever see /home/container — their service workspace. Internal
// host paths are never returned by the API. Both '/' and '/home/container' map
// to the same root so older callers keep working.
export const CUSTOMER_ROOT = '/home/container';

function customerPath(requested) {
  let p = String(requested || '/');
  if (p.startsWith(CUSTOMER_ROOT)) p = p.slice(CUSTOMER_ROOT.length) || '/';
  if (!p.startsWith('/')) p = '/' + p;
  return p;
}

function resolveSafe(instanceId, requested) {
  const root = path.resolve(instanceDir(instanceId), 'app');
  const target = path.resolve(root, '.' + customerPath(requested));
  if (target !== root && !target.startsWith(root + path.sep)) throw Object.assign(new Error('path_traversal_denied'), { status: 403 });
  return target;
}

function displayPath(requested) {
  const p = customerPath(requested);
  return p === '/' ? CUSTOMER_ROOT : CUSTOMER_ROOT + p;
}

export async function listFiles(instanceId, requestedPath) {
  const target = resolveSafe(instanceId, requestedPath);
  if (!fs.existsSync(target)) return { path: displayPath(requestedPath), entries: [] };
  const stat = fs.statSync(target);
  if (!stat.isDirectory()) return { path: displayPath(requestedPath), entries: [{ name: path.basename(target), type: 'file', size: stat.size }] };
  const entries = fs.readdirSync(target, { withFileTypes: true }).map((entry) => {
    const full = path.join(target, entry.name);
    let size = 0;
    try { size = fs.statSync(full).size; } catch { /* ignore */ }
    return { name: entry.name, type: entry.isDirectory() ? 'dir' : 'file', size };
  }).sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
  return { path: displayPath(requestedPath), entries };
}

export async function readFile(instanceId, filePath) {
  const target = resolveSafe(instanceId, filePath);
  const stat = fs.statSync(target);
  if (stat.size > 8 * 1024 * 1024) throw Object.assign(new Error('file_too_large'), { status: 413 });
  return { path: displayPath(filePath), content: fs.readFileSync(target, 'utf8'), size: stat.size };
}

export async function writeFile(instanceId, filePath, content) {
  const target = resolveSafe(instanceId, filePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, String(content ?? ''));
  const stat = fs.statSync(target);
  return { path: displayPath(filePath), size: stat.size };
}

/** Write an uploaded file (base64) safely inside the instance volume. */
export async function writeBinary(instanceId, filePath, base64) {
  const target = resolveSafe(instanceId, filePath);
  const buf = Buffer.from(String(base64 || ''), 'base64');
  if (buf.length > 32 * 1024 * 1024) throw Object.assign(new Error('file_too_large'), { status: 413 });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, buf);
  return { path: displayPath(filePath), size: buf.length };
}

export async function fileOperation(instanceId, op, filePath, payload) {
  const target = resolveSafe(instanceId, filePath);
  switch (op) {
    case 'mkdir': fs.mkdirSync(target, { recursive: true }); return { ok: true, path: displayPath(filePath) };
    case 'rename': {
      const dest = resolveSafe(instanceId, payload.destination);
      fs.renameSync(target, dest); return { ok: true, path: displayPath(payload.destination) };
    }
    case 'delete': {
      const stat = fs.lstatSync(target);
      if (stat.isDirectory()) fs.rmSync(target, { recursive: true, force: true }); else fs.unlinkSync(target);
      return { ok: true };
    }
    case 'chmod': fs.chmodSync(target, String(payload.mode || '644')); return { ok: true };
    default: throw Object.assign(new Error('invalid_file_operation'), { status: 400 });
  }
}

export async function storageUsage(instanceId) {
  const root = path.resolve(instanceDir(instanceId), 'app');
  let total = 0;
  const walk = (dir) => {
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else total += fs.statSync(full).size;
      }
    } catch { /* ignore */ }
  };
  walk(root);
  return { bytes: total, mb: Math.round(total / 1048576) };
}

export async function createBackup(instanceId, backupId) {
  const fsExtra = await import('node:child_process');
  const safeId = String(backupId || '').replace(/[^A-Za-z0-9_-]/g, '');
  if (!safeId) throw Object.assign(new Error('invalid_backup_id'), { status: 400 });
  const out = path.join((await import('./docker.js')).DATA_ROOT, 'backups', `${safeId}.tar.gz`);
  const source = path.resolve(instanceDir(instanceId), 'app');
  // A service with no declared volumes may have no directory yet — still
  // produce a valid (empty) backup instead of failing with "tar exited 2".
  fs.mkdirSync(source, { recursive: true });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await new Promise((resolve, reject) => {
    const proc = fsExtra.spawn('tar', ['-czf', out, '-C', source, '.'], { stdio: 'ignore' });
    proc.on('error', reject);
    proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`tar exited ${code}`)));
  });
  const stat = fs.statSync(out);
  return { location: out, sizeBytes: stat.size };
}

export async function restoreBackup(instanceId, location) {
  const source = path.resolve(String(location || ''));
  const root = path.resolve((await import('./docker.js')).DATA_ROOT, 'backups');
  if (!source.startsWith(root + path.sep)) throw Object.assign(new Error('invalid_backup_location'), { status: 403 });
  const target = instanceDir(instanceId);
  fs.mkdirSync(target, { recursive: true });
  const child = await import('node:child_process');
  await new Promise((resolve, reject) => {
    const proc = child.spawn('tar', ['-xzf', source, '-C', target], { stdio: 'ignore' });
    proc.on('error', reject); proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`tar exited ${code}`)));
  });
  return { ok: true };
}

export { volumeDir };
