import { BusinessError, inTransaction, type DB, type SqlParam } from '../../core/db';
import { LITE_SCHEMA_VERSION, ensureMainCell } from './schema';

/**
 * Резервная копия базы для переноса на другой телефон: один JSON-файл со всеми таблицами.
 * Восстановление полностью заменяет данные на телефоне содержимым копии.
 */
export const BACKUP_FORMAT = 'PerformanceWarehouseLite';

/** Порядок важен: сначала справочники, потом то, что на них ссылается. */
const TABLES = ['meta', 'item_groups', 'items', 'racks', 'cells', 'stock', 'orders', 'order_lines', 'moves'] as const;
type Table = (typeof TABLES)[number];

export interface Backup {
  format: typeof BACKUP_FORMAT;
  schema: number;
  created_at: string;
  tables: Record<Table, Record<string, SqlParam>[]>;
}

export async function exportBackup(db: DB): Promise<Backup> {
  const tables = {} as Backup['tables'];
  for (const t of TABLES) {
    tables[t] = (await db.getAllAsync<Record<string, SqlParam>>(`SELECT * FROM ${t}`)).map((r) => ({ ...r }));
  }
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return {
    format: BACKUP_FORMAT,
    schema: LITE_SCHEMA_VERSION,
    created_at: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`,
    tables,
  };
}

export function parseBackup(text: string): Backup {
  let data: Backup;
  try {
    data = JSON.parse(text);
  } catch {
    throw new BusinessError('Файл повреждён или это не резервная копия PerformanceWarehouseLite');
  }
  if (!data || data.format !== BACKUP_FORMAT || typeof data.tables !== 'object') {
    throw new BusinessError('Это не резервная копия PerformanceWarehouseLite');
  }
  if (Number(data.schema) > LITE_SCHEMA_VERSION) {
    throw new BusinessError('Копия сделана в более новой версии приложения — сначала обновите приложение');
  }
  for (const t of TABLES) {
    if (data.tables[t] !== undefined && !Array.isArray(data.tables[t])) throw new BusinessError(`Повреждена таблица ${t}`);
  }
  return data;
}

/** Заменить все данные на телефоне данными из копии (всё или ничего). */
export async function importBackup(db: DB, data: Backup): Promise<{ items: number; orders: number; moves: number }> {
  await inTransaction(db, async (tx) => {
    // папки ссылаются друг на друга — проверка ссылок в конце транзакции
    await tx.execAsync('PRAGMA defer_foreign_keys = ON');
    for (const t of [...TABLES].reverse()) await tx.runAsync(`DELETE FROM ${t}`);
    await tx.runAsync("DELETE FROM sqlite_sequence WHERE name IN ('item_groups', 'items', 'racks', 'cells', 'orders', 'order_lines', 'moves')").catch(() => undefined);
    for (const t of TABLES) {
      const cols = new Set((await tx.getAllAsync<{ name: string }>(`PRAGMA table_info(${t})`)).map((c) => c.name));
      for (const row of data.tables[t] ?? []) {
        const keys = Object.keys(row).filter((k) => cols.has(k));
        if (!keys.length) continue;
        await tx.runAsync(
          `INSERT INTO ${t}(${keys.join(', ')}) VALUES(${keys.map(() => '?').join(', ')})`,
          ...keys.map((k) => (row[k] === undefined ? null : row[k])),
        );
      }
    }
    await ensureMainCell(tx);
    await tx.runAsync("INSERT INTO meta(key, value) VALUES('schema', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", String(LITE_SCHEMA_VERSION));
  });
  return {
    items: data.tables.items?.length ?? 0,
    orders: data.tables.orders?.length ?? 0,
    moves: data.tables.moves?.length ?? 0,
  };
}
