// .light — SteamCMD game server provisioning.
// Uses an isolated steamcmd container to install a game into the instance's
// persistent volume. No game runtimes are bundled into Shade.
import { getDocker, volumeDir, containerName, networkName } from './docker.js';
import fs from 'fs';
import path from 'path';
import config from './config.js';

const STEAMCMD_IMAGE = process.env.STEAMCMD_IMAGE || 'gameserversteamcmd/steamcmd:latest';

// Supported Steam games (appid, default port, optional extra args).
export const STEAM_GAMES = {
  rust: { appid: 258550, port: 28015, protocol: 'udp', name: 'Rust' },
  ark: { appid: 2430930, port: 7777, protocol: 'udp', name: 'ARK: Survival Ascended' },
  'ark-se': { appid: 376030, port: 7777, protocol: 'udp', name: 'ARK: Survival Evolved' },
  csgo: { appid: 740, port: 27015, protocol: 'udp', name: 'Counter-Strike 2' },
  cs2: { appid: 730, port: 27015, protocol: 'udp', name: 'Counter-Strike 2' },
  tf2: { appid: 232250, port: 27015, protocol: 'udp', name: 'Team Fortress 2' },
  '7dtd': { appid: 294420, port: 26900, protocol: 'udp', name: '7 Days to Die' },
  valheim: { appid: 896660, port: 2456, protocol: 'udp', name: 'Valheim' },
  satisfactory: { appid: 526870, port: 7777, protocol: 'udp', name: 'Satisfactory' },
  palworld: { appid: 1623730, port: 8211, protocol: 'udp', name: 'Palworld' },
  enshrouded: { appid: 2278520, port: 15636, protocol: 'udp', name: 'Enshrouded' },
  minecraft: null, // installed via dedicated non-steam images
};

export function isSteamGame(game, image = '') {
  const key = String(game || '').toLowerCase();
  return Boolean(STEAM_GAMES[key]) || /steamcmd|steam/.test(image.toLowerCase());
}

export function resolveGame(game) { return STEAM_GAMES[String(game || '').toLowerCase()] || null; }

// Install a Steam game into the instance's first persistent volume using a
// one-shot steamcmd container, then report the install log.
export async function installSteamGame(payload) {
  const { instanceId, game, appId, appid, beta, username, password } = payload;
  const key = String(game || '').toLowerCase();
  const meta = STEAM_GAMES[key] || null;
  const id = Number(appId || appid || meta?.appid || 0);
  if (!id) throw Object.assign(new Error('steam_appid_required'), { status: 400 });

  const target = volumeDir(instanceId, 0);
  fs.mkdirSync(target, { recursive: true });

  // steamcmd anonymous login works for most dedicated server apps.
  const login = (username && password)
    ? `login ${shellSafe(username)} ${shellSafe(password)}`
    : 'login anonymous';
  const appUpdate = beta ? `app_update ${id} beta ${shellSafe(beta)} validate` : `app_update ${id} validate`;
  const script = `#!/bin/sh\nset -e\n${login}\n${appUpdate}\nquit\n`;
  const scriptPath = path.join(target, '.lt-install-steam.sh');
  fs.writeFileSync(scriptPath, script, { mode: 0o755 });

  const d = getDocker();
  const name = `lt-steam-${String(instanceId).replace(/[^A-Za-z0-9_-]/g, '')}`;
  // Remove any leftover installer container.
  try { await d.getContainer(name).remove({ force: true }); } catch { /* none */ }

  const container = await d.createContainer({
    Image: STEAMCMD_IMAGE,
    name,
    Cmd: ['/bin/sh', '/game/.lt-install-steam.sh'],
    HostConfig: {
      Binds: [`${target}:/game`],
      NetworkMode: networkName(payload.teamId || 'default'),
      AutoRemove: false,
      Memory: 4 * 1024 * 1024 * 1024,
    },
  });
  await container.start();
  const stream = await container.logs({ follow: true, stdout: true, stderr: true });
  const chunks = [];
  await new Promise((resolve, reject) => {
    d.modem.demuxStream(stream, { write: (c) => chunks.push(c) }, { write: (c) => chunks.push(c) });
    stream.on('end', resolve);
    stream.on('error', reject);
    const check = setInterval(async () => {
      try { const info = await container.inspect(); if (!info.State.Running) { clearInterval(check); resolve(); } } catch { clearInterval(check); resolve(); }
    }, 1000);
  });
  const info = await container.inspect();
  const exitCode = info.State.ExitCode;
  const log = Buffer.concat(chunks).toString('utf8');
  fs.writeFileSync(path.join(target, '.lt-steam-install.log'), log);
  try { await container.remove({ force: true }); } catch { /* none */ }
  fs.unlinkSync(scriptPath);

  if (exitCode !== 0) throw Object.assign(new Error('steam_install_failed'), { status: 500, log: log.slice(-4000) });
  return { ok: true, appId: id, game: key, log: log.slice(-2000), installDir: '/game' };
}

function shellSafe(value) { return String(value).replace(/[^A-Za-z0-9_.-]/g, ''); }
