/**
 * Performance Warehouse — локальный сервер склада.
 *
 * Запускается на ПК склада, хранит базу (SQLite) и обслуживает:
 *  - терминалы (Android-приложение, ТСД) по Wi-Fi через HTTP API;
 *  - рабочее место на ПК — веб-версию приложения в браузере (то же приложение).
 *
 * Запуск: node pw-server.cjs [--port 8080] [--data ./data] [--web ./web]
 *
 * Онлайн-сервер (доступ из интернета, только по приглашениям):
 *   node pw-server.cjs --online --public-url https://sklad.example.ru [--tls-cert cert.pem --tls-key key.pem] [--trust-proxy]
 *   или переменные окружения PW_ONLINE=1, PW_PUBLIC_URL, PW_TLS_CERT, PW_TLS_KEY, PW_TRUST_PROXY=1.
 * В онлайн-режиме первый администратор создаётся только с кодом установки из консоли сервера,
 * вход ограничен по числу попыток, пароли — от 8 символов, CORS закрыт.
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { api, type ApiMethod } from '../../src/core/api';
import { can } from '../../src/core/roles';
import type { Ctx, SessionUser } from '../../src/core/ctx';
import { BusinessError, getMeta } from '../../src/core/db';
import { migrate } from '../../src/core/schema';
import { auth } from '../../src/core/services/users';
import { NodeDb } from './nodeDb';
import { checkNetwork, type NetReport } from './netcheck';

export const VERSION = '3.1.0';

// ---------------------------------------------------------------- параметры

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1]
    : process.env[`PW_${name.toUpperCase().replace(/-/g, '_')}`] ?? def;
}

/** Флаг: --online или PW_ONLINE=1 / true / yes. */
function flag(name: string): boolean {
  if (process.argv.includes(`--${name}`)) return true;
  return /^(1|true|yes|да)$/i.test(process.env[`PW_${name.toUpperCase().replace(/-/g, '_')}`] ?? '');
}

// ---------------------------------------------------------------- защита от подбора

/**
 * Ограничение попыток: не больше limit событий за window мс на ключ (IP, IP+логин).
 * Хранится в памяти — после перезапуска сервера счётчики обнуляются.
 */
export function createLimiter() {
  const hits = new Map<string, { n: number; until: number }>();
  return {
    /** Сколько ещё можно (0 — заблокировано) и сколько минут ждать. */
    check(key: string, limit: number) {
      const h = hits.get(key);
      if (!h || h.until < Date.now()) return { ok: true, waitMin: 0 };
      return { ok: h.n < limit, waitMin: Math.ceil((h.until - Date.now()) / 60000) };
    },
    hit(key: string, windowMs: number) {
      const h = hits.get(key);
      if (!h || h.until < Date.now()) hits.set(key, { n: 1, until: Date.now() + windowMs });
      else h.n++;
      if (hits.size > 50000) for (const [k, v] of hits) if (v.until < Date.now()) hits.delete(k);
    },
    reset(key: string) {
      hits.delete(key);
    },
  };
}

// ---------------------------------------------------------------- пароли

function hashPassword(password: string, salt = randomBytes(16).toString('hex')) {
  return { salt, hash: scryptSync(password, salt, 32).toString('hex') };
}

function checkPassword(password: string, salt: string, hash: string) {
  const a = Buffer.from(scryptSync(password, salt, 32).toString('hex'));
  const b = Buffer.from(hash);
  return a.length === b.length && timingSafeEqual(a, b);
}

function validatePassword(p: unknown, min = 4): string {
  if (typeof p !== 'string' || p.length < min) throw new BusinessError(`Пароль должен быть не короче ${min} символов`);
  return p;
}

// ---------------------------------------------------------------- очередь

/**
 * Все обращения к базе выполняются строго по очереди: одно соединение SQLite,
 * транзакции не перемешиваются между запросами разных терминалов.
 */
function createQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const run = tail.then(fn, fn);
    tail = run.catch(() => undefined);
    return run;
  };
}

// ---------------------------------------------------------------- сеть

export function lanAddresses(port: number): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) out.push(`http://${a.address}:${port}`);
  }
  return out;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
  '.apk': 'application/vnd.android.package-archive',
};

async function readBody(req: IncomingMessage, limit = 20 * 1024 * 1024): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > limit) throw new BusinessError('Слишком большой запрос');
    chunks.push(c as Buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

function send(res: ServerResponse, status: number, body: unknown) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(data);
}

