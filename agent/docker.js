import Docker from 'dockerode';
import os from 'os';
import fs from 'fs';
import path from 'path';
import config from './config.js';
import { scaffold, DEFAULT_ENV } from './scaffolds.js';
import { installPackage } from './packages.js';

let docker;
export function dockerOptions(host = config.dockerHost) {
  const value = String(host || '').trim();
  if (/^tcp:\/\//i.test(value)) {
    const url = new URL(value);
    return { protocol: 'http', host: url.hostname, port: Number(url.port) || 2375 };
  }
  if (/^npipe:\/\//i.test(value)) return { socketPath: decodeURIComponent(value.replace(/^npipe:\/\//i, '')) };
  if (/^unix:\/\//i.test(value)) return { socketPath: decodeURIComponent(value.replace(/^unix:\/\//i, '')) };
  return { socketPath: value || '/var/run/docker.sock' };
}
export function getDocker() {
  if (!docker) docker = new Docker(dockerOptions());
  return docker;
}

export const DATA_ROOT = config.dataRoot || '/var/lib/trycord-light';
export const instanceDir = (instanceId) => path.join(DATA_ROOT, 'instances', instanceId.replace(/[^A-Za-z0-9_-]/g, ''));
export const volumeDir = (instanceId, index) => path.join(instanceDir(instanceId), `volume-${index}`);

export function ensureDirs() {
  fs.mkdirSync(path.join(DATA_ROOT, 'instances'), { recursive: true });
  fs.mkdirSync(path.join(DATA_ROOT, 'backups'), { recursive: true });
}

export function containerName(instanceId) { return `lt-${instanceId.replace(/[^A-Za-z0-9_-]/g, '')}`; }
export function networkName(teamId) { return `lt-net-${String(teamId).replace(/[^A-Za-z0-9_-]/g, '')}`; }

/** Deterministic private subnet per team, outside Docker's default address pools. */
export function teamSubnet(teamId, offset = 0) {
  const value = String(teamId || 'default');
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  const third = 20 + ((hash + offset) % 220);
  return `10.231.${third}.0/24`;
}

async function ensureNetwork(teamId) {
  const name = networkName(teamId);
  try { return await getDocker().getNetwork(name).inspect(); } catch { /* create */ }
  // Explicit subnets avoid exhausting Docker's predefined address pools when
  // many teams are provisioned on one node.
  let lastError;
  for (let attempt = 0; attempt < 24; attempt++) {
    const subnet = teamSubnet(teamId, attempt);
    try {
      return await getDocker().createNetwork({
        Name: name, Driver: 'bridge', Internal: false,
        IPAM: { Driver: 'default', Config: [{ Subnet: subnet, Gateway: subnet.replace('.0/24', '.1') }] },
      });
    } catch (error) {
      if (error.statusCode === 409) return getDocker().getNetwork(name).inspect();
      lastError = error;
      if (!/pool overlaps|address pool/i.test(String(error.message))) throw error;
    }
  }
  throw lastError || new Error('network_subnet_unavailable');
}

export async function hostMetrics() {
  const cpus = os.cpus();
  let idle = 0, total = 0;
  for (const cpu of cpus) {
    for (const key of Object.keys(cpu.times)) total += cpu.times[key];
    idle += cpu.times.idle;
  }
  const cpuPercent = total ? Math.round((1 - idle / total) * 100) : 0;
  const mem = process.systemMemory ? process.systemMemory() : {
    total: os.totalmem(), free: os.freemem(),
  };
  const memPercent = mem.total ? Math.round(((mem.total - mem.free) / mem.total) * 100) : 0;
  let diskPercent = 0;
  try {
    const stat = fs.statfsSync(DATA_ROOT);
    diskPercent = Math.round(((stat.blocks - stat.bavail) / stat.blocks) * 100);
  } catch { /* unsupported */ }
  let temps = 0, tempCount = 0;
  for (const cpu of cpus) { if (typeof cpu.temp === 'number') { temps += cpu.temp; tempCount++; } }
  return { cpu: cpuPercent, mem: memPercent, disk: diskPercent, netIn: 0, netOut: 0, temp: tempCount ? Math.round(temps / tempCount) : 0,
    cpuCores: cpus.length, memoryMb: Math.round(os.totalmem() / 1048576), diskGb: Math.round(fs.statfsSync(DATA_ROOT).blocks * fs.statfsSync(DATA_ROOT).bsize / 1073741824) || 100 };
}

function envArray(env) {
  return Object.entries(env || {}).map(([key, value]) => `${key}=${value}`);
}

/**
 * Convert a catalogue-style healthcheck ({ path, interval, ... }) into the
 * Docker Healthcheck object the API expects. Images ship their own HEALTHCHECK
 * too, but the control plane supplies one for observability, so it must be a
 * valid Test command rather than a raw `{ path }` object (which Docker rejects).
 */
function normalizeHealthcheck(hc) {
  if (!hc || !Object.keys(hc).length) return null;
  if (Array.isArray(hc.Test) && hc.Test.length) return hc;
  const path = String(hc.path || '/').replace(/[^A-Za-z0-9/_\-.]/g, '').slice(0, 200) || '/';
  const probe = `node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'${path}').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"`;
  return {
    Test: ['CMD-SHELL', probe],
    Interval: Number(hc.interval) || 30e9,
    Timeout: Number(hc.timeout) || 5e9,
    Retries: Number(hc.retries) || 3,
    StartPeriod: Number(hc.startPeriod) || 20e9,
  };
}

function parsePort(port) {
  const match = String(port).match(/^(\d+)(?:\/(tcp|udp))?$/);
  if (!match) return null;
  return { port: Number(match[1]), protocol: match[2] || 'tcp' };
}

/**
 * Build Docker port bindings from a service's requested ports.
 * A host value of 0 (or unset) means "auto" — Docker picks a free ephemeral
 * host port. This prevents `Bind for 0.0.0.0:80 failed: port is already allocated`
 * when several services expose the same container port.
 */
export function buildPortBindings(ports = []) {
  const exposedPorts = {};
  const portBindings = {};
  for (const p of ports || []) {
    if (!p) continue;
    const parsed = parsePort(p.protocol ? `${p.container}/${p.protocol}` : p.container);
    if (!parsed) continue;
    const key = `${parsed.port}/${parsed.protocol}`;
    exposedPorts[key] = {};
    const host = Number(p.host);
    const hostPort = Number.isFinite(host) && host > 0 ? String(Math.trunc(host)) : '';
    portBindings[key] = [{ HostIp: '0.0.0.0', HostPort: hostPort }];
  }
  return { exposedPorts, portBindings };
}

async function ensureImage(image) {
  try { await getDocker().getImage(image).inspect(); return; } catch { /* pull */ }
  await new Promise((resolve, reject) => {
    getDocker().pull(image, (error, stream) => {
      if (error) return reject(error);
      getDocker().modem.followProgress(stream, (err) => err ? reject(err) : resolve());
    });
  });
}

/**
 * Build (and security-check) the Docker create options for one service.
 * Pure so it can be unit-tested without a Docker daemon.
 */
export function buildContainerConfig(payload) {
  const { instanceId, teamId, name, image, command, env, ports, volumes, cpu, memory, disk,
    environmentId, environmentVersion, healthcheck, security, workingDir } = payload || {};
  const binds = [];
  (volumes || []).forEach((volume, index) => {
    const hostPath = volumeDir(instanceId, String(index));
    binds.push(`${hostPath}:${volume.path}`);
  });
  const { exposedPorts, portBindings } = buildPortBindings(ports);
  const config = {
    Image: image,
    name: containerName(instanceId),
    Cmd: command ? ['/bin/sh', '-c', command] : undefined,
    WorkingDir: String(workingDir || '/app').slice(0, 200),
    Env: envArray(env),
    ExposedPorts: exposedPorts,
    Labels: {
      'lt.instance': instanceId, 'lt.team': teamId || 'default',
      'lt.name': String(name || '').slice(0, 100),
      'lt.environment': String(environmentId || ''),
      'lt.environment.version': String(environmentVersion || ''),
      'lt.os': 'debian',
    },
    HostConfig: {
      NetworkMode: networkName(teamId || 'default'),
      PortBindings: portBindings,
      Binds: binds,
      RestartPolicy: { Name: 'unless-stopped', MaximumRetryCount: 0 },
      Memory: Math.max(128, Number(memory) || 512) * 1024 * 1024,
      MemorySwap: -1,
      NanoCpus: Math.max(1, Number(cpu) || 1) * 1e9,
      ReadonlyRootfs: false,
      CapDrop: ['ALL'],
      CapAdd: ['CHOWN', 'SETUID', 'SETGID', 'NET_BIND_SERVICE'],
      SecurityOpt: ['no-new-privileges:true'],
      PidsLimit: 512,
      Init: true,
      StopTimeout: 10,
    },
  };
  if (security?.rootless) config.User = '10001:10001';
  // A minimal default probe keeps Docker health status meaningful even for
  // runtimes that do not ship a catalog-specific healthcheck.
  config.Healthcheck = normalizeHealthcheck(healthcheck) || {
    Test: ['CMD-SHELL', 'test -d /proc/1'],
    Interval: 30000000000, Timeout: 5000000000, Retries: 3, StartPeriod: 10000000000,
  };
  assertContainerConfig(config);
  return config;
}

function assertContainerConfig(config) {
  const ref = String(config.Image || '').toLowerCase();
  if (!ref || /alpine|scratch|busybox/.test(ref)) throw Object.assign(new Error('unapproved_image'), { status: 400 });
  const hc = config.HostConfig || {};
  if (hc.Privileged) throw Object.assign(new Error('privileged_containers_forbidden'), { status: 400 });
  if (['host', 'none'].includes(hc.NetworkMode)) throw Object.assign(new Error('host_namespace_forbidden'), { status: 400 });
  for (const bind of hc.Binds || []) {
    const src = String(bind).split(':')[0];
    if (['/', '/var/run/docker.sock', '/proc', '/sys', '/dev'].includes(src)) throw Object.assign(new Error('host_mount_forbidden'), { status: 400 });
  }
  if (!(hc.CapDrop || []).includes('ALL')) throw Object.assign(new Error('capdrop_all_required'), { status: 400 });
  if (!(hc.SecurityOpt || []).includes('no-new-privileges:true')) throw Object.assign(new Error('no_new_privileges_required'), { status: 400 });
}

export async function createInstance(payload) {
  const { instanceId, teamId, name, image, ports, volumes } = payload;
  const d = getDocker();

  // Write default starter files into the persistent app directory so every
  // service boots successfully on first provision (no missing package.json).
  const tpl = scaffold(payload.environmentId);
  const appDir = path.join(instanceDir(instanceId), 'app');
  fs.mkdirSync(appDir, { recursive: true });
  for (const [relative, content] of Object.entries(tpl.files || {})) {
    const target = path.join(appDir, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (!fs.existsSync(target)) fs.writeFileSync(target, content);
  }
  // Product-aware install: downloads the purchased software into the same
  // persistent directory. Never overwrite installed artifacts on retry.
  let installResult = null;
  // Self-contained images (Trycord) carry the app in the image. If an order was
  // created with the runtime selected but no package attached, still prepare
  // its persistent data + runtime env, otherwise it boots the wrong command
  // from /home/container and crash-loops.
  const imageBased = payload.environmentId === 'trycord' || /light-trycord/i.test(String(image || ''));
  const pkg = payload.package || (imageBased
    ? { id: 'trycord', name: 'Trycord', version: '7.2.0', installKind: 'trycord', config: payload.env || {} }
    : null);
  if (pkg) {
    const jarExists = fs.existsSync(path.join(appDir, 'server.jar'));
    if (!jarExists) {
      installResult = await installPackage(pkg, appDir, payload.memory);
      console.log('[shade] package install:', pkg.name, pkg.version, installResult?.installed ? 'ok' : installResult?.reason);
    } else installResult = { installed: true, reused: true };
  }
  // Customer-visible filesystem boundary. Every service sees /home/container;
  // the runtime's expected directory is bind-mounted from the same source for
  // compatibility (e.g. nginx's /usr/share/nginx/html).
  const appTarget = '/home/container';
  const enriched = {
    ...payload,
    // Image-based packages must run their absolute startup command; a stale
    // relative command from the order would execute from /home/container.
    command: installResult?.imageBased ? installResult.startup
      : (payload.command || installResult?.startup || tpl.command || payload.defaultCommand || ''),
    workingDir: appTarget,
    env: { ...(DEFAULT_ENV[payload.environmentId] || {}), ...(payload.env || {}),
      ...(installResult?.env && !Array.isArray(installResult.env) ? installResult.env : {}),
      LIGHT_PORT: String((ports || [])[0]?.container || 3000) },
  };
  const config = buildContainerConfig(enriched);
  if (!config.HostConfig.Binds.some((b) => b.endsWith(`:${appTarget}`))) {
    config.HostConfig.Binds.push(`${appDir}:${appTarget}`);
  }
  // Image-based packages (Trycord) carry their app inside the image. Binding the
  // scaffold's generic workdir over /app would hide the baked application.
  if (!installResult?.imageBased && tpl.workdir && tpl.workdir !== appTarget &&
      !config.HostConfig.Binds.some((b) => b.endsWith(`:${tpl.workdir}`))) {
    config.HostConfig.Binds.push(`${appDir}:${tpl.workdir}`);
  }
  // Ensure the image exists locally before creating the container.
  await ensureImage(image || 'nginx:bookworm');
  await ensureNetwork(teamId || 'default');
  for (let i = 0; i < (volumes || []).length; i++) fs.mkdirSync(volumeDir(instanceId, String(i)), { recursive: true });
  // A failed previous attempt can leave a created-but-unstarted container behind.
  const stale = d.getContainer(containerName(instanceId));
  try { await stale.inspect(); try { await stale.remove({ force: true }); } catch { /* ignore */ } } catch { /* none */ }
  const container = await d.createContainer(config);
  await container.start();
  // Report the real host ports allocated by Docker back to the control plane.
  const info = await container.inspect();
  const assigned = [];
  for (const p of ports || []) {
    if (!p) continue;
    const parsed = parsePort(p.protocol ? `${p.container}/${p.protocol}` : p.container);
    if (!parsed) continue;
    const key = `${parsed.port}/${parsed.protocol}`;
    const binding = info.NetworkSettings?.Ports?.[key]?.[0];
    assigned.push({ container: parsed.port, host: binding?.HostPort ? Number(binding.HostPort) : 0, protocol: parsed.protocol });
  }
  return { containerId: container.id, name: containerName(instanceId), ports: assigned };
}

// One connector per hosted application (domain), named by domain id so multiple
// services on a team never collide. Host networking lets cloudflared reach the
// workload's published host port at 127.0.0.1:<port> on this node.
export function tunnelContainerName(domainId) {
  return `lt-tunnel-${String(domainId || 'default').replace(/[^A-Za-z0-9_-]/g, '').slice(-24)}`;
}

export function buildTunnelConfig({ domainId, token, hostname, tunnelId, image }) {
  if (!token) throw Object.assign(new Error('tunnel_token_required'), { status: 400 });
  return {
    Image: image || process.env.LIGHT_RUNTIME_IMAGE || 'trycord/light-runtime:1.0.0',
    name: tunnelContainerName(domainId),
    // cloudflared requires global flags BEFORE the subcommand. Placing
    // --no-autoupdate after `tunnel` makes it interpret it as an invalid
    // subcommand and the connector crash-loops.
    Cmd: ['/usr/local/bin/cloudflared', '--no-autoupdate', 'tunnel', 'run', '--token', String(token)],
    Env: [`LT_HOSTNAME=${String(hostname || '').slice(0, 200)}`],
    Labels: { 'lt.tunnel': 'cloudflare', 'lt.domain': domainId || '', 'lt.hostname': String(hostname || '').slice(0, 100),
      'lt.tunnel-id': String(tunnelId || '').slice(0, 100) },
    HostConfig: {
      NetworkMode: 'host',
      RestartPolicy: { Name: 'unless-stopped', MaximumRetryCount: 0 },
      Memory: 128 * 1024 * 1024, MemorySwap: -1, NanoCpus: 0.25e9,
      PidsLimit: 128, CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges:true'], Init: true,
    },
  };
}

export async function startTunnelConnector({ domainId, token, hostname, tunnelId, image }) {
  const d = getDocker();
  const config = buildTunnelConfig({ domainId, token, hostname, tunnelId, image });
  const name = config.name;
  // Idempotent: if this application's connector already exists, leave it alone.
  const stale = d.getContainer(name);
  try {
    const info = await stale.inspect();
    if (info.State?.Running) return { containerId: info.Id, name, reused: true };
    await stale.remove({ force: true });
  } catch { /* none */ }
  const container = await d.createContainer(config);
  await container.start();
  return { containerId: container.id, name, reused: false };
}

export async function stopTunnelConnector({ domainId }) {
  const d = getDocker();
  const name = tunnelContainerName(domainId);
  const containers = await d.listContainers({ all: true });
  const found = containers.find((c) => c.Names?.includes(`/${name}`));
  if (!found) return { ok: false, reason: 'not_found' };
  await d.getContainer(found.Id).remove({ force: true });
  return { ok: true };
}

/** Actual container state for an instance, reported to the control plane. */
export async function containerHealth(instanceId) {
  try {
    const containers = await getDocker().listContainers({ all: true });
    const name = containerName(instanceId);
    const found = containers.find((c) => c.Names?.includes(`/${name}`));
    if (!found) return { status: 'missing', health: 'unknown' };
    const state = (await getDocker().getContainer(found.Id).inspect()).State || {};
    let status = 'stopped';
    if (state.Running) status = 'running';
    else if (state.Paused) status = 'paused';
    else if (state.Dead) status = 'dead';
    return { status, health: state.Health?.Status || 'unknown', startedAt: state.StartedAt || null,
      exitCode: Number.isFinite(state.ExitCode) ? state.ExitCode : null };
  } catch (error) { return { status: 'error', health: 'unknown', error: error.message }; }
}

/**
 * Resolve a workload container using the authoritative Docker ID persisted by
 * the Control Plane. Name lookup is only a compatibility fallback for legacy
 * services created before the ID was stored.
 *
 * Errors are structured so the Control Plane can distinguish a missing Docker
 * container from a daemon failure, without leaking internals to customers.
 */
async function withContainer(instanceId, fn, containerId = '') {
  const d = getDocker();
  let container = null;
  if (containerId) {
    try {
      container = d.getContainer(containerId);
      await container.inspect();
    } catch (error) {
      const code = error?.statusCode === 404 ? 'docker_container_missing' : 'docker_unavailable';
      const err = new Error(code);
      err.code = code; err.status = code === 'docker_container_missing' ? 404 : 503;
      throw err;
    }
  } else {
    // Legacy fallback: resolve by canonical name only (never arbitrary matching).
    const containers = await d.listContainers({ all: true });
    const name = containerName(instanceId);
    const found = containers.find((c) => c.Names?.includes(`/${name}`));
    if (!found) {
      const err = new Error('docker_container_missing');
      err.code = 'docker_container_missing'; err.status = 404; throw err;
    }
    container = d.getContainer(found.Id);
  }
  return fn(container);
}

export async function startInstance(instanceId, containerId = '') { return withContainer(instanceId, (c) => c.start().then(() => ({ ok: true })), containerId); }
export async function stopInstance(instanceId, containerId = '') { return withContainer(instanceId, (c) => c.stop({ t: 10 }).then(() => ({ ok: true })), containerId); }
export async function restartInstance(instanceId, containerId = '') { return withContainer(instanceId, (c) => c.restart({ t: 10 }).then(() => ({ ok: true })), containerId); }
export async function suspendInstance(instanceId, containerId = '') { return withContainer(instanceId, (c) => c.pause().then(() => ({ ok: true })), containerId); }
export async function resumeInstance(instanceId, containerId = '') { return withContainer(instanceId, (c) => c.unpause().then(() => ({ ok: true })), containerId); }

export async function removeInstance(instanceId, containerId = '') {
  return withContainer(instanceId, async (c) => {
    const info = await c.inspect().catch(() => ({}));
    if (info.State?.Running) await c.stop({ t: 5 }).catch(() => {});
    await c.remove({ force: true });
    return { ok: true };
  }, containerId).catch(() => ({ ok: true }));
}

export async function reinstallInstance(instanceId, payload) {
  await removeInstance(instanceId);
  return createInstance({ ...payload, instanceId });
}

export async function execCommand(instanceId, command, containerId = '') {
  return withContainer(instanceId, async (c) => {
    const exec = await c.exec({ Cmd: ['/bin/sh', '-c', command], AttachStdout: true, AttachStderr: true, Tty: false });
    const stream = await exec.start({ hijack: true, stdin: false });
    const chunks = [];
    await new Promise((resolve, reject) => {
      getDocker().modem.demuxStream(stream, { write: (c) => chunks.push(c) }, { write: (c) => chunks.push(c) });
      stream.on('end', resolve); stream.on('error', reject);
    });
    return { output: Buffer.concat(chunks).toString('utf8').slice(0, 20000) };
  }, containerId);
}

export async function containerStatus(instanceId) {
  return withContainer(instanceId, async (c) => {
    const info = await c.inspect();
    return { status: info.State?.Running ? 'running' : info.State?.Paused ? 'suspended' : info.State?.Restarting ? 'restarting' : 'stopped', health: info.State?.Health?.Status || 'unknown' };
  }).catch(() => ({ status: 'missing', health: 'unknown' }));
}

export async function deployImage(instanceId, config = {}) {
  const image = config.image || 'nginx:bookworm';
  await new Promise((resolve, reject) => {
    getDocker().pull(image, (error, stream) => {
      if (error) return reject(error);
      getDocker().modem.followProgress(stream, (err) => err ? reject(err) : resolve());
    });
  });
  const info = await containerStatus(instanceId);
  if (info.status !== 'missing') await removeInstance(instanceId);
  return createInstance({ ...config, instanceId, image });
}

export async function containerStats(instanceId, containerId = '') {
  return withContainer(instanceId, async (c) => {
    const info = await c.inspect();
    if (!info.State?.Running) return null;
    const stats = await c.stats({ stream: false });
    const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - (stats.precpu_stats.cpu_usage?.total_usage || 0);
    const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
    const cpu = systemDelta > 0 ? Math.round((cpuDelta / systemDelta) * 100 * (stats.cpu_stats.online_cpus || 1)) : 0;
    const mem = stats.memory_stats.usage ? Math.round((stats.memory_stats.usage / (stats.memory_stats.limit || 1)) * 100) : 0;
    return { cpu, mem };
  }, containerId).catch(() => null);
}

export function followLogs(instanceId, onLine, containerId = '') {
  return withContainer(instanceId, (c) => c.logs({ follow: true, stdout: true, stderr: true, timestamps: true, tail: 'all' }).then((stream) => {
    const sink = (streamName) => ({
      write(chunk) {
        const text = chunk.toString('utf8');
        for (const line of text.split('\n')) {
          if (!line.trim()) continue;
          const match = line.match(/^(\S+)\s+(.*)$/);
          onLine({ ts: match ? Date.parse(match[1]) || Date.now() : Date.now(), stream: streamName, line: match ? match[2] : line });
        }
      },
    });
    getDocker().modem.demuxStream(stream, sink('stdout'), sink('stderr'));
    return stream;
  })).catch(() => null);
}
