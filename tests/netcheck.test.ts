import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkNetwork } from '../server/src/netcheck';

const ifaces = () => ({
  'Wi-Fi': [{ family: 'IPv4', address: '192.168.9.50', netmask: '255.255.255.0', internal: false }],
  'Склад': [{ family: 'IPv4', address: '10.8.0.107', netmask: '255.255.240.0', internal: false }],
}) as never;

test('сеть: VPN (WireGuard), перехватывающий 192.168.x.x, обнаруживается', async () => {
  // AllowedIPs пользователя: в туннель уходит всё 192.168.x.x, кроме 192.168.9.1
  const r = await checkNetwork(8080, { interfaces: ifaces, route: async (ip) => (ip === '192.168.9.1' ? 'Wi-Fi' : ip.startsWith('192.168.') ? 'Склад' : 'Wi-Fi') });
  assert.equal(r.problems.length, 1);
  assert.match(r.problems[0], /192\.168\.9\.0\/24.*Склад/);
  assert.deepEqual(r.addresses.map((a) => [a.address, a.kind]), [['192.168.9.50', 'lan'], ['10.8.0.107', 'vpn']]);
});

test('сеть: без перехвата проблем нет, VPN-адрес не предлагается терминалам', async () => {
  const r = await checkNetwork(8080, { interfaces: ifaces, route: async (ip) => (ip.startsWith('192.168.') ? 'Wi-Fi' : 'Склад') });
  assert.equal(r.problems.length, 0);
  assert.equal(r.addresses[0].url, 'http://192.168.9.50:8080');
});

test('сеть: адаптер WireGuard с произвольным именем не предлагается терминалам', async () => {
  const r = await checkNetwork(8080, { interfaces: ifaces, route: async () => 'Wi-Fi', vpnNames: async () => ['Склад'] });
  assert.equal(r.problems.length, 0);
  assert.deepEqual(r.addresses.filter((a) => a.kind === 'lan').map((a) => a.address), ['192.168.9.50']);
});
