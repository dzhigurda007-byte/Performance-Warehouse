import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import { bindApi, type ClientApi } from '../core/api';
import type { SessionUser } from '../core/ctx';
import type { DB } from '../core/db';
import { can, type Role } from '../core/roles';
import type { Settings } from '../core/services/users';
import { localAuth, openLocalDb } from './local';
import { normalizeServerUrl, remoteApi, remoteAuth, type AuthResult } from './remote';
import { kv } from './storage';

export type Mode = 'server' | 'local';

interface BackendState {
  ready: boolean;
  mode: Mode | null;
  serverUrl: string | null;
  user: SessionUser | null;
  settings: Settings;
  api: ClientApi;
  /** Подключиться к серверу склада (проверка связи) — без входа. */
  connectServer(url: string): Promise<{ needsSetup: boolean; orgName: string }>;
  chooseLocal(): Promise<void>;
  resetConnection(): Promise<void>;
  login(login: string, password: string): Promise<void>;
  /** Первый администратор (сервер) / регистрация (автономный режим). */
  register(login: string, fullName: string, password: string, setupCode?: string): Promise<void>;
  joinInvite(server: string, token: string, login: string, fullName: string, password: string): Promise<void>;
  logout(): Promise<void>;
  refreshSettings(): Promise<void>;
  token: string | null;
}

const Ctx = createContext<BackendState | null>(null);

const K = { mode: 'pw.mode', server: 'pw.server', token: 'pw.token', localUser: 'pw.localUser' };

function defaultWebServer(): string | null {
  if (Platform.OS !== 'web') return null;
  const env = process.env.EXPO_PUBLIC_SERVER_URL;
  if (env) return env.replace(/\/+$/, '');
  try {
    const q = new URLSearchParams(window.location.search).get('server');
    return q ? normalizeServerUrl(q) : window.location.origin;
  } catch {
    return null;
  }
}

