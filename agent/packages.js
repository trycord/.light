// ============================================================================
// Shade — product-aware software package installation engine.
// Runs on the node, writes only into the instance's persistent app directory,
// which is bind-mounted into the Debian workload container.
// No host privileges, no Docker socket, no customer-provided URLs.
// ============================================================================
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const MOJANG_MANIFEST = 'https://launchermeta.mojang.com/mc/game/version_manifest.json';
const PAPER_API = 'https://fill.papermc.io/v3/projects/paper';
const PURPUR_API = 'https://api.purpurmc.org/v2/purpur';

function safeName(name) { return String(name || '').replace(/[^A-Za-z0-9._-]/g, ''); }

async function fetchJson(url, timeout = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const r = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': '.light-shade/1.0' } });
    if (!r.ok) throw new Error(`artifact_resolution_http_${r.status}`);
    return await r.json();
  } finally { clearTimeout(timer); }
}

async function download(url, target, expectedHash, algorithm = 'sha256') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180000);
  try {
    const r = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': '.light-shade/1.0' } });
    if (!r.ok) throw new Error(`artifact_download_http_${r.status}`);
    const chunks = [];
    let bytes = 0;
    for await (const chunk of r.body) {
      bytes += chunk.length;
      if (bytes > 512 * 1024 * 1024) throw new Error('artifact_too_large');
      chunks.push(chunk);
    }
    const buf = Buffer.concat(chunks);
    if (expectedHash) {
      const actual = crypto.createHash(algorithm).update(buf).digest('hex');
      if (actual.toLowerCase() !== String(expectedHash).toLowerCase()) throw new Error('artifact_checksum_mismatch');
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, buf);
    return { bytes: buf.length, verified: Boolean(expectedHash) };
  } finally { clearTimeout(timer); }
}

function writeProperties(dir, config) {
  const p = {
    'server-name': config.motd || 'A .light server', 'motd': config.motd || 'A .light server',
    'max-players': config.maxPlayers || 20, 'difficulty': config.difficulty || 'normal',
    'gamemode': config.gameMode || 'survival', 'pvp': config.pvp === false ? 'false' : 'true',
    'online-mode': config.onlineMode === false ? 'false' : 'true',
    'view-distance': config.viewDistance || 10, 'level-seed': config.seed || '',
    'server-port': 25565, 'spawn-protection': 0,
  };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'server.properties'),
    Object.entries(p).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
  // Only write eula.txt when the customer explicitly accepted it.
  if (config.eulaAccepted === true || config.eulaAccepted === 'true') {
    fs.writeFileSync(path.join(dir, 'eula.txt'), 'eula=true\n');
  }
  for (const f of ['ops.json','whitelist.json','banned-players.json','banned-ips.json']) {
    const file = path.join(dir, f);
    if (!fs.existsSync(file)) fs.writeFileSync(file, '[]\n');
  }
}

/** Install the purchased package into the persistent service directory. */
export async function installPackage({ installKind, name, version, runtimeVersion, downloadUrl, sha256, startupTemplate, config }, dir, memoryMb) {
  if (!installKind) return { installed: false, reason: 'no_package' };
  fs.mkdirSync(dir, { recursive: true });
  let result;
  switch (installKind) {
    case 'minecraft-vanilla': {
      const manifest = await fetchJson(MOJANG_MANIFEST);
      const meta = manifest.versions.find((v) => v.id === version);
      if (!meta) throw new Error('unsupported_minecraft_version');
      const versionData = await fetchJson(meta.url);
      const jar = versionData.downloads?.server;
      if (!jar?.url) throw new Error('minecraft_artifact_unavailable');
      result = await download(jar.url, path.join(dir, 'server.jar'), jar.sha1, 'sha1');
      break;
    }
    case 'minecraft-paper': {
      // Paper's maintained API is fill.papermc.io v3 (v2 is sunset).
      const versions = await fetchJson(`${PAPER_API}/versions`);
      const ids = (versions.versions || []).map((v) => v.version?.id || v.version);
      if (!ids.includes(version)) throw new Error('unsupported_minecraft_version');
      const build = await fetchJson(`${PAPER_API}/versions/${version}/builds/latest`);
      const artifact = build.downloads?.['server:default'];
      if (!artifact?.url) throw new Error('package_build_unavailable');
      result = await download(artifact.url, path.join(dir, 'server.jar'), artifact.checksums?.sha256 || sha256);
      break;
    }
    case 'minecraft-purpur': {
      const versions = await fetchJson(`${PURPUR_API}/versions`);
      if (!versions.versions?.includes(version)) throw new Error('unsupported_minecraft_version');
      const build = await fetchJson(`${PURPUR_API}/${version}/latest`);
      if (!build.build) throw new Error('package_build_unavailable');
      const url = `${PURPUR_API}/${version}/${build.build}/download`;
      result = await download(url, path.join(dir, 'server.jar'), build.sha256 || sha256);
      break;
    }
    default:
      // The runtime scaffold already provides a working Debian app environment.
      // Specialised installers (Spigot/Forge/NeoForge/Bedrock/Terraria) are
      // implemented per package definition and fail loudly rather than fake it.
      return { installed: false, reason: 'installer_not_available', installKind };
  }

  if (installKind.startsWith('minecraft')) {
    writeProperties(dir, config || {});
    const mem = Math.max(256, Number(memoryMb) || 512);
    const heap = Math.max(128, Math.floor(mem * 0.75));
    const jar = startupTemplate && startupTemplate.includes('${jar}')
      ? startupTemplate.replace('${jar}', 'server.jar').replace('${memoryMb}', String(heap))
      : `java -Xms128M -Xmx${heap}M -jar server.jar nogui`;
    fs.writeFileSync(path.join(dir, 'start.sh'), `#!/bin/sh\nexec ${jar}\n`, { mode: 0o755 });
    return { installed: true, ...result, startup: jar, eulaAccepted: config?.eulaAccepted === true || config?.eulaAccepted === 'true' };
  }
  return { installed: true, ...result };
}
