// .light — controlled, isolated source-code build pipeline.
// NO customer Dockerfiles. NO host Docker socket. NO privileged builds.
// Builds run in a dedicated, resource-limited builder container with
// scratch space only; no access to Shade credentials or other tenants.
import { getDocker, networkName } from './docker.js';
import fs from 'fs';
import path from 'path';
import config from './config.js';

const BUILDER_IMAGE = process.env.BUILD_IMAGE || 'node:22-alpine';
const BUILD_TIMEOUT_MS = parseInt(process.env.BUILD_TIMEOUT_MS || '600000', 10);

function safeWorkloadPath(instanceId) {
  return path.join(config.dataRoot, 'builds', String(instanceId).replace(/[^A-Za-z0-9_-]/g, ''));
}

export function validateBuildSpec(spec) {
  if (!spec || typeof spec !== 'object') throw Object.assign(new Error('invalid_build_spec'), { status: 400 });
  const runtime = String(spec.runtime || '').toLowerCase();
  if (!/^[a-z0-9._-]+$/.test(runtime) || runtime.length > 60) throw Object.assign(new Error('invalid_runtime'), { status: 400 });
  const version = String(spec.version || '').toLowerCase();
  if (!/^[a-z0-9._-]+$/.test(version) || version.length > 40) throw Object.assign(new Error('invalid_version'), { status: 400 });
  for (const key of ['installCommand', 'buildCommand']) {
    const cmd = String(spec[key] || '');
    if (cmd.length > 2000) throw Object.assign(new Error('command_too_long'), { status: 400 });
    // Block obvious host-escaping patterns.
    const blocked = [/docker\b/, /\/var\/run/, /\brm\s+-rf\s+\//, /curl[^|]*\|\s*sh/, /:\(\)/];
    if (blocked.some((pattern) => pattern.test(cmd))) throw Object.assign(new Error('command_not_allowed'), { status: 400 });
  }
  if (spec.dockerfile) throw Object.assign(new Error('dockerfile_not_supported'), { status: 400 });
  return { runtime, version, installCommand: spec.installCommand || '', buildCommand: spec.buildCommand || '' };
}

// Build source (already extracted into workDir) into the instance's persistent volume.
export async function buildSource(payload) {
  const { instanceId, teamId, source, files, installCommand, buildCommand, runtime, version } = payload;
  const workDir = safeWorkloadPath(instanceId);
  const outDir = path.join(config.dataRoot, 'instances', String(instanceId).replace(/[^A-Za-z0-9_-]/g, ''), 'app');
  fs.mkdirSync(workDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });

  // Source is supplied as base64 file map { 'package.json': '...', 'src/main.js': '...' }
  if (source === 'upload' && files && typeof files === 'object') {
    for (const [name, content] of Object.entries(files)) {
      const safe = String(name).replace(/^(\.\.\/|\/)+/, '').replace(/\.\./g, '');
      const dest = path.join(workDir, safe);
      if (!dest.startsWith(workDir)) continue;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, Buffer.from(String(content), 'base64'));
    }
  }

  const d = getDocker();
  const name = `lt-build-${String(instanceId).replace(/[^A-Za-z0-9_-]/g, '')}`;
  try { await d.getContainer(name).remove({ force: true }); } catch { /* none */ }

  const command = `set -e; cd /workspace; ${installCommand ? installCommand + ';' : ''} ${buildCommand ? buildCommand + ';' : ''} cp -a /workspace/. /output/ 2>/dev/null || true`;
  const container = await d.createContainer({
    Image: BUILDER_IMAGE,
    name,
    Cmd: ['/bin/sh', '-c', command],
    HostConfig: {
      Binds: [`${workDir}:/workspace`, `${outDir}:/output`],
      NetworkMode: 'none', // no network during build by default; dependencies handled via controlled registries
      Memory: 2 * 1024 * 1024 * 1024,
      NanoCpus: 2e9,
      PidsLimit: 256,
      CapDrop: ['ALL'],
      SecurityOpt: ['no-new-privileges:true'],
      ReadonlyRootfs: false,
    },
    WorkingDir: '/workspace',
  });
  await container.start();
  const stream = await container.logs({ follow: true, stdout: true, stderr: true });
  const chunks = [];
  await new Promise((resolve) => {
    d.modem.demuxStream(stream, { write: (c) => chunks.push(c) }, { write: (c) => chunks.push(c) });
    const started = Date.now();
    const check = setInterval(async () => {
      try { const info = await container.inspect(); if (!info.State.Running) { clearInterval(check); resolve(); } }
      catch { clearInterval(check); resolve(); }
      if (Date.now() - started > BUILD_TIMEOUT_MS) { clearInterval(check); resolve(); }
    }, 1000);
    stream.on('end', resolve);
  });
  const info = await container.inspect();
  const exitCode = info.State.ExitCode;
  const logs = Buffer.concat(chunks).toString('utf8');
  try { await container.remove({ force: true }); } catch { /* none */ }
  return { ok: exitCode === 0, exitCode, logs: logs.slice(-8000), artifactPath: outDir, image: `${runtime}:${version}` };
}

// Clone a git repository into the build workspace (uses git CLI in a controlled container).
export async function cloneRepository(payload) {
  const { instanceId, repoUrl, ref, token } = payload;
  if (!/^https:\/\/[^\s]+$/.test(String(repoUrl))) throw Object.assign(new Error('invalid_repo_url'), { status: 400 });
  const workDir = safeWorkloadPath(instanceId);
  fs.mkdirSync(workDir, { recursive: true });
  const d = getDocker();
  const name = `lt-clone-${String(instanceId).replace(/[^A-Za-z0-9_-]/g, '')}`;
  try { await d.getContainer(name).remove({ force: true }); } catch { /* none */ }
  const cloneUrl = token ? repoUrl.replace('https://', `https://x-access-token:${token}@`) : repoUrl;
  const container = await d.createContainer({
    Image: 'alpine/git:latest',
    name,
    Cmd: ['clone', '--depth', '1', '--branch', String(ref || 'main'), cloneUrl, '/workspace'],
    HostConfig: { Binds: [`${workDir}:/workspace`], NetworkMode: 'bridge', Memory: 1024 * 1024 * 1024, CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges:true'] },
  });
  await container.start();
  await container.wait();
  const info = await container.inspect();
  await container.remove({ force: true }).catch(() => {});
  return { ok: info.State.ExitCode === 0, exitCode: info.State.ExitCode };
}
