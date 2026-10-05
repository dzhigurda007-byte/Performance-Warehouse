import { useSQLiteContext } from 'expo-sqlite';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import * as auth from '../db/auth';
import type { User } from '../domain/types';

interface AuthState {
  user: User | null;
  ready: boolean;
  signIn: (login: string, password: string) => Promise<void>;
  signUp: (login: string, fullName: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    auth.restoreSession(db).then(setUser).finally(() => setReady(true));
  }, [db]);

  const signIn = useCallback(async (l: string, p: string) => setUser(await auth.login(db, l, p)), [db]);
  const signUp = useCallback(
    async (l: string, n: string, p: string) => setUser(await auth.register(db, l, n, p)),
    [db],
  );
  const signOut = useCallback(async () => {
    await auth.logout(db);
    setUser(null);
  }, [db]);

  const value = useMemo(() => ({ user, ready, signIn, signUp, signOut }), [user, ready, signIn, signUp, signOut]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('AuthProvider отсутствует');
  return v;
}

/** Текущий пользователь на экранах внутри приложения (после входа он всегда есть). */
export function useUser(): User {
  const { user } = useAuth();
  if (!user) throw new Error('Пользователь не авторизован');
  return user;
}
