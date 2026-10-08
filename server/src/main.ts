/**
 * Performance Warehouse — локальный сервер склада.
 *
 * Запускается на ПК склада, хранит базу (SQLite) и обслуживает:
 *  - терминалы (Android-приложение, ТСД) по Wi-Fi через HTTP API;
 *  - рабочее место на ПК — веб-версию приложения в браузере (то же приложение).
 *
 * Запуск: node pw-server.cjs [--port 8080] [--data ./data] [--web ./web]
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
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

export const VERSION = '2.0.0';

// ---------------------------------------------------------------- параметры

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : process.env[`PW_${name.toUpperCase()}`] ?? def;
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

function validatePassword(p: unknown): string {
  if (typeof p !== 'string' || p.length < 4) throw new BusinessError('Пароль должен быть не короче 4 символов');
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
  port: number;
  dataDir: string;
  webDir: string | null;
  quiet?: boolean;
}

export async function startServer(opts: ServerOptions) {
  mkdirSync(opts.dataDir, { recursive: true });
  const dbFile = join(opts.dataDir, 'warehouse.db');
  if (existsSync(dbFile)) copyFileSync(dbFile, join(opts.dataDir, 'warehouse.before-start.db'));
  const raw = new DatabaseSync(dbFile);
  const db = new NodeDb(raw);
  await migrate(db);
  const queue = createQueue();
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
      net = await checkNetwork(opts.port);
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
  void doNetCheck();
  const netTimer = setInterval(doNetCheck, 5 * 60 * 1000);
  netTimer.unref();

  async function currentUser(req: IncomingMessage): Promise<{ user: SessionUser; token: string } | null> {
    const h = req.headers.authorization ?? '';
    const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
    if (!token) return null;
    const user = await auth.userBySession(db, token);
    return user ? { user, token } : null;
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
        });
      }
      case '/api/auth/setup': {
        const pw = validatePassword(body.password);
        const { salt, hash } = hashPassword(pw);
        const id = await auth.registerFirstAdmin(db, { login: String(body.login ?? ''), fullName: String(body.fullName ?? ''), passHash: hash, salt });
        const token = await auth.createSession(db, id, device);
        return send(res, 200, { token, user: await auth.userBySession(db, token) });
      }
      case '/api/auth/login': {
        const row = await auth.findForLogin(db, String(body.login ?? ''));
        if (!row || !row.active || !checkPassword(String(body.password ?? ''), row.salt, row.pass_hash)) {
          throw new BusinessError('Неверный логин или пароль', 'auth');
        }
        const token = await auth.createSession(db, row.id, device);
        return send(res, 200, { token, user: await auth.userBySession(db, token) });
      }
      case '/api/auth/invite': {
        const inv = await auth.inviteInfo(db, String(body.token ?? ''));
        return send(res, 200, {
          role: inv.role, department: inv.department_name, supervisor: inv.supervisor_name, createdBy: inv.created_by_name,
          orgName: (await getMeta(db, 'org_name')) ?? '',
        });
      }
      case '/api/auth/join': {
        const pw = validatePassword(body.password);
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
        const lan = net?.addresses.filter((a) => a.kind === 'lan').map((a) => a.url) ?? lanAddresses(opts.port);
        return send(res, 200, {
          version: VERSION,
          urls: lan,
          vpnUrls: net?.addresses.filter((a) => a.kind === 'vpn').map((a) => `${a.url} (${a.iface})`) ?? [],
          problems: net?.problems ?? [],
          addresses: net?.addresses ?? [],
          dataDir: resolve(opts.dataDir),
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

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
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
        const status = business ? ((e as BusinessError).code === 'forbidden' ? 403 : (e as BusinessError).code === 'auth' ? 401 : 400) : 500;
        if (!business) console.error('[api]', url.pathname, e);
        if (!res.headersSent) {
          send(res, status, { error: { message: business ? (e as Error).message : 'Внутренняя ошибка сервера', code: business ? (e as BusinessError).code : 'internal' } });
        }
      })
      .finally(() => log(`${new Date().toISOString().slice(11, 19)} ${req.method} ${url.pathname} ${res.statusCode} ${Date.now() - started}ms`));
  });

  await new Promise<void>((ok) => server.listen(opts.port, '0.0.0.0', ok));
  return {
    server,
    db,
    close: () => new Promise<void>((ok) => { clearInterval(backupTimer); clearInterval(netTimer); server.close(() => { raw.close(); ok(); }); }),
  };
}

// ---------------------------------------------------------------- запуск из командной строки

if (require.main === module) {
  const port = Number(arg('port', '8080'));
  const baseDir = process.env.PW_HOME ?? process.cwd();
  const dataDir = resolve(baseDir, arg('data', 'data'));
  const webArg = arg('web', 'web');
  const webDir = existsSync(resolve(baseDir, webArg)) ? resolve(baseDir, webArg) : null;
  startServer({ port, dataDir, webDir })
    .then(async () => {
      const net = await checkNetwork(port).catch(() => null);
      console.log('');
      console.log('  Performance Warehouse — локальный сервер склада', VERSION);
      console.log('  База данных:', join(dataDir, 'warehouse.db'));
      console.log('');
      console.log('  Рабочее место на этом ПК:  http://localhost:' + port);
      for (const a of net?.addresses ?? lanAddresses(port).map((url) => ({ url, kind: 'lan', iface: '' }))) {
        if (a.kind === 'lan') console.log(`  Для терминалов по Wi-Fi:   ${a.url}${a.iface ? `  (${a.iface})` : ''}`);
        else console.log(`  VPN, не для терминалов:    ${a.url}  (${a.iface})`);
      }
      console.log('');
      console.log('  Не закрывайте это окно, пока работает склад.');
      console.log('');
    })
    .catch((e) => {
      console.error('Не удалось запустить сервер:', e instanceof Error ? e.message : e);
      process.exit(1);
    });
}
