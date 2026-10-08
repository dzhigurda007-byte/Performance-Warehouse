import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { startServer } from '../server/src/main';

let base = '';
let close: () => Promise<void>;
let setupCode: () => string | null;
const dataDir = mkdtempSync(join(tmpdir(), 'pw-online-'));

before(async () => {
  const port = 19000 + Math.floor(Math.random() * 1000);
  const s = await startServer({ port, dataDir, webDir: null, quiet: true, online: true, publicUrl: 'https://sklad.example.ru' });
  close = s.close;
  setupCode = s.setupCode;
  base = `http://127.0.0.1:${port}`;
});

after(() => close());

async function post(path: string, body: unknown, token?: string) {
  const r = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: r.status, headers: r.headers, json: (await r.json()) as Record<string, any> };
}

test('онлайн-сервер: администратор только с кодом установки, вход по приглашениям, защита от подбора', async () => {
  const ping = await (await fetch(base + '/api/ping')).json();
  assert.deepEqual([ping.needsSetup, ping.setupCodeRequired, ping.online], [true, true, true]);
  const code = setupCode()!;
  assert.match(code, /^[0-9A-F]{10}$/);
  assert.equal(readFileSync(join(dataDir, 'setup-code.txt'), 'utf8').trim(), code);

  // без кода / с неверным кодом администратора не создать — даже первым
  assert.equal((await post('/api/auth/setup', { login: 'hacker', fullName: 'X', password: 'password1' })).status, 401);
  assert.equal((await post('/api/auth/setup', { login: 'hacker', fullName: 'X', password: 'password1', setupCode: 'ABCDEF0123' })).status, 401);
  // короткий пароль в онлайн-режиме не принимается
  assert.match((await post('/api/auth/setup', { login: 'admin', fullName: 'А', password: 'short', setupCode: code })).json.error.message, /не короче 8/);
  const setup = await post('/api/auth/setup', { login: 'admin', fullName: 'Админ', password: 'admin-pass-1', setupCode: code.toLowerCase() });
  assert.equal(setup.status, 200);
  assert.equal(setupCode(), null); // код одноразовый
  assert.equal(existsSync(join(dataDir, 'setup-code.txt')), false);
  assert.equal((await post('/api/auth/setup', { login: 'x', fullName: 'X', password: 'password1', setupCode: code })).status, 400);
  const admin = setup.json.token as string;

  // заголовки безопасности, CORS закрыт, HSTS при https-адресе
  const h = setup.headers;
  assert.equal(h.get('access-control-allow-origin'), null);
  assert.equal(h.get('x-content-type-options'), 'nosniff');
  assert.match(h.get('strict-transport-security') ?? '', /max-age/);

  // регистрации без приглашения нет; приглашение задаёт роль
  const inv = (await post('/api/rpc', { method: 'createInvite', args: [{ role: 'worker' }] }, admin)).json.result;
  assert.equal(inv.token.length, 24);
  const info = await post('/api/auth/invite', { token: inv.token });
  assert.equal(info.json.role, 'worker');
  assert.equal((await post('/api/auth/join', { token: 'неверный', login: 'u1', fullName: 'U', password: 'password1' })).status, 400);
  const joined = await post('/api/auth/join', { token: inv.token, login: 'rab1', fullName: 'Разнорабочий', password: 'worker-pass' });
  assert.equal(joined.json.user.role, 'worker');
  // приглашение одноразовое
  assert.equal((await post('/api/auth/join', { token: inv.token, login: 'rab2', fullName: 'Ещё', password: 'worker-pass' })).status, 400);
  // права — по роли из приглашения: разнорабочий не приглашает и не видит сотрудников
  const w = joined.json.token as string;
  assert.equal((await post('/api/rpc', { method: 'createInvite', args: [{ role: 'worker' }] }, w)).status, 403);
  assert.equal((await post('/api/rpc', { method: 'listUsers', args: [] }, w)).status, 403);
  // без входа API закрыт
  assert.equal((await post('/api/rpc', { method: 'listWarehouses', args: [] })).status, 401);

  // адрес в интернете — для ссылок-приглашений
  const sinfo = await post('/api/server/info', {}, admin);
  assert.deepEqual([sinfo.json.online, sinfo.json.publicUrl], [true, 'https://sklad.example.ru']);

  // подбор пароля: после 8 неудач логин блокируется на 15 минут, даже с верным паролем
  for (let i = 0; i < 8; i++) assert.equal((await post('/api/auth/login', { login: 'admin', password: `wrong${i}` })).status, 401);
  const locked = await post('/api/auth/login', { login: 'admin', password: 'admin-pass-1' });
  assert.equal(locked.status, 429);
  assert.match(locked.json.error.message, /Повторите через 15 мин/);
  // другой логин с того же IP пока входит
  assert.equal((await post('/api/auth/login', { login: 'rab1', password: 'worker-pass' })).status, 200);
});
