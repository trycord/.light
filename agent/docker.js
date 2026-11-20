import Docker from 'dockerode';
import os from 'os';
import fs from 'fs';
import path from 'path';
import config from './config.js';

let docker;
export function getDocker() {
  if (!docker) {
    const socket = (config.dockerHost || '').replace(/^unix:\/\//, '') || '/var/run/docker.sock';
    docker = new Docker({ socketPath: socket });
  }
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

async function ensureNetwork(teamId) {
  const name = networkName(teamId);
  try { return await getDocker().getNetwork(name).inspect(); } catch { /* create */ }
  try { return await getDocker().createNetwork({ Name: name, Driver: 'bridge', Internal: false }); }
  catch (error) { if (error.statusCode === 409) return getDocker().getNetwork(name).inspect(); throw error; }
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
    environmentId, environmentVersion, healthcheck, security } = payload || {};
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
  if (healthcheck && Object.keys(healthcheck).length) config.Healthcheck = healthcheck;
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
  const { instanceId, teamId, name, image, command, env, ports, volumes, cpu, memory, disk } = payload;
  const d = getDocker();
  const config = buildContainerConfig(payload);
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

export function tunnelContainerName(teamId) {
  return `lt-tunnel-${String(teamId || 'default').replace(/[^A-Za-z0-9_-]/g, '').slice(-16)}`;
}

/** Run the Cloudflare connector inside our approved image on the team network. */
export function buildTunnelConfig({ teamId, token, hostname, image }) {
  if (!token) throw Object.assign(new Error('tunnel_token_required'), { status: 400 });
  return {
    Image: image || process.env.LIGHT_RUNTIME_IMAGE || 'trycord/light-runtime:1.0.0',
    name: tunnelContainerName(teamId),
    Cmd: ['/usr/local/bin/cloudflared', 'tunnel', '--no-autoupdate', 'run', '--token', String(token)],
    Env: [`LT_HOSTNAME=${String(hostname || '').slice(0, 200)}`],
    Labels: { 'lt.tunnel': 'cloudflare', 'lt.team': teamId || 'default', 'lt.hostname': String(hostname || '').slice(0, 100) },
    HostConfig: {
      NetworkMode: networkName(teamId || 'default'),
      RestartPolicy: { Name: 'unless-stopped', MaximumRetryCount: 0 },
      Memory: 256 * 1024 * 1024, MemorySwap: -1, NanoCpus: 0.5e9,
      PidsLimit: 256, CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges:true'], Init: true,
    },
  };
}

export async function startTunnelConnector({ teamId, token, hostname, image }) {
  const d = getDocker();
  const config = buildTunnelConfig({ teamId, token, hostname, image });
  const name = config.name;
  await ensureNetwork(teamId || 'default');
  const stale = d.getContainer(name);
  try { await stale.inspect(); try { await stale.remove({ force: true }); } catch { /* ignore */ } } catch { /* none */ }
  const container = await d.createContainer(config);
  await container.start();
  return { containerId: container.id, name };
}

export async function stopTunnelConnector({ teamId }) {
  const d = getDocker();
  const name = tunnelContainerName(teamId);
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

async function withContainer(instanceId, fn) {
  const d = getDocker();
  const containers = await d.listContainers({ all: true });
  const name = containerName(instanceId);
  const found = containers.find((c) => c.Names?.includes(`/${name}`));
  if (!found) throw Object.assign(new Error('container_not_found'), { status: 404 });
  return fn(d.getContainer(found.Id));
}

export async function startInstance(instanceId) { return withContainer(instanceId, (c) => c.start().then(() => ({ ok: true }))); }
export async function stopInstance(instanceId) { return withContainer(instanceId, (c) => c.stop({ t: 10 }).then(() => ({ ok: true }))); }
export async function restartInstance(instanceId) { return withContainer(instanceId, (c) => c.restart({ t: 10 }).then(() => ({ ok: true }))); }
export async function suspendInstance(instanceId) { return withContainer(instanceId, (c) => c.pause().then(() => ({ ok: true }))); }
export async function resumeInstance(instanceId) { return withContainer(instanceId, (c) => c.unpause().then(() => ({ ok: true }))); }

export async function removeInstance(instanceId) {
  return withContainer(instanceId, async (c) => {
    const info = await c.inspect().catch(() => ({}));
    if (info.State?.Running) await c.stop({ t: 5 }).catch(() => {});
    await c.remove({ force: true });
    return { ok: true };
  }).catch(() => ({ ok: true }));
}

export async function reinstallInstance(instanceId, payload) {
  await removeInstance(instanceId);
  return createInstance({ ...payload, instanceId });
}

export async function execCommand(instanceId, command) {
  return withContainer(instanceId, async (c) => {
    const exec = await c.exec({ Cmd: ['/bin/sh', '-c', command], AttachStdout: true, AttachStderr: true, Tty: false });
    const stream = await exec.start({ hijack: true, stdin: false });
    const chunks = [];
    await new Promise((resolve, reject) => {
      getDocker().modem.demuxStream(stream, { write: (c) => chunks.push(c) }, { write: (c) => chunks.push(c) });
      stream.on('end', resolve); stream.on('error', reject);
    });
    return { output: Buffer.concat(chunks).toString('utf8').slice(0, 20000) };
  });
}

export async function containerStatus(instanceId) {
  return withContainer(instanceId, async (c) => {
    const info = await c.inspect();
    return { status: info.State?.Running ? 'running' : info.State?.Paused ? 'suspended' : info.State?.Restarting ? 'restarting' : 'stopped', health: info.State?.Health?.Status || 'unknown' };
  }).catch(() => ({ status: 'missing', health: 'unknown' }));
}

export async function deployImage(instanceId, config = {}) {
  const image = config.image || 'nginx:alpine';
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

export async function containerStats(instanceId) {
  return withContainer(instanceId, async (c) => {
    const info = await c.inspect();
    if (!info.State?.Running) return null;
    const stats = await c.stats({ stream: false });
    const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - (stats.precpu_stats.cpu_usage?.total_usage || 0);
    const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
    const cpu = systemDelta > 0 ? Math.round((cpuDelta / systemDelta) * 100 * (stats.cpu_stats.online_cpus || 1)) : 0;
    const mem = stats.memory_stats.usage ? Math.round((stats.memory_stats.usage / (stats.memory_stats.limit || 1)) * 100) : 0;
    return { cpu, mem };
  }).catch(() => null);
}

export function followLogs(instanceId, onLine) {
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