// ---------------------------------------------------------------- резервные копии

function backup(raw: DatabaseSync, dir: string, keep = 30) {
  mkdirSync(dir, { recursive: true });
  const day = new Date().toISOString().slice(0, 10);
  const file = join(dir, `warehouse-${day}.db`);
  if (existsSync(file)) return;
  raw.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const files = readdirSync(dir).filter((f) => /^warehouse-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort();
  for (const f of files.slice(0, Math.max(0, files.length - keep))) rmSync(join(dir, f));
  console.log(`[backup] ${file}`);
}

/** Резервная копия по кнопке (раздел «Разработчик»): warehouse-manual-ГГГГ-ММ-ДД-ЧЧММСС.db. */
function manualBackup(raw: DatabaseSync, dir: string) {
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const name = `warehouse-manual-${stamp}.db`;
  raw.exec(`VACUUM INTO '${join(dir, name).replace(/'/g, "''")}'`);
  console.log(`[backup] ${name} (вручную)`);
  return name;
}

// ---------------------------------------------------------------- сервер

export interface ServerOptions {
  /** Номер порта или путь к Unix-сокету (так иногда задаёт панель хостинга). */
  port: number | string;
  dataDir: string;
  webDir: string | null;
  quiet?: boolean;
  /** Доступ из интернета: код установки, лимиты входа, пароли от 8 символов, без CORS. */
  online?: boolean;
  /** Адрес сервера в интернете (для ссылок-приглашений и QR), напр. https://sklad.example.ru */
  publicUrl?: string | null;
  /** Встроенный HTTPS: пути к сертификату и ключу (PEM). */
  tls?: { cert: string; key: string } | null;
  /** Сервер за обратным прокси (Caddy, nginx): IP клиента берётся из X-Forwarded-For. */
  trustProxy?: boolean;
  host?: string;
  /** Код установки задан заранее (переменная PW_SETUP_CODE) — иначе генерируется. */
  setupCode?: string | null;
}

const LOGIN_WINDOW = 15 * 60 * 1000;
const LOGIN_FAILS = 8; // неудачных входов на логин с одного IP за 15 мин
const AUTH_PER_IP = 60; // любых попыток входа / приглашений с одного IP за 15 мин
const SESSION_IDLE_DAYS = 30;

export async function startServer(opts: ServerOptions) {
  mkdirSync(opts.dataDir, { recursive: true });
  const dbFile = join(opts.dataDir, 'warehouse.db');
  if (existsSync(dbFile)) copyFileSync(dbFile, join(opts.dataDir, 'warehouse.before-start.db'));
  const raw = new DatabaseSync(dbFile);
  const db = new NodeDb(raw);
  await migrate(db);
  const queue = createQueue();
  const online = !!opts.online;
  const minPassword = online ? 8 : 4;
  const limiter = createLimiter();

  // Онлайн: первого администратора создаёт только тот, у кого есть код установки (виден в консоли сервера).
  let setupCode: string | null = null;
  const setupFile = join(opts.dataDir, 'setup-code.txt');
  if (online && (await auth.userCount(db)) === 0) {
    setupCode = opts.setupCode?.trim() || randomBytes(5).toString('hex').toUpperCase();
    writeFileSync(setupFile, `${setupCode}\n`, { mode: 0o600 });
  }
  const log = (...a: unknown[]) => !opts.quiet && console.log(...a);

  const doBackup = () => {
    try {
      backup(raw, join(opts.dataDir, 'backups'));
    } catch (e) {
      console.error('[backup] ошибка', e);
    }
  };
  doBackup();
  const backupTimer = setInterval(doBackup, 60 * 60 * 1000);
  backupTimer.unref();

  // Диагностика сети: VPN, перехватывающий локальную сеть, — частая причина «ПК не видит телефоны».
  let net: NetReport | null = null;
  let netWarned = '';
  const doNetCheck = async () => {
    try {
      net = await checkNetwork(Number(opts.port) || 8080);
      const key = net.problems.join('|');
      if (key && key !== netWarned && !opts.quiet) {
        console.log('');
        for (const p of net.problems) console.log('  ВНИМАНИЕ: ' + p);
        console.log('');
      }
      netWarned = key;
    } catch (e) {
      console.error('[net]', e);
    }
  };
  // проверка локальной сети (VPN, перехват 192.168.x.x) — только для сервера на ПК склада
  const netTimer = online ? undefined : setInterval(doNetCheck, 5 * 60 * 1000);
  if (!online) void doNetCheck();
  netTimer?.unref();

  async function currentUser(req: IncomingMessage): Promise<{ user: SessionUser; token: string } | null> {
    const h = req.headers.authorization ?? '';
    const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
    if (!token) return null;
    const user = await auth.userBySession(db, token, online ? SESSION_IDLE_DAYS : undefined);
    return user ? { user, token } : null;
  }

  /** IP клиента: за прокси — из X-Forwarded-For (только если прокси доверенный). */
  function clientIp(req: IncomingMessage) {
    const fwd = opts.trustProxy ? String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() : '';
    return fwd || req.socket.remoteAddress || '?';
  }

  /** Общий лимит попыток входа / приглашений с одного IP. */
  function limitIp(req: IncomingMessage) {
    const key = `ip:${clientIp(req)}`;
    const c = limiter.check(key, AUTH_PER_IP);
    if (!c.ok) throw new BusinessError(`Слишком много попыток. Повторите через ${c.waitMin} мин.`, 'rate');
    limiter.hit(key, LOGIN_WINDOW);
  }

  async function handleApi(req: IncomingMessage, res: ServerResponse, path: string) {
    const body = (req.method === 'POST' ? await readBody(req) : {}) as Record<string, unknown>;
    const device = String(req.headers['user-agent'] ?? '').slice(0, 120);

    switch (path) {
      case '/api/ping': {
        return send(res, 200, {
          app: 'performance-warehouse',
          version: VERSION,
          orgName: (await getMeta(db, 'org_name')) ?? '',
          needsSetup: (await auth.userCount(db)) === 0,
          setupCodeRequired: !!setupCode,
          online,
        });
      }
      case '/api/auth/setup': {
        limitIp(req);
        if (setupCode) {
          const given = String(body.setupCode ?? '').trim().toUpperCase();
          const a = Buffer.from(given.padEnd(64).slice(0, 64));
          const b = Buffer.from(setupCode.padEnd(64).slice(0, 64));
          if (!given || !timingSafeEqual(a, b)) throw new BusinessError('Неверный код установки — он показан в окне сервера и в файле setup-code.txt', 'auth');
        }
        const pw = validatePassword(body.password, minPassword);
        const { salt, hash } = hashPassword(pw);
        const id = await auth.registerFirstAdmin(db, { login: String(body.login ?? ''), fullName: String(body.fullName ?? ''), passHash: hash, salt });
        const token = await auth.createSession(db, id, device);
        if (setupCode) {
          setupCode = null;
          rmSync(setupFile, { force: true });
        }
        return send(res, 200, { token, user: await auth.userBySession(db, token) });
      }
      case '/api/auth/login': {
        limitIp(req);
        const loginKey = `login:${clientIp(req)}:${String(body.login ?? '').trim().toLowerCase()}`;
        const lc = limiter.check(loginKey, LOGIN_FAILS);
        if (!lc.ok) throw new BusinessError(`Слишком много неудачных попыток входа. Повторите через ${lc.waitMin} мин.`, 'rate');
        const row = await auth.findForLogin(db, String(body.login ?? ''));
        if (!row || !row.active || !checkPassword(String(body.password ?? ''), row.salt, row.pass_hash)) {
          limiter.hit(loginKey, LOGIN_WINDOW);
          throw new BusinessError('Неверный логин или пароль', 'auth');
        }
        limiter.reset(loginKey);
        const token = await auth.createSession(db, row.id, device);
        return send(res, 200, { token, user: await auth.userBySession(db, token) });
      }
      case '/api/auth/invite': {
        limitIp(req);
        const inv = await auth.inviteInfo(db, String(body.token ?? ''));
        return send(res, 200, {
          role: inv.role, department: inv.department_name, supervisor: inv.supervisor_name, createdBy: inv.created_by_name,
          orgName: (await getMeta(db, 'org_name')) ?? '',
        });
      }
      case '/api/auth/join': {
        limitIp(req);
        const pw = validatePassword(body.password, minPassword);
        const { salt, hash } = hashPassword(pw);
        const id = await auth.joinByInvite(db, String(body.token ?? ''), {
          login: String(body.login ?? ''), fullName: String(body.fullName ?? ''), passHash: hash, salt,
        });
        const token = await auth.createSession(db, id, device);
        return send(res, 200, { token, user: await auth.userBySession(db, token) });
      }
    }

    const session = await currentUser(req);
    if (!session) return send(res, 401, { error: { message: 'Требуется вход', code: 'auth' } });
    const ctx: Ctx = { db, user: session.user };

    switch (path) {
      case '/api/auth/me':
        return send(res, 200, { user: session.user });
      case '/api/auth/logout':
        await auth.dropSession(db, session.token);
        return send(res, 200, { ok: true });
      case '/api/server/info': {
        if (body.recheck) await doNetCheck();
        const lan = net?.addresses.filter((a) => a.kind === 'lan').map((a) => a.url) ?? lanAddresses(Number(opts.port) || 8080);
        return send(res, 200, {
          version: VERSION,
          urls: lan,
          vpnUrls: net?.addresses.filter((a) => a.kind === 'vpn').map((a) => `${a.url} (${a.iface})`) ?? [],
          problems: net?.problems ?? [],
          addresses: net?.addresses ?? [],
          dataDir: resolve(opts.dataDir),
          online,
          publicUrl: opts.publicUrl ?? null,
        });
      }
      case '/api/dev/backups': {
        // раздел «Разработчик»: резервные копии базы (только администратор)
        if (!can.develop(session.user.role)) return send(res, 403, { error: { message: 'Только администратор', code: 'forbidden' } });
        const dir = join(opts.dataDir, 'backups');
        let created: string | null = null;
        if (body.create) created = manualBackup(raw, dir);
        const files = existsSync(dir)
          ? readdirSync(dir).filter((f) => f.endsWith('.db')).sort().reverse()
            .map((f) => ({ name: f, size: statSync(join(dir, f)).size }))
          : [];
        return send(res, 200, { dir: resolve(dir), created, files });
      }
      case '/api/rpc': {
        const method = String(body.method ?? '') as ApiMethod;
        const fn = (api as Record<string, unknown>)[method] as ((c: Ctx, ...a: unknown[]) => Promise<unknown>) | undefined;
        if (!fn || !Object.prototype.hasOwnProperty.call(api, method)) {
          return send(res, 404, { error: { message: `Неизвестная операция ${method}`, code: 'not_found' } });
        }
        const args = Array.isArray(body.args) ? body.args : [];
        const result = await fn(ctx, ...args);
        return send(res, 200, { result: result === undefined ? null : result });
      }
    }
    return send(res, 404, { error: { message: 'Не найдено', code: 'not_found' } });
  }

  function serveStatic(req: IncomingMessage, res: ServerResponse, path: string) {
    if (!opts.webDir) {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end(`Performance Warehouse server ${VERSION}. Веб-интерфейс не установлен.`);
    }
    const root = resolve(opts.webDir);
    let file = normalize(join(root, decodeURIComponent(path)));
    if (!file.startsWith(root)) {
      res.writeHead(403);
      return res.end();
    }
    if (!existsSync(file) || statSync(file).isDirectory()) {
      const html = `${file}.html`;
      const index = join(file, 'index.html');
      if (existsSync(html)) file = html;
      else if (existsSync(index)) file = index;
      else file = join(root, 'index.html'); // SPA: маршрут обрабатывает само приложение
    }
    const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
    const immutable = file.includes(`${join('_expo', 'static')}`);
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': immutable ? 'public, max-age=31536000' : 'no-cache' });
    res.end(readFileSync(file));
  }

  const https = !!opts.tls || /^https:/i.test(opts.publicUrl ?? '');
  const handler = (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (https) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    // В локальной сети — открытый CORS (как раньше); онлайн — только своё приложение:
    // Android-приложению CORS не нужен, веб-версия открывается с того же адреса.
    if (!online) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }
    if (!url.pathname.startsWith('/api/')) {
      try {
        return serveStatic(req, res, url.pathname);
      } catch {
        res.writeHead(500);
        return res.end();
      }
    }
    const started = Date.now();
    queue(() => handleApi(req, res, url.pathname))
      .catch((e: unknown) => {
        const business = e instanceof BusinessError;
        const code = business ? (e as BusinessError).code : '';
        const status = business ? (code === 'forbidden' ? 403 : code === 'auth' ? 401 : code === 'rate' ? 429 : 400) : 500;
        if (!business) console.error('[api]', url.pathname, e);
        if (!res.headersSent) {
          send(res, status, { error: { message: business ? (e as Error).message : 'Внутренняя ошибка сервера', code: business ? (e as BusinessError).code : 'internal' } });
        }
      })
      .finally(() => log(`${new Date().toISOString().slice(11, 19)} ${req.method} ${url.pathname} ${res.statusCode} ${Date.now() - started}ms`));
  };
  const server = opts.tls
    ? createHttpsServer({ cert: readFileSync(opts.tls.cert), key: readFileSync(opts.tls.key) }, handler)
    : createServer(handler);

  const socket = typeof opts.port === 'string' && !/^\d+$/.test(opts.port) ? opts.port : null;
  if (socket) {
    rmSync(socket, { force: true }); // сокет от прошлого запуска
    await new Promise<void>((ok) => server.listen(socket, ok));
  } else {
    await new Promise<void>((ok) => server.listen(Number(opts.port), opts.host ?? '0.0.0.0', ok));
  }
  return {
    server,
    db,
    setupCode: () => setupCode,
    close: () => new Promise<void>((ok) => { clearInterval(backupTimer); clearInterval(netTimer); server.close(() => { raw.close(); ok(); }); }),
  };
}

