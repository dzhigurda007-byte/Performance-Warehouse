import { DatabaseSync } from 'node:sqlite';
import type { DB, SqlParam } from '../../src/core/db';

/** Адаптер node:sqlite под асинхронный интерфейс DB (тот же, что использует сервер). */
export class NodeDb implements DB {
  constructor(readonly raw: DatabaseSync) {}

  async execAsync(sql: string) {
    this.raw.exec(sql);
  }

  async getFirstAsync<T>(sql: string, ...params: SqlParam[]): Promise<T | null> {
    return (this.raw.prepare(sql).get(...params) as T | undefined) ?? null;
  }

  async getAllAsync<T>(sql: string, ...params: SqlParam[]): Promise<T[]> {
    return this.raw.prepare(sql).all(...params) as T[];
  }

  async runAsync(sql: string, ...params: SqlParam[]) {
    const r = this.raw.prepare(sql).run(...params);
    return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) };
  }

  async withExclusiveTransactionAsync(task: (txn: DB) => Promise<void>) {
    if (this.raw.isTransaction) return task(this);
    this.raw.exec('BEGIN IMMEDIATE');
    try {
      await task(this);
      this.raw.exec('COMMIT');
    } catch (e) {
      this.raw.exec('ROLLBACK');
      throw e;
    }
  }
}

export function openTestDb(): DB {
  return new NodeDb(new DatabaseSync(':memory:'));
}
