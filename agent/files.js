import fs from 'fs';
import path from 'path';
import { instanceDir, volumeDir } from './docker.js';

function resolveSafe(instanceId, requested) {
  const root = path.resolve(instanceDir(instanceId));
  const target = path.resolve(root, '.' + String(requested || '/'));
  if (target !== root && !target.startsWith(root + path.sep)) throw Object.assign(new Error('path_traversal_denied'), { status: 403 });
  return target;
}

export async function listFiles(instanceId, requestedPath) {
  const target = resolveSafe(instanceId, requestedPath);
  if (!fs.existsSync(target)) return { path: requestedPath, entries: [] };
  const stat = fs.statSync(target);
  if (!stat.isDirectory()) return { path: requestedPath, entries: [{ name: path.basename(target), type: 'file', size: stat.size }] };
  const entries = fs.readdirSync(target, { withFileTypes: true }).map((entry) => {
    const full = path.join(target, entry.name);
    let size = 0;
    try { size = fs.statSync(full).size; } catch { /* ignore */ }
    return { name: entry.name, type: entry.isDirectory() ? 'dir' : 'file', size };
  }).sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
  return { path: requestedPath, entries };
}

export async function readFile(instanceId, filePath) {
  const target = resolveSafe(instanceId, filePath);
  const stat = fs.statSync(target);
  if (stat.size > 8 * 1024 * 1024) throw Object.assign(new Error('file_too_large'), { status: 413 });
  return { path: filePath, content: fs.readFileSync(target, 'utf8'), size: stat.size };
}

export async function writeFile(instanceId, filePath, content) {
  const target = resolveSafe(instanceId, filePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, String(content ?? ''));
  const stat = fs.statSync(target);
  return { path: filePath, size: stat.size };
}

export async function fileOperation(instanceId, op, filePath, payload) {
  const target = resolveSafe(instanceId, filePath);
  switch (op) {
    case 'mkdir': fs.mkdirSync(target, { recursive: true }); return { ok: true, path: filePath };
    case 'rename': {
      const dest = resolveSafe(instanceId, payload.destination);
      fs.renameSync(target, dest); return { ok: true, path: payload.destination };
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
  const root = instanceDir(instanceId);
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
  const out = path.join((await import('./docker.js')).DATA_ROOT, 'backups', `${backupId}.tar.gz`);
  const source = instanceDir(instanceId);
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
