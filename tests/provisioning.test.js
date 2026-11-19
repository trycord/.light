// .light — provisioning logic: Docker port binding + assigned-port reporting.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPortBindings, buildContainerConfig } from '../agent/docker.js';
import { mergeAssignedPorts } from '../server/api/agent.js';
import { customImageRef, isDebianImage, imageRef } from '../server/runtime-catalog.js';

test('auto ports use an empty HostPort so Docker chooses a free host port', () => {
  const { exposedPorts, portBindings } = buildPortBindings([
    { container: 80, host: 0, protocol: 'tcp' },
    { container: 25565, protocol: 'tcp' },
    { container: 19132, host: 0, protocol: 'udp' },
  ]);
  assert.deepEqual(portBindings['80/tcp'], [{ HostIp: '0.0.0.0', HostPort: '' }]);
  assert.deepEqual(portBindings['25565/tcp'], [{ HostIp: '0.0.0.0', HostPort: '' }]);
  assert.deepEqual(portBindings['19132/udp'], [{ HostIp: '0.0.0.0', HostPort: '' }]);
  assert.ok(exposedPorts['80/tcp'] && exposedPorts['19132/udp']);
});

test('explicit host ports are honoured', () => {
  const { portBindings } = buildPortBindings([{ container: 8080, host: 3000, protocol: 'tcp' }]);
  assert.deepEqual(portBindings['8080/tcp'], [{ HostIp: '0.0.0.0', HostPort: '3000' }]);
});

test('invalid port specs are skipped safely', () => {
  const { exposedPorts, portBindings } = buildPortBindings([{ container: 'nope' }, null, { container: 53, protocol: 'icmp' }]);
  assert.deepEqual(exposedPorts, {});
  assert.deepEqual(portBindings, {});
});

test('duplicate container ports with different protocols do not collide', () => {
  const { portBindings } = buildPortBindings([
    { container: 53, host: 0, protocol: 'tcp' },
    { container: 53, host: 0, protocol: 'udp' },
  ]);
  assert.equal(portBindings['53/tcp'][0].HostPort, '');
  assert.equal(portBindings['53/udp'][0].HostPort, '');
});

test('custom universal image is digest-pinned and injects exact runtime env', () => {
  const r = customImageRef('node', '22');
  assert.equal(r.image, 'trycord/light-runtime:1.0.0');
  assert.deepEqual(r.runtimeEnv, { LT_RUNTIME: 'node', LT_RUNTIME_VERSION: '22' });
  assert.throws(() => customImageRef('node', '18'), /runtime_version_not_in_image/);
});

test('only Debian-family images are approved', () => {
  assert.equal(isDebianImage('node:22-bookworm'), true);
  assert.equal(isDebianImage('trycord/light-runtime:1.0.0'), false, 'custom refs are validated by manifest, not by tag');
  assert.equal(isDebianImage('nginx:alpine'), false);
  assert.equal(imageRef({ image: 'node:22-bookworm', image_digest: 'abc', default_version: '22', version_images: {} }), 'node:22-bookworm@sha256:abc');
});

test('container config enforces the security model', () => {
  const cfg = buildContainerConfig({
    instanceId: 'ins_test', teamId: 'team_1', name: 'svc', image: 'trycord/light-runtime:1.0.0',
    command: 'npm start', env: { LT_RUNTIME: 'node', LT_RUNTIME_VERSION: '22' },
    ports: [{ container: 3000, host: 0, protocol: 'tcp' }], volumes: [{ path: '/data' }],
    cpu: 2, memory: 1024, environmentId: 'node', environmentVersion: '22',
  });
  assert.equal(cfg.Image, 'trycord/light-runtime:1.0.0');
  assert.equal(cfg.HostConfig.Privileged, undefined);
  assert.deepEqual(cfg.HostConfig.CapDrop, ['ALL']);
  assert.ok(cfg.HostConfig.SecurityOpt.includes('no-new-privileges:true'));
  assert.notEqual(cfg.HostConfig.NetworkMode, 'host');
  assert.equal(cfg.HostConfig.Memory, 1024 * 1024 * 1024);
  assert.ok(cfg.Env.includes('LT_RUNTIME=node'));
  assert.equal(cfg.Labels['lt.os'], 'debian');
  assert.ok(cfg.HostConfig.Binds[0].includes('/data'));
});

test('container config rejects unsafe images and host mounts', () => {
  const base = { instanceId: 'ins_x', teamId: 't', image: 'nginx:alpine', ports: [] };
  assert.throws(() => buildContainerConfig(base), /unapproved_image/);
  // Customer-supplied host paths are ignored: binds always come from Shade's own data root.
  const safe = buildContainerConfig({ ...base, image: 'nginx:bookworm', volumes: [{ path: '/data', host: '/var/run/docker.sock' }] });
  assert.ok(safe.HostConfig.Binds[0].startsWith('/tmp/opencode/light-node/') || safe.HostConfig.Binds[0].includes('/instances/'));
});

test('assigned host ports are merged back into the configured list', () => {
  const configured = [
    { container: 80, host: 0, protocol: 'tcp' },
    { container: 25565, host: 0, protocol: 'tcp' },
    { container: 5432, host: 5432, protocol: 'tcp' },
  ];
  const assigned = [
    { container: 80, host: 49153, protocol: 'tcp' },
    { container: 25565, host: 49154, protocol: 'tcp' },
  ];
  const merged = mergeAssignedPorts(configured, assigned);
  assert.equal(merged[0].host, 49153);
  assert.equal(merged[1].host, 49154);
  assert.equal(merged[2].host, 5432, 'unreported ports keep their configuration');
  assert.deepEqual(mergeAssignedPorts(null, null), []);
});
