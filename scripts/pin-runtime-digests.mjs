#!/usr/bin/env node
// .light — resolve and pin approved runtime images to registry digests.
// Only Docker Hub images are handled automatically; other registries should be
// pinned by the operator. Run after updating the runtime catalog.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB_PATH = process.env.DATABASE_PATH || path.join(ROOT, 'data', 'trycord-light.db');
const APPLY = process.argv.includes('--apply');

async function hubToken(repo) {
  const url = `https://auth.docker.io/token?service=registry.docker.io&scope=repository:${repo}:pull`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`auth_${r.status}`);
  return (await r.json()).token;
}

async function resolveDigest(ref) {
  if (ref.includes('@sha256:')) return ref;
  const at = ref.indexOf(':');
  const repo = ref.slice(0, at).split('/').length === 1 ? `library/${ref.slice(0, at)}` : ref.slice(0, at);
  const tag = ref.slice(at + 1);
  if (ref.includes('@') || ref.startsWith('mcr.microsoft.com/') || ref.startsWith('ghcr.io/')) {
    throw new Error('unsupported_registry');
  }
  const token = await hubToken(repo);
  const r = await fetch(`https://registry-1.docker.io/v2/${repo}/manifests/${tag}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.index.v1+json',
    },
    method: 'HEAD',
  });
  const digest = r.headers.get('docker-content-digest');
  if (!digest) throw new Error(`manifest_${r.status}`);
  return `${ref}@${digest}`;
}

const db = new Database(DB_PATH);
const rows = db.prepare("SELECT id, image, version_images FROM environments WHERE status = 'published'").all();
let pinned = 0; let skipped = 0; let failed = 0;
for (const row of rows) {
  let map = {};
  try { map = JSON.parse(row.version_images || '{}'); } catch { map = {}; }
  if (!Object.keys(map).length && row.image) map = { default: row.image };
  const next = {};
  for (const [version, ref] of Object.entries(map)) {
    try {
      next[version] = await resolveDigest(String(ref));
      if (next[version] !== ref) pinned++;
      else skipped++;
    } catch (error) {
      next[version] = ref; failed++;
      console.warn(`  ! ${row.id}/${version}: ${error.message}`);
    }
  }
  if (APPLY) db.prepare('UPDATE environments SET version_images = ? WHERE id = ?').run(JSON.stringify(next), row.id);
  console.log(`${APPLY ? 'updated' : 'would update'} ${row.id}: ${Object.keys(next).length} version(s)`);
}
db.close();
console.log(`\nPinned ${pinned}, already pinned ${skipped}, unresolved ${failed}. ${APPLY ? '' : 'Re-run with --apply to persist.'}`);
if (!fs.existsSync(path.join(ROOT, 'runtime'))) process.exit(1);
