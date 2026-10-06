import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { startServer } from '../server/src/main';

let base = '';
let close: () => Promise<void>;
const dataDir = mkdtempSync(join(tmpdir(), 'pw-server-'));

before(async () => {
  const port = 18000 + Math.floor(Math.random() * 1000);
  const s = await startServer({ port, dataDir, webDir: null, quiet: true });
  close = s.close;
  base = `http://127.0.0.1:${port}`;
});

after(() => close());

async function post(path: string, body: unknown, token?: string) {
  const r = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json()) as Record<string, any> };
}

const rpc = async (token: string, method: string, ...args: unknown[]) => {
  const r = await post('/api/rpc', { method, args }, token);
  if (r.json.error) throw Object.assign(new Error(r.json.error.message), { status: r.status });
  return r.json.result;
};

test('сервер: первичная настройка, приглашение, работа по API, права и резервная копия', async () => {
  const ping = await (await fetch(base + '/api/ping')).json();
  assert.equal(ping.needsSetup, true);

  const setup = await post('/api/auth/setup', { login: 'admin', fullName: 'Админ', password: 'secret1' });
  assert.equal(setup.json.user.role, 'admin');
  const adminToken = setup.json.token as string;
  assert.equal((await post('/api/auth/setup', { login: 'x', fullName: 'X', password: 'secret1' })).status, 400);

  // без входа — 401
  assert.equal((await post('/api/rpc', { method: 'listItems', args: [] })).status, 401);
  assert.equal((await post('/api/auth/login', { login: 'admin', password: 'wrong' })).status, 401);

  // руководитель по приглашению администратора
  const inv = await rpc(adminToken, 'createInvite', { role: 'manager' });
  const info = await post('/api/auth/invite', { token: inv.token });
  assert.equal(info.json.role, 'manager');
  const boss = await post('/api/auth/join', { token: inv.token, login: 'boss', fullName: 'Руководитель', password: 'pass1' });
  const bossToken = boss.json.token as string;

  // руководитель приглашает разнорабочего
  const inv2 = await rpc(bossToken, 'createInvite', { role: 'worker' });
  const worker = await post('/api/auth/join', { token: inv2.token, login: 'worker', fullName: 'Разнорабочий', password: 'pass1' });
  assert.equal(worker.json.user.supervisor_id, boss.json.user.id);

  // склад и номенклатура через API
  const wh = await rpc(bossToken, 'saveWarehouse', { code: 'СК1', name: 'Склад' });
  await rpc(bossToken, 'importItems', [{ sku: 'A1', name: 'Каска', barcode: '777' }]);
  const doc = await rpc(bossToken, 'createDocument', 'receipt', 'fact', { warehouseId: wh });
  await rpc(bossToken, 'addLineByCode', doc, '777', 3);
  await rpc(bossToken, 'postReceipt', doc);
  const items = await rpc(bossToken, 'listItems', '');
  assert.equal(items[0].total, 3);

  // разнорабочему склад недоступен — 403
  await assert.rejects(rpc(worker.json.token, 'saveWarehouse', { code: 'X', name: 'X' }), (e: any) => e.status === 403);
  await assert.rejects(rpc(adminToken, 'noSuchMethod'), /Неизвестная операция/);

  // вход логином и выход
  const login = await post('/api/auth/login', { login: 'worker', password: 'pass1' });
  assert.equal(login.status, 200);
  await post('/api/auth/logout', {}, login.json.token);
  assert.equal((await post('/api/auth/me', {}, login.json.token)).status, 401);

  assert.ok(readdirSync(join(dataDir, 'backups')).some((f) => f.endsWith('.db')));
});
