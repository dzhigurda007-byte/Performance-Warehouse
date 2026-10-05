import type { SQLiteDatabase } from 'expo-sqlite';
import { inTransaction } from './tx';

/**
 * Схема БД построена по аналогии с 1С / WMS:
 *  - справочники: users, warehouses, racks, cells, boxes, items;
 *  - регистр остатков: stock (текущие остатки по адресам хранения);
 *  - документы: documents + doc_lines (приходный / расходный ордер, перемещение);
 *  - регистр движений: moves (каждое проведение документа = набор движений,
 *    из него строится история «кто, когда и какие ТМЦ взял»).
 *
 * Адрес хранения ТМЦ — это либо ячейка (товар лежит «россыпью»),
 * либо короб (короб, в свою очередь, лежит в ячейке).
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    login TEXT NOT NULL UNIQUE COLLATE NOCASE,
    full_name TEXT NOT NULL,
    pass_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE meta (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE warehouses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    address TEXT
  );

  CREATE TABLE racks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    warehouse_id INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    name TEXT,
    UNIQUE (warehouse_id, code)
  );

  CREATE TABLE cells (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rack_id INTEGER NOT NULL REFERENCES racks(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    UNIQUE (rack_id, code)
  );

  CREATE TABLE boxes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT,
    cell_id INTEGER REFERENCES cells(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sku TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    unit TEXT NOT NULL DEFAULT 'шт',
    barcode TEXT,
    description TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX idx_items_barcode ON items(barcode);

  -- Регистр остатков. Ровно одно из полей cell_id / box_id заполнено:
  -- товар лежит либо в ячейке россыпью, либо в коробе.
  CREATE TABLE stock (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL REFERENCES items(id),
    cell_id INTEGER REFERENCES cells(id),
    box_id INTEGER REFERENCES boxes(id),
    qty REAL NOT NULL,
    first_in_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    CHECK ((cell_id IS NULL) <> (box_id IS NULL))
  );
  CREATE UNIQUE INDEX ux_stock_place ON stock(item_id, IFNULL(cell_id, 0), IFNULL(box_id, 0));

  CREATE TABLE documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL CHECK (type IN ('receipt','issue','move')),
    mode TEXT NOT NULL DEFAULT 'plan' CHECK (mode IN ('plan','fact')),
    number TEXT NOT NULL,
    doc_date TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted')),
    partner TEXT,
    recipient TEXT,
    comment TEXT,
    created_by INTEGER NOT NULL REFERENCES users(id),
    posted_by INTEGER REFERENCES users(id),
    posted_at TEXT
  );

  CREATE TABLE doc_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    item_id INTEGER NOT NULL REFERENCES items(id),
    qty REAL NOT NULL CHECK (qty > 0),
    cell_id INTEGER REFERENCES cells(id),
    box_id INTEGER REFERENCES boxes(id),
    to_cell_id INTEGER REFERENCES cells(id)
  );
  CREATE INDEX idx_doc_lines_doc ON doc_lines(doc_id);

  -- Регистр движений (журнал). qty > 0 — приход в адрес, qty < 0 — расход из адреса.
  -- cell_id всегда содержит ячейку на момент движения (для короба — ячейку короба).
  CREATE TABLE moves (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_id INTEGER REFERENCES documents(id),
    item_id INTEGER NOT NULL REFERENCES items(id),
    box_id INTEGER REFERENCES boxes(id),
    cell_id INTEGER REFERENCES cells(id),
    qty REAL NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id),
    recipient TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX idx_moves_item ON moves(item_id);
  CREATE INDEX idx_moves_user ON moves(user_id);
  CREATE INDEX idx_moves_doc ON moves(doc_id);
  `,
];

export async function migrate(db: SQLiteDatabase): Promise<void> {
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let version = row?.user_version ?? 0;
  while (version < MIGRATIONS.length) {
    await inTransaction(db, async (txn) => {
      await txn.execAsync(MIGRATIONS[version]);
    });
    version += 1;
    await db.execAsync(`PRAGMA user_version = ${version}`);
  }
}
