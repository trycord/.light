// .light — approved runtime catalogue.
// Debian is a fixed platform decision: there is deliberately NO operating-system
// selection anywhere. The only configurable dimension is runtime + version.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { badRequest, json } from './util.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CUSTOM_MODE = String(process.env.LIGHT_RUNTIME_IMAGE_MODE || 'approved').toLowerCase() === 'custom';
const CUSTOM_IMAGE = process.env.LIGHT_RUNTIME_IMAGE || 'trycord/light-runtime';
const CUSTOM_VERSION = process.env.LIGHT_RUNTIME_IMAGE_VERSION || '1.0.0';

function readJson(relative) {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8')); } catch { return null; }
}

/** Resolve the exact image reference used by Shade for a custom-mode service. */
export function customImageRef(environmentId, version) {
  const manifest = readJson('runtime/manifest.json');
  const mapping = manifest?.runtimes?.[environmentId]?.versions?.[version];
  if (!mapping) throw badRequest('runtime_version_not_in_image');
  const digestFile = path.join(ROOT, 'runtime', '.image-digest');
  let digest = '';
  try { digest = fs.readFileSync(digestFile, 'utf8').trim(); } catch { /* no pinned digest yet */ }
  const ref = `${CUSTOM_IMAGE}:${CUSTOM_VERSION}`;
  return { image: ref, digest: /^[0-9a-f]{64}$/i.test(digest) ? digest : '',
    imageRef: /^[0-9a-f]{64}$/i.test(digest) ? `${ref}@sha256:${digest}` : ref,
    runtimeEnv: { LT_RUNTIME: environmentId, LT_RUNTIME_VERSION: String(version) } };
}

// Official images whose default tags are Debian-derived (no explicit marker).
const DEBIAN_BASED_REPOS = new Set([
  'node', 'python', 'golang', 'rust', 'php', 'ruby', 'perl', 'lua', 'erlang', 'elixir',
  'swift', 'openjdk', 'postgres', 'mongo', 'redis', 'nginx', 'gcc', 'debian',
  'denoland/deno', 'oven/bun', 'valkey/valkey', 'mariadb', 'itzg/minecraft-server', 'itzg/minecraft-bedrock-server',
  // Approved runtime providers that publish non-Debian base images but are the
  // only maintained source for specific versions (e.g. Java 21 / Minecraft 1.21+).
  'eclipse-temurin',
]);

/** True only for approved Debian-family image references. */
export function isDebianImage(image) {
  const ref = String(image || '').trim().toLowerCase();
  if (!ref) return false;
  if (/(^|[:@])(alpine|scratch|busybox|distroless|photon|ubi|windowsservercore)([:@/-]|$)/.test(ref)) return false;
  if (/alpine|scratch|busybox/.test(ref)) return false;
  if (/(bookworm|bullseye|buster|trixie|debian|slim|bookworm-slim)/.test(ref)) return true;
  const repo = ref.split('@')[0].split(':')[0];
  return DEBIAN_BASED_REPOS.has(repo);
}

/** Build the image reference passed to the agent (digest-pinned when available). */
export function imageRef(env, version) {
  const v = version || String(env.default_version || '');
  const mapped = json(env.version_images, {})[v];
  if (mapped) return String(mapped);
  const image = String(env.image || '').trim();
  const digest = String(env.image_digest || '').trim();
  if (!digest) return image;
  return `${image}${digest.startsWith('sha256:') ? '@' : '@sha256:'}${digest.replace(/^sha256:/, '')}`;
}

function validate(env, requestedVersion) {
  if (!env) throw badRequest('unknown_runtime');
  const versions = json(env.versions, []);
  const version = String(requestedVersion || env.default_version || versions[0] || '').trim();
  // Never silently substitute a version the customer did not select.
  if (!version || (versions.length && !versions.includes(version))) throw badRequest('unsupported_runtime_version');
  // Each version maps to its own exact image reference (possibly digest-pinned).
  const versionImages = json(env.version_images, {});
  const ref = String(versionImages[version] || env.image || '').trim();
  if (!isDebianImage(ref)) throw badRequest('runtime_must_be_debian');
  const at = ref.indexOf('@sha256:');
  const digest = at >= 0 ? ref.slice(at + 8) : String(env.image_digest || '');
  // In custom mode every service runs our universal Debian image; the runtime
  // and exact version are injected as environment variables and validated by
  // the image launcher against its manifest (no silent substitution).
  const custom = CUSTOM_MODE ? customImageRef(env.id, version) : null;
  return {
    environmentId: env.id,
    environmentName: env.name,
    category: env.category,
    version,
    image: custom ? custom.image : (at >= 0 ? ref.slice(0, at) : ref),
    digest: custom ? custom.digest : digest,
    imageRef: custom ? custom.imageRef : ref,
    runtimeEnv: custom ? custom.runtimeEnv : {},
    command: env.default_command || '',
    workingDir: env.working_dir || '/app',
    exposedPorts: json(env.exposed_ports, []),
    healthcheck: json(env.healthcheck, {}),
    storage: json(env.storage, {}),
    security: json(env.security, {}),
    buildCapable: !!env.build_capable,
  };
}

/**
 * Resolve a customer's runtime selection against the published catalogue.
 * Accepts either an explicit environmentId (+ version) or a legacy image string.
 */
export function resolveRuntime(db, { environmentId, version, image } = {}) {
  if (environmentId) {
    const env = db.prepare("SELECT * FROM environments WHERE id = ? AND status = 'published'").get(String(environmentId));
    return validate(env, version);
  }
  if (image) {
    const env = db.prepare("SELECT * FROM environments WHERE status = 'published' AND image = ? ORDER BY sort_order LIMIT 1").get(String(image));
    if (!env) throw badRequest('unapproved_runtime');
    return validate(env, version);
  }
  throw badRequest('runtime_required');
}
