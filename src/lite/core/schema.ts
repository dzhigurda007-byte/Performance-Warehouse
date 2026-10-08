import type { DB } from '../../core/db';

/**
 * База PerformanceWarehouseLite — хранится только в телефоне.
 * Отдельная от полной версии: один пользователь (администратор), без регистрации.
 */
export const LITE_SCHEMA_VERSION = 1;

/** Ячейка «Основная» есть всегда — товар без адресного хранения лежит в ней. */
export const MAIN_CELL_CODE = 'ОСН';

const V1 = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article TEXT NOT NULL,
  name TEXT NOT NULL,
  spp TEXT,
  barcode TEXT,
  unit TEXT NOT NULL DEFAULT 'шт',
  comment TEXT,
  search TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS items_article ON items(article);
CREATE INDEX IF NOT EXISTS items_barcode ON items(barcode);
CREATE INDEX IF NOT EXISTS items_spp ON items(spp);

CREATE TABLE IF NOT EXISTS cells (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT,
  comment TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS stock (
  item_id INTEGER NOT NULL REFERENCES items(id),
  cell_id INTEGER NOT NULL REFERENCES cells(id),
  qty REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (item_id, cell_id)
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('receipt', 'issue')),
  number TEXT NOT NULL,
  doc_date TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  partner TEXT,
  comment TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posted')),
  posted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS order_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items(id),
  cell_id INTEGER NOT NULL REFERENCES cells(id),
  qty REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS order_lines_order ON order_lines(order_id);

-- история движений: приход (+), расход (−), перемещение между ячейками
CREATE TABLE IF NOT EXISTS moves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  kind TEXT NOT NULL CHECK (kind IN ('receipt', 'issue', 'move')),
  order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  item_id INTEGER NOT NULL REFERENCES items(id),
  cell_id INTEGER NOT NULL REFERENCES cells(id),
  to_cell_id INTEGER REFERENCES cells(id),
  qty REAL NOT NULL,
  comment TEXT
);
CREATE INDEX IF NOT EXISTS moves_at ON moves(at);
CREATE INDEX IF NOT EXISTS moves_item ON moves(item_id);
`;

export async function migrateLite(db: DB): Promise<void> {
  await db.execAsync('PRAGMA foreign_keys = ON;');
  await db.execAsync(V1);
  const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM meta WHERE key = 'schema'");
  if (!row) {
    await db.runAsync("INSERT INTO meta(key, value) VALUES('schema', ?)", String(LITE_SCHEMA_VERSION));
  }
  await ensureMainCell(db);
}

export async function ensureMainCell(db: DB): Promise<number> {
  const c = await db.getFirstAsync<{ id: number }>('SELECT id FROM cells WHERE code = ?', MAIN_CELL_CODE);
  if (c) return c.id;
  const r = await db.runAsync('INSERT INTO cells(code, name) VALUES(?, ?)', MAIN_CELL_CODE, 'Основная');
  return r.lastInsertRowId;
}
