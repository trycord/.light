// .light / Shade — global dependency detection + installation.
// Inspect -> detect runtime -> detect package manager -> resolve -> install ->
// verify. Runs inside a short-lived container with the customer workspace
// mounted at /home/container; never on the host and never as root.
import fs from 'fs';
import path from 'path';
import { getDocker } from './docker.js';
import { instanceDir } from './docker.js';

const CUSTOMER_ROOT = '/home/container';
const MAX_LOG = 20000;

export function detectProject(instanceId) {
  const dir = path.join(instanceDir(instanceId), 'app');
  const has = (f) => fs.existsSync(path.join(dir, f));
  const read = (f) => { try { return fs.readFileSync(path.join(dir, f), 'utf8'); } catch { return ''; } };

  // Node.js
  if (has('package.json')) {
    let manifest = {};
    try { manifest = JSON.parse(read('package.json') || '{}'); } catch { /* invalid */ }
    let pm = 'npm';
    if (manifest.packageManager) pm = String(manifest.packageManager).split('@')[0];
    if (pm === 'npm' && has('pnpm-lock.yaml')) pm = 'pnpm';
    else if (pm === 'npm' && has('yarn.lock')) pm = 'yarn';
    let command;
    if (pm === 'npm') command = has('package-lock.json') || has('npm-shrinkwrap.json') ? 'npm ci --no-audit --no-fund' : 'npm install --no-audit --no-fund';
    else if (pm === 'pnpm') command = 'pnpm install --frozen-lockfile';
    else command = has('yarn.lock') ? 'yarn install --immutable' : 'yarn install';
    return {
      runtime: 'node', packageManager: pm, command, manifest,
      lockfile: has('package-lock.json') ? 'package-lock.json' : has('pnpm-lock.yaml') ? 'pnpm-lock.yaml' : has('yarn.lock') ? 'yarn.lock' : null,
      alreadyInstalled: has('node_modules'),
      declared: Object.keys({ ...(manifest.dependencies || {}), ...(manifest.devDependencies || {}) }),
    };
  }

  // Python
  if (has('requirements.txt')) return { runtime: 'python', packageManager: 'pip', command: 'python -m pip install --disable-pip-version-check -r requirements.txt', alreadyInstalled: has('.venv'), declared: [] };
  if (has('pyproject.toml')) {
    const text = read('pyproject.toml');
    if (/\[tool\.poetry\]/.test(text)) return { runtime: 'python', packageManager: 'poetry', command: 'poetry install --no-interaction', alreadyInstalled: has('.venv'), declared: [] };
    if (/\[tool\.uv\]/.test(text) || has('uv.lock')) return { runtime: 'python', packageManager: 'uv', command: 'uv sync', alreadyInstalled: has('.venv'), declared: [] };
    return { runtime: 'python', packageManager: 'pip', command: 'python -m pip install --disable-pip-version-check .', alreadyInstalled: has('.venv'), declared: [] };
  }
  if (has('Pipfile.lock') || has('Pipfile')) return { runtime: 'python', packageManager: 'pipenv', command: 'pipenv install --deploy', alreadyInstalled: has('.venv'), declared: [] };

  // PHP / Ruby / Java / Go / Rust
  if (has('composer.json')) return { runtime: 'php', packageManager: 'composer', command: 'composer install --no-interaction --no-dev', alreadyInstalled: has('vendor'), declared: [] };
  if (has('Gemfile')) return { runtime: 'ruby', packageManager: 'bundler', command: 'bundle install', alreadyInstalled: has('vendor/bundle'), declared: [] };
  if (has('pom.xml')) return { runtime: 'java', packageManager: 'maven', command: 'mvn -q -DskipTests package', alreadyInstalled: has('target'), declared: [] };
  if (has('build.gradle') || has('build.gradle.kts')) return { runtime: 'java', packageManager: 'gradle', command: 'gradle build -q', alreadyInstalled: has('build'), declared: [] };
  if (has('go.mod')) return { runtime: 'go', packageManager: 'gomod', command: 'go mod download', alreadyInstalled: has('vendor'), declared: [] };
  if (has('Cargo.toml')) return { runtime: 'rust', packageManager: 'cargo', command: 'cargo fetch', alreadyInstalled: has('target'), declared: [] };

  return { runtime: 'unknown', packageManager: null, command: null, alreadyInstalled: false, declared: [] };
}

