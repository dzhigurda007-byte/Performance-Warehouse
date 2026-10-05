import type { SQLiteDatabase } from 'expo-sqlite';

/**
 * Эксклюзивная транзакция на отдельном соединении: параллельные запросы
 * экранов не попадут внутрь. Веб-версия — в tx.web.ts.
 */
export function inTransaction(db: SQLiteDatabase, task: (txn: SQLiteDatabase) => Promise<void>): Promise<void> {
  return db.withExclusiveTransactionAsync(task);
}
