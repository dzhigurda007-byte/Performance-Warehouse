import type { ClientApi } from '../core/api';
import type { SessionUser } from '../core/ctx';
import { BusinessError } from '../core/db';
import type { Role } from '../core/roles';

export interface Ping {
  app: string;
  version: string;
  orgName: string;
  needsSetup: boolean;
  /** Онлайн-сервер: первый администратор создаётся только с кодом установки. */
  setupCodeRequired?: boolean;
  online?: boolean;
}

export interface InviteInfo {
  role: Role;
  department: string | null;
  supervisor: string | null;
  createdBy: string;
  orgName: string;
}

export interface ServerInfo {
  version: string;
  /** Адреса в локальной сети — для терминалов. */
  urls: string[];
  /** Адреса VPN-интерфейсов — терминалам не подходят. */
  vpnUrls: string[];
  /** Найденные проблемы сети (например, VPN перехватывает локальную сеть). */
  problems: string[];
  dataDir: string;
  /** Онлайн-сервер в интернете и его адрес. */
  online?: boolean;
  publicUrl?: string | null;
}

export interface AuthResult {
  token: string;
  user: SessionUser;
}

/**
 * Адрес сервера из того, что ввёл пользователь:
 *  «192.168.1.10» / «localhost» → http://…:8080 (сервер склада в локальной сети);
 *  «sklad.example.ru» → https://sklad.example.ru (онлайн-сервер в интернете, порт 443);
 *  явно указанные схема и порт сохраняются.
 */
export function normalizeServerUrl(input: string): string {
  let s = input.trim().replace(/\/+$/, '');
  if (!s) return s;
  const hasScheme = /^https?:\/\//i.test(s);
  const host = s.replace(/^https?:\/\//i, '').split('/')[0];
  const hostname = host.replace(/:\d+$/, '');
  const local = /^(localhost|\d{1,3}(\.\d{1,3}){3})$/i.test(hostname) || hostname.endsWith('.local');
  if (!hasScheme) s = `${local ? 'http' : 'https'}://${s}`;
  if (local && /^http:/i.test(s) && !/:\d+$/.test(host)) s = s.replace(host, `${host}:8080`);
  return s;
}

async function request<T>(url: string, body: unknown, token?: string | null, timeoutMs = 20000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch {
    throw new BusinessError(/^https:/i.test(url)
      ? 'Нет связи с онлайн-сервером склада. Проверьте интернет на устройстве и адрес сервера.'
      : 'Нет связи с сервером склада. Проверьте: телефон в Wi-Fi склада, сервер на ПК запущен, брандмауэр открыт, VPN на ПК не перехватывает локальную сеть (на ПК: «Ещё» → «Подключение терминалов»).', 'network');
  } finally {
    clearTimeout(timer);
  }
  let json: { error?: { message: string; code: string } } & Record<string, unknown>;
  try {
    json = await res.json();
  } catch {
    throw new BusinessError(`Сервер ответил некорректно (${res.status})`, 'network');
  }
  if (json.error) throw new BusinessError(json.error.message, json.error.code);
  return json as T;
}

export const remoteAuth = {
  ping: (server: string, timeoutMs?: number) => request<Ping>(`${server}/api/ping`, undefined, null, timeoutMs),
  setup: (server: string, p: { login: string; fullName: string; password: string; setupCode?: string }) =>
    request<AuthResult>(`${server}/api/auth/setup`, p),
  login: (server: string, login: string, password: string) =>
    request<AuthResult>(`${server}/api/auth/login`, { login, password }),
  invite: (server: string, token: string) => request<InviteInfo>(`${server}/api/auth/invite`, { token }),
  join: (server: string, p: { token: string; login: string; fullName: string; password: string }) =>
    request<AuthResult>(`${server}/api/auth/join`, p),
  me: (server: string, token: string) => request<{ user: SessionUser }>(`${server}/api/auth/me`, {}, token),
  logout: (server: string, token: string) => request(`${server}/api/auth/logout`, {}, token).catch(() => undefined),
  info: (server: string, token: string, recheck = false) =>
    request<ServerInfo>(`${server}/api/server/info`, { recheck }, token, 30000),
  /** Резервные копии базы (раздел «Разработчик», только администратор); create — сделать копию сейчас. */
  backups: (server: string, token: string, create = false) =>
    request<{ dir: string; created: string | null; files: { name: string; size: number }[] }>(
      `${server}/api/dev/backups`, { create }, token, 120000),
};

/** API, работающее через сервер склада: вызов → POST /api/rpc. */
export function remoteApi(server: string, getToken: () => string | null, onAuthLost: () => void): ClientApi {
  return new Proxy({} as ClientApi, {
    get(_t, method: string) {
      return async (...args: unknown[]) => {
        try {
          const r = await request<{ result: unknown }>(`${server}/api/rpc`, { method, args }, getToken());
          return r.result;
        } catch (e) {
          if (e instanceof BusinessError && e.code === 'auth') onAuthLost();
          throw e;
        }
      };
    },
  });
}

/**
 * Поиск сервера в локальной сети: перебор адресов подсети телефона
 * (порт 8080) с коротким таймаутом. Работает без дополнительных модулей.
 */
export async function scanSubnet(ownIp: string, port = 8080, onProgress?: (done: number) => void): Promise<string[]> {
  const m = /^(\d+\.\d+\.\d+)\.\d+$/.exec(ownIp);
  if (!m) return [];
  const found: string[] = [];
  const hosts = Array.from({ length: 254 }, (_, i) => `http://${m[1]}.${i + 1}:${port}`);
  let done = 0;
  const batch = 32;
  for (let i = 0; i < hosts.length; i += batch) {
    await Promise.all(hosts.slice(i, i + batch).map(async (h) => {
      try {
        const p = await remoteAuth.ping(h, 1200);
        if (p.app === 'performance-warehouse') found.push(h);
      } catch {
        // нет сервера по этому адресу
      } finally {
        done += 1;
      }
    }));
    onProgress?.(done);
  }
  return found;
}
