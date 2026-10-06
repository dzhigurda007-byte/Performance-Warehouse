import { fold, inTransaction, type DB } from './db';

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
  // ---------------------------------------------------------------- v2
  // Роли и иерархия, приглашения, группы номенклатуры, партии (дата приёмки),
  // буферная ячейка, выдача ТМЦ под ответственность и возвраты.
  `
  CREATE TABLE departments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    parent_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
    head_id INTEGER REFERENCES users(id) ON DELETE SET NULL
  );

  ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'storekeeper';
  ALTER TABLE users ADD COLUMN department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL;
  ALTER TABLE users ADD COLUMN supervisor_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
  ALTER TABLE users ADD COLUMN position TEXT;
  ALTER TABLE users ADD COLUMN active INTEGER NOT NULL DEFAULT 1;
  UPDATE users SET role = 'admin' WHERE id = (SELECT MIN(id) FROM users);

  CREATE TABLE invites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL,
    department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
    supervisor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    expires_at TEXT,
    max_uses INTEGER NOT NULL DEFAULT 1,
    uses INTEGER NOT NULL DEFAULT 0,
    revoked INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    last_seen_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE item_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    parent_id INTEGER REFERENCES item_groups(id) ON DELETE CASCADE
  );

  ALTER TABLE items ADD COLUMN group_id INTEGER REFERENCES item_groups(id) ON DELETE SET NULL;
  ALTER TABLE items ADD COLUMN track_units INTEGER NOT NULL DEFAULT 0;

  ALTER TABLE cells ADD COLUMN is_buffer INTEGER NOT NULL DEFAULT 0;

  -- Партии: физический товар в ячейке хранится с датой приёмки.
  ALTER TABLE stock ADD COLUMN received_at TEXT;
  UPDATE stock SET received_at = substr(first_in_at, 1, 10);
  DROP INDEX ux_stock_place;
  CREATE UNIQUE INDEX ux_stock_lot ON stock(item_id, IFNULL(cell_id, 0), IFNULL(box_id, 0), received_at);

  ALTER TABLE documents ADD COLUMN post_mode TEXT;      -- issue: writeoff | custody
  ALTER TABLE documents ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'; -- manual | scan | excel | return
  ALTER TABLE documents ADD COLUMN base_doc_id INTEGER REFERENCES documents(id);
  ALTER TABLE documents ADD COLUMN warehouse_id INTEGER REFERENCES warehouses(id);

  ALTER TABLE doc_lines ADD COLUMN received_at TEXT;
  ALTER TABLE doc_lines ADD COLUMN to_box_id INTEGER REFERENCES boxes(id);
  ALTER TABLE doc_lines ADD COLUMN custody_id INTEGER;
  ALTER TABLE doc_lines ADD COLUMN condition TEXT;
  ALTER TABLE doc_lines ADD COLUMN note TEXT;
  ALTER TABLE doc_lines ADD COLUMN accept INTEGER NOT NULL DEFAULT 1;

  ALTER TABLE moves ADD COLUMN kind TEXT;
  ALTER TABLE moves ADD COLUMN received_at TEXT;
  ALTER TABLE moves ADD COLUMN holder_id INTEGER REFERENCES users(id);

  -- Распределение строк расходного ордера по получателям (выдача нескольким людям).
  CREATE TABLE issue_allocations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    item_id INTEGER NOT NULL REFERENCES items(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    qty REAL NOT NULL CHECK (qty > 0),
    UNIQUE (doc_id, item_id, user_id)
  );

  -- ТМЦ на руках (под ответственностью). У каждой записи свой QR-код.
  CREATE TABLE custody (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    item_id INTEGER NOT NULL REFERENCES items(id),
    qty REAL NOT NULL CHECK (qty > 0),
    holder_id INTEGER NOT NULL REFERENCES users(id),
    issued_by INTEGER NOT NULL REFERENCES users(id),
    issue_doc_id INTEGER NOT NULL REFERENCES documents(id),
    warehouse_id INTEGER REFERENCES warehouses(id),
    issued_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    status TEXT NOT NULL DEFAULT 'held', -- held | returned | closed | written_off | lost
    return_condition TEXT,
    return_comment TEXT,
    returned_by INTEGER REFERENCES users(id),
    returned_at TEXT,
    return_doc_id INTEGER REFERENCES documents(id)
  );
  CREATE INDEX idx_custody_holder ON custody(holder_id, status);
  CREATE INDEX idx_custody_issuer ON custody(issued_by, status);
  CREATE INDEX idx_custody_doc ON custody(issue_doc_id);
  `,
  // v3: поиск по названию без учёта регистра для кириллицы (заполняется из приложения)
  `ALTER TABLE items ADD COLUMN search_name TEXT;`,
];

export async function migrate(db: DB): Promise<void> {
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
  await syncItemSearch(db);
}

/** Заполнить поисковые поля товаров, у которых они пустые (после обновления базы). */
export async function syncItemSearch(db: DB, itemId?: number) {
  const rows = await db.getAllAsync<{ id: number; name: string; sku: string }>(
    itemId ? 'SELECT id, name, sku FROM items WHERE id = ?' : 'SELECT id, name, sku FROM items WHERE search_name IS NULL',
    ...(itemId ? [itemId] : []));
  for (const r of rows) await db.runAsync('UPDATE items SET search_name = ? WHERE id = ?', fold(`${r.name} ${r.sku}`), r.id);
}
