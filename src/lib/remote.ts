import type { ClientApi } from '../core/api';
import type { SessionUser } from '../core/ctx';
import { BusinessError } from '../core/db';
import type { Role } from '../core/roles';

export interface Ping {
  app: string;
  version: string;
  orgName: string;
  needsSetup: boolean;
}

export interface InviteInfo {
  role: Role;
  department: string | null;
  supervisor: string | null;
  createdBy: string;
  orgName: string;
}

export interface AuthResult {
  token: string;
  user: SessionUser;
}

export function normalizeServerUrl(input: string): string {
  let s = input.trim().replace(/\/+$/, '');
  if (!s) return s;
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  if (!/:\d+$/.test(s.replace(/^https?:\/\//i, '').split('/')[0])) s = `${s}:8080`;
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
    throw new BusinessError('Нет связи с сервером склада. Проверьте Wi-Fi и что ПК-сервер включён.', 'network');
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
  setup: (server: string, p: { login: string; fullName: string; password: string }) =>
    request<AuthResult>(`${server}/api/auth/setup`, p),
  login: (server: string, login: string, password: string) =>
    request<AuthResult>(`${server}/api/auth/login`, { login, password }),
  invite: (server: string, token: string) => request<InviteInfo>(`${server}/api/auth/invite`, { token }),
  join: (server: string, p: { token: string; login: string; fullName: string; password: string }) =>
    request<AuthResult>(`${server}/api/auth/join`, p),
  me: (server: string, token: string) => request<{ user: SessionUser }>(`${server}/api/auth/me`, {}, token),
  logout: (server: string, token: string) => request(`${server}/api/auth/logout`, {}, token).catch(() => undefined),
  info: (server: string, token: string) =>
    request<{ version: string; urls: string[]; dataDir: string }>(`${server}/api/server/info`, {}, token),
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
