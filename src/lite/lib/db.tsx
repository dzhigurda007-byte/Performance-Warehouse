import * as SQLite from 'expo-sqlite';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import type { DB } from '../../core/db';
import { migrateLite } from '../core/schema';

/** Вся база PerformanceWarehouseLite — в одном файле SQLite на телефоне. */
async function openLiteDb(): Promise<DB> {
  const raw = await SQLite.openDatabaseAsync('lite.db');
  let db = raw as unknown as DB;
  if (Platform.OS === 'web') {
    // в браузере (проверка интерфейса) нет отдельного соединения для транзакции
    db = Object.assign(Object.create(raw), {
      withExclusiveTransactionAsync: (task: (txn: DB) => Promise<void>) => raw.withTransactionAsync(() => task(db)),
    }) as DB;
  }
  await migrateLite(db);
  return db;
}

const Ctx = createContext<DB | null>(null);

export function DbProvider({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const [db, setDb] = useState<DB | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    openLiteDb().then(setDb).catch((e) => setError(String(e instanceof Error ? e.message : e)));
  }, []);
  if (error) throw new Error(`База данных не открылась: ${error}`);
  return db ? <Ctx.Provider value={db}>{children}</Ctx.Provider> : <>{fallback}</>;
}

export function useDb(): DB {
  const db = useContext(Ctx);
  if (!db) throw new Error('База ещё не открыта');
  return db;
}
