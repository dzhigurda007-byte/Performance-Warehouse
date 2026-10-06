/**
 * Минимальный асинхронный интерфейс БД, общий для трёх сред:
 *  - expo-sqlite на телефоне (автономный режим);
 *  - node:sqlite на локальном сервере;
 *  - node:sqlite в тестах.
 * Бизнес-логика (src/core) зависит только от него.
 */
export type SqlParam = string | number | null;

export interface DB {
  execAsync(sql: string): Promise<void>;
  getFirstAsync<T>(sql: string, ...params: SqlParam[]): Promise<T | null>;
  getAllAsync<T>(sql: string, ...params: SqlParam[]): Promise<T[]>;
  runAsync(sql: string, ...params: SqlParam[]): Promise<{ lastInsertRowId: number; changes: number }>;
  /** Эксклюзивная транзакция: всё или ничего. */
  withExclusiveTransactionAsync(task: (txn: DB) => Promise<void>): Promise<void>;
}

export class BusinessError extends Error {
  constructor(message: string, readonly code = 'business') {
    super(message);
    this.name = 'BusinessError';
  }
}

const inTx = new WeakSet<object>();

/** Транзакция; вложенный вызов внутри уже открытой транзакции выполняется в ней же. */
export async function inTransaction(db: DB, task: (txn: DB) => Promise<void>): Promise<void> {
  if (inTx.has(db)) return task(db);
  return db.withExclusiveTransactionAsync(async (txn) => {
    inTx.add(txn);
    try {
      await task(txn);
    } finally {
      inTx.delete(txn);
    }
  });
}

export function emptyToNull(s: string | null | undefined): string | null {
  const t = (s ?? '').trim();
  return t.length ? t : null;
}

export const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Текущая дата в формате YYYY-MM-DD (локальное время). */
export function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export async function nextSeq(db: DB, key: string): Promise<number> {
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM meta WHERE key = ?', key);
  const n = (row ? Number(row.value) : 0) + 1;
  await setMeta(db, key, String(n));
  return n;
}

export async function getMeta(db: DB, key: string): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string | null }>('SELECT value FROM meta WHERE key = ?', key);
  return row?.value ?? null;
}

export async function setMeta(db: DB, key: string, value: string | null): Promise<void> {
  await db.runAsync(
    'INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key,
    value,
  );
}

/**
 * Строка для поиска без учёта регистра. SQLite LIKE не различает регистр только
 * у латиницы, поэтому для кириллицы храним и ищем «сложенный» текст: строчные, ё → е.
 */
export function fold(s: string | null | undefined): string {
  return (s ?? '').toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
}

/** Значение для LIKE: %текст% в сложенном виде. */
export const likeFold = (s: string | null | undefined) => `%${fold((s ?? '').trim())}%`;