// ---------------------------------------------------------------- запуск из командной строки

/**
 * Запуск сервера с параметрами из командной строки и переменных окружения.
 * Вызывается напрямую (node pw-server.cjs …) или из app.js на хостинге (ISPmanager, Passenger).
 */
export function runCli() {
  // порт: --port / PW_PORT, иначе PORT от панели хостинга, иначе 8080; может быть путём к сокету
  const portArg = arg('port', process.env.PORT ?? '8080');
  const port: number | string = /^\d+$/.test(portArg) ? Number(portArg) : portArg;
  const baseDir = process.env.PW_HOME ?? process.cwd();
  const dataDir = resolve(baseDir, arg('data', 'data'));
  const webArg = arg('web', 'web');
  const webDir = existsSync(resolve(baseDir, webArg)) ? resolve(baseDir, webArg) : null;
  const online = flag('online');
  const publicUrl = arg('public-url', '').replace(/\/+$/, '') || null;
  const cert = arg('tls-cert', '');
  const key = arg('tls-key', '');
  const tls = cert && key ? { cert: resolve(baseDir, cert), key: resolve(baseDir, key) } : null;
  startServer({
    port, dataDir, webDir, online, publicUrl, tls,
    trustProxy: flag('trust-proxy'), host: arg('host', '0.0.0.0'), setupCode: arg('setup-code', '') || null,
  })
    .then(async (srv) => {
      console.log('');
      console.log('  Performance Warehouse — сервер склада', VERSION);
      console.log('  База данных:', join(dataDir, 'warehouse.db'));
      console.log('');
      if (online) {
        console.log('  РЕЖИМ: онлайн-сервер (доступ из интернета только по приглашениям)');
        console.log(`  Адрес в интернете:        ${publicUrl ?? '(не задан — укажите --public-url / PW_PUBLIC_URL)'}`);
        console.log(`  Слушает:                  ${typeof port === 'string' ? `сокет ${port}` : `${tls ? 'https' : 'http'}://${arg('host', '0.0.0.0')}:${port}`}`);
        if (!tls && !/^https:/i.test(publicUrl ?? '')) {
          console.log('  ВНИМАНИЕ: нет HTTPS. В интернете пароли и данные нужно защищать — поставьте сервер за Caddy/nginx');
          console.log('            с сертификатом или укажите --tls-cert и --tls-key.');
        }
        const code = srv.setupCode();
        if (code) {
          console.log('');
          console.log(`  КОД УСТАНОВКИ: ${code}`);
          console.log('  Откройте адрес сервера и создайте администратора с этим кодом.');
          console.log(`  Код также записан в ${join(dataDir, 'setup-code.txt')} и удалится после создания администратора.`);
        }
      } else {
        const net = await checkNetwork(Number(port) || 8080).catch(() => null);
        console.log('  Рабочее место на этом ПК:  http://localhost:' + port);
        for (const a of net?.addresses ?? lanAddresses(Number(port) || 8080).map((url) => ({ url, kind: 'lan', iface: '' }))) {
          if (a.kind === 'lan') console.log(`  Для терминалов по Wi-Fi:   ${a.url}${a.iface ? `  (${a.iface})` : ''}`);
          else console.log(`  VPN, не для терминалов:    ${a.url}  (${a.iface})`);
        }
        console.log('');
        console.log('  Не закрывайте это окно, пока работает склад.');
      }
      console.log('');
    })
    .catch((e) => {
      console.error('Не удалось запустить сервер:', e instanceof Error ? e.message : e);
      process.exit(1);
    });
}

if (require.main === module) runCli();
