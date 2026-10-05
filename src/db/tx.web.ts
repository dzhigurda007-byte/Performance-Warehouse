import type { SQLiteDatabase } from 'expo-sqlite';

/** В веб-сборке expo-sqlite не поддерживает exclusive-транзакции. */
export function inTransaction(db: SQLiteDatabase, task: (txn: SQLiteDatabase) => Promise<void>): Promise<void> {
  return db.withTransactionAsync(() => task(db));
}
