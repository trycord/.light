// .light — single-container process supervisor.
// Runs the control plane and the built-in node agent in one container.
// LT_MODE=all (default) | server | agent

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import autoSecrets from './server/secrets.js';
autoSecrets();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mode = process.env.LT_MODE || 'all';

const children = [];
let shuttingDown = false;

function start(script, env = {}) {
  const child = spawn(process.execPath, [path.join(__dirname, script)], {
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    console.error(`[.light] ${script} exited (code=${code}, signal=${signal}) — stopping container`);
    shutdown(code || 1);
  });
  children.push(child);
  return child;
}

if (mode === 'all' || mode === 'server') {
  start('server/index.js');
}
if (mode === 'all' || mode === 'agent') {
  // Give the control plane a moment to bind before the agent starts polling.
  setTimeout(() => start('agent/index.js'), mode === 'all' ? 800 : 0);
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
  const timer = setTimeout(() => {
    for (const child of children) if (!child.killed) child.kill('SIGKILL');
    process.exit(code);
  }, 8000);
  timer.unref();
  let remaining = children.length;
  if (remaining === 0) process.exit(code);
  for (const child of children) {
    child.once('exit', () => { if (--remaining === 0) process.exit(code); });
  }
}

process.on('SIGTERM', () => shutdown(0));
process.on('SIGINT', () => shutdown(0));
process.on('uncaughtException', (error) => { console.error('[.light] supervisor error', error); shutdown(1); });
