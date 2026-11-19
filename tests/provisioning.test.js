// .light — provisioning logic: Docker port binding + assigned-port reporting.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPortBindings } from '../agent/docker.js';
import { mergeAssignedPorts } from '../server/api/agent.js';

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
