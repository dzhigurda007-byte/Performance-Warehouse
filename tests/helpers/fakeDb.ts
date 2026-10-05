import { DatabaseSync } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';

type Param = string | number | null;

/**
 * Минимальный адаптер node:sqlite под асинхронный API expo-sqlite,
 * чтобы прогонять реальные SQL-запросы репозитория в тестах.
 */
class FakeDb {
  constructor(private readonly db: DatabaseSync) {}

  async execAsync(sql: string) {
    this.db.exec(sql);
  }

  async getFirstAsync<T>(sql: string, ...params: Param[]): Promise<T | null> {
    return (this.db.prepare(sql).get(...params) as T | undefined) ?? null;
  }

  async getAllAsync<T>(sql: string, ...params: Param[]): Promise<T[]> {
    return this.db.prepare(sql).all(...params) as T[];
  }

  async runAsync(sql: string, ...params: Param[]) {
    const r = this.db.prepare(sql).run(...params);
    return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) };
  }

  async withExclusiveTransactionAsync(task: (txn: FakeDb) => Promise<void>) {
    this.db.exec('BEGIN EXCLUSIVE');
    try {
      await task(this);
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
}

export function openTestDb(): SQLiteDatabase {
  return new FakeDb(new DatabaseSync(':memory:')) as unknown as SQLiteDatabase;
}