export function BackendProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<Mode | null>(null);
  const [serverUrl, setServerUrl] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [settings, setSettings] = useState<Settings>({ custodyEnabled: false, orgName: '', orgInn: '', orgKpp: '', orgAddress: '', orgDirector: '', orgAccountant: '' });
  const localDb = useRef<DB | null>(null);
  const tokenRef = useRef<string | null>(null);
  const userRef = useRef<SessionUser | null>(null);
  tokenRef.current = token;
  userRef.current = user;

  const getLocalDb = useCallback(async () => {
    localDb.current ??= await openLocalDb();
    return localDb.current;
  }, []);

  const dropSession = useCallback(() => {
    setToken(null);
    setUser(null);
    kv.set(K.token, null);
    kv.set(K.localUser, null);
  }, []);

  const api = useMemo<ClientApi>(() => {
    if (mode === 'server' && serverUrl) return remoteApi(serverUrl, () => tokenRef.current, dropSession);
    return bindApi(() => {
      if (!localDb.current || !userRef.current) throw new Error('Нет входа в систему');
      return { db: localDb.current, user: userRef.current };
    });
  }, [mode, serverUrl, dropSession]);

  // Восстановление сохранённого подключения и входа.
  useEffect(() => {
    (async () => {
      try {
        let m = (await kv.get(K.mode)) as Mode | null;
        let srv = await kv.get(K.server);
        const web = defaultWebServer();
        if (web) {
          // Веб-версию раздаёт сам сервер склада, поэтому адрес сервера — адрес страницы.
          m = 'server';
          srv = web;
        }
        setMode(m);
        setServerUrl(srv);
        if (m === 'server' && srv) {
          const t = await kv.get(K.token);
          if (t) {
            try {
              const me = await remoteAuth.me(srv, t);
              setToken(t);
              setUser(me.user);
            } catch (e) {
              if ((e as { code?: string }).code === 'auth') await kv.set(K.token, null);
            }
          }
        } else if (m === 'local') {
          const db = await getLocalDb();
          const id = await kv.get(K.localUser);
          if (id) setUser(await localAuth.byId(db, Number(id)));
        }
      } finally {
        setReady(true);
      }
    })();
  }, [getLocalDb]);

  const refreshSettings = useCallback(async () => {
    if (!userRef.current) return;
    try {
      setSettings(await api.settings());
    } catch {
      // настройки не критичны для входа
    }
  }, [api]);

  useEffect(() => {
    if (user) refreshSettings();
  }, [user, refreshSettings]);

  const applyAuth = useCallback(async (srv: string, r: AuthResult) => {
    await kv.set(K.mode, 'server');
    await kv.set(K.server, srv);
    await kv.set(K.token, r.token);
    setMode('server');
    setServerUrl(srv);
    setToken(r.token);
    setUser(r.user);
  }, []);

  const value = useMemo<BackendState>(() => ({
    ready, mode, serverUrl, user, settings, api, token,

    async connectServer(url) {
      const srv = normalizeServerUrl(url);
      const p = await remoteAuth.ping(srv, 5000);
      if (p.app !== 'performance-warehouse') throw new Error('По этому адресу не сервер склада');
      await kv.set(K.mode, 'server');
      await kv.set(K.server, srv);
      setMode('server');
      setServerUrl(srv);
      return { needsSetup: p.needsSetup, orgName: p.orgName };
    },

    async chooseLocal() {
      await getLocalDb();
      await kv.set(K.mode, 'local');
      setMode('local');
    },

    async resetConnection() {
      if (mode === 'server' && serverUrl && token) await remoteAuth.logout(serverUrl, token);
      dropSession();
      await kv.set(K.mode, null);
      await kv.set(K.server, null);
      setMode(null);
      setServerUrl(null);
    },

    async login(login, password) {
      if (mode === 'server' && serverUrl) await applyAuth(serverUrl, await remoteAuth.login(serverUrl, login, password));
      else {
        const u = await localAuth.login(await getLocalDb(), login, password);
        await kv.set(K.localUser, String(u.id));
        setUser(u);
      }
    },

    async register(login, fullName, password, setupCode) {
      if (mode === 'server' && serverUrl) await applyAuth(serverUrl, await remoteAuth.setup(serverUrl, { login, fullName, password, setupCode }));
      else {
        const u = await localAuth.register(await getLocalDb(), login, fullName, password);
        await kv.set(K.localUser, String(u.id));
        setUser(u);
      }
    },

    async joinInvite(server, inviteToken, login, fullName, password) {
      const srv = normalizeServerUrl(server);
      await applyAuth(srv, await remoteAuth.join(srv, { token: inviteToken, login, fullName, password }));
    },

    async logout() {
      if (mode === 'server' && serverUrl && token) await remoteAuth.logout(serverUrl, token);
      dropSession();
    },

    refreshSettings,
  }), [ready, mode, serverUrl, user, settings, api, token, getLocalDb, applyAuth, dropSession, refreshSettings]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useBackend() {
  const v = useContext(Ctx);
  if (!v) throw new Error('BackendProvider отсутствует');
  return v;
}

export function useApi(): ClientApi {
  return useBackend().api;
}

/** Текущий пользователь (экраны внутри приложения доступны только после входа). */
export function useUser(): SessionUser {
  const { user } = useBackend();
  if (!user) throw new Error('Пользователь не авторизован');
  return user;
}

/** Удобные флаги прав для интерфейса. */
export function usePerms() {
  const { user, settings, mode } = useBackend();
  const role: Role = user?.role ?? 'worker';
  return {
    role,
    operate: can.operate(role),
    viewStock: can.viewStock(role),
    stockTab: can.stockTab(role),
    manageItems: can.manageItems(role),
    takeForSelf: can.takeForSelf(role),
    invite: can.invite(role) && mode === 'server',
    administer: can.administer(role),
    develop: can.develop(role),
    manageUsers: can.manageUsers(role),
    viewTeam: can.viewTeam(role),
    custody: settings.custodyEnabled,
  };
}