/**
 * Run the detected install command inside a short-lived container using the
 * same runtime image as the service. Returns structured progress + logs.
 */
export async function installDependencies({ instanceId, image, env = {}, command, packageManager }) {
  const d = getDocker();
  const hostDir = path.join(instanceDir(instanceId), 'app');
  // Customer files are written by the privileged agent; hand them to uid 1000
  // so the unprivileged install container can create node_modules/.venv, etc.
  try {
    const { execFileSync } = await import('child_process');
    execFileSync('chown', ['-R', '1000:1000', hostDir]);
  } catch (error) { console.error('[deps] chown failed:', error.message); }
  const name = `lt-deps-${String(instanceId).replace(/[^A-Za-z0-9_-]/g, '').slice(-24)}`;
  const logs = [];
  const started = Date.now();

  const config = {
    Image: image || 'node:22-bookworm-slim',
    name,
    Cmd: ['/bin/sh', '-c', command],
    Env: [
      ...Object.entries(env || {}).filter(([k]) => /^(NODE_ENV|NPM_CONFIG|PNPM|YARN|PYTHON|PIP|COMPOSER|BUNDLE|MAVEN|GRADLE|CARGO|GO)/i.test(k)).map(([k, v]) => `${k}=${v}`),
      'HOME=/home/container', 'npm_config_cache=/tmp/npm-cache',
    ],
    WorkingDir: CUSTOMER_ROOT,
    User: '1000:1000',
    HostConfig: {
      Binds: [`${hostDir}:${CUSTOMER_ROOT}`],
      NetworkMode: 'none', // installs need registry access — override below
      CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges:true'],
      Memory: 2 * 1024 * 1024 * 1024, NanoCpus: 2e9, PidsLimit: 512,
      AutoRemove: false,
    },
  };
  // Dependency installs need outbound network to package registries.
  config.HostConfig.NetworkMode = 'bridge';

  try { const stale = d.getContainer(name); await stale.inspect(); await stale.remove({ force: true }); } catch {}

  const container = await d.createContainer(config);
  await container.start();
  // Container logs are a multiplexed stream (8-byte frame headers), NOT a
  // JSON progress stream — demux it instead of using followProgress.
  const stream = await container.logs({ follow: true, stdout: true, stderr: true });
  await new Promise((resolve) => {
    getDocker().modem.demuxStream(stream,
      { write: (chunk) => { logs.push(chunk.toString('utf8')); if (logs.join('').length > MAX_LOG) logs.shift(); } },
      { write: (chunk) => { logs.push(chunk.toString('utf8')); if (logs.join('').length > MAX_LOG) logs.shift(); } });
    stream.on('end', resolve);
    stream.on('error', resolve);
  });
  const info = await container.inspect();
  const exitCode = info.State?.ExitCode ?? -1;
  try { await container.remove({ force: true }); } catch {}

  return {
    ok: exitCode === 0,
    exitCode,
    packageManager,
    command,
    durationMs: Date.now() - started,
    output: logs.join('').slice(-MAX_LOG),
  };
}

/** Verify that declared modules resolve after install. */
export function verifyNodeModules(instanceId, declared = []) {
  const dir = path.join(instanceDir(instanceId), 'app');
  const missing = declared.filter((name) => !fs.existsSync(path.join(dir, 'node_modules', ...name.split('/'))));
  return { ok: missing.length === 0, missing };
}
