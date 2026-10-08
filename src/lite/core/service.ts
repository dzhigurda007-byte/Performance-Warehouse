import { BusinessError, emptyToNull, fold, inTransaction, likeFold, round3, type DB, type SqlParam } from '../../core/db';
import { MAIN_CELL_CODE, ensureMainCell } from './schema';

/**
 * Логика PerformanceWarehouseLite: номенклатура, ячейки, остатки, приходные и расходные ордера,
 * история движений. Чистые функции над DB — те же на телефоне (expo-sqlite) и в тестах (node:sqlite).
 */

export type OrderType = 'receipt' | 'issue';
export type MoveKind = 'receipt' | 'issue' | 'move';

export interface Item {
  id: number;
  article: string;
  name: string;
  spp: string | null;
  barcode: string | null;
  unit: string;
  comment: string | null;
  created_at: string;
}

export interface ItemRow extends Item {
  qty: number;
  last_receipt: string | null;
}

export interface Cell {
  id: number;
  code: string;
  name: string | null;
  comment: string | null;
}

export interface CellRow extends Cell {
  positions: number;
  qty: number;
}

export interface Order {
  id: number;
  type: OrderType;
  number: string;
  doc_date: string;
  partner: string | null;
  comment: string | null;
  status: 'draft' | 'posted';
  posted_at: string | null;
}

export interface OrderRow extends Order {
  lines: number;
  total: number;
}

export interface OrderLine {
  id: number;
  order_id: number;
  item_id: number;
  cell_id: number;
  qty: number;
  article: string;
  name: string;
  spp: string | null;
  barcode: string | null;
  unit: string;
  cell_code: string;
  cell_name: string | null;
  /** Остаток товара в этой ячейке (для расхода — сколько можно списать). */
  available: number;
}

export interface Move {
  id: number;
  at: string;
  kind: MoveKind;
  order_id: number | null;
  order_number: string | null;
  item_id: number;
  article: string;
  name: string;
  spp: string | null;
  unit: string;
  cell_id: number;
  cell_code: string;
  to_cell_id: number | null;
  to_cell_code: string | null;
  qty: number;
  comment: string | null;
}

export interface StockPlace {
  cell_id: number;
  code: string;
  name: string | null;
  qty: number;
}

export const ORDER_TITLE: Record<OrderType, string> = { receipt: 'Приходный ордер', issue: 'Расходный ордер' };
export const MOVE_TITLE: Record<MoveKind, string> = { receipt: 'Приход', issue: 'Расход', move: 'Перемещение' };
const PREFIX: Record<OrderType, string> = { receipt: 'П', issue: 'Р' };

/** Внутренний QR ячейки: по префиксу сканер отличает ячейку от товара. */
export const CELL_QR_PREFIX = 'PWL:C:';
export const cellQr = (code: string) => `${CELL_QR_PREFIX}${code}`;

const searchText = (i: { article: string; name: string; spp?: string | null; barcode?: string | null }) =>
  fold([i.article, i.name, i.spp, i.barcode].filter(Boolean).join(' '));

function checkQty(qty: number): number {
  if (!Number.isFinite(qty) || qty <= 0) throw new BusinessError('Количество должно быть больше нуля');
  return round3(qty);
}

async function getMeta(db: DB, key: string) {
  return (await db.getFirstAsync<{ value: string | null }>('SELECT value FROM meta WHERE key = ?', key))?.value ?? null;
}

async function setMeta(db: DB, key: string, value: string | null) {
  await db.runAsync('INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
}

/* ─────────────── настройки склада ─────────────── */

export interface WarehouseInfo {
  name: string;
  address: string;
  person: string;
}

export const warehouse = {
  async get(db: DB): Promise<WarehouseInfo> {
    return {
      name: (await getMeta(db, 'wh.name')) ?? 'Мой склад',
      address: (await getMeta(db, 'wh.address')) ?? '',
      person: (await getMeta(db, 'wh.person')) ?? '',
    };
  },
  async save(db: DB, info: WarehouseInfo) {
    await setMeta(db, 'wh.name', info.name.trim() || 'Мой склад');
    await setMeta(db, 'wh.address', info.address.trim());
    await setMeta(db, 'wh.person', info.person.trim());
  },
};

/* ─────────────── номенклатура ─────────────── */

export type StockFilter = 'all' | 'in' | 'out';
export type ItemSort = 'name' | 'article' | 'qty' | 'date';

export const items = {
  async list(db: DB, opts: { search?: string; filter?: StockFilter; sort?: ItemSort } = {}): Promise<ItemRow[]> {
    const where = ['i.deleted_at IS NULL'];
    const params: SqlParam[] = [];
    if (opts.search?.trim()) {
      where.push('i.search LIKE ?');
      params.push(likeFold(opts.search));
    }
    const having = opts.filter === 'in' ? 'HAVING qty > 0' : opts.filter === 'out' ? 'HAVING qty <= 0' : '';
    const order = opts.sort === 'article' ? 'i.article COLLATE NOCASE'
      : opts.sort === 'qty' ? 'qty DESC, i.name COLLATE NOCASE'
        : opts.sort === 'date' ? 'last_receipt IS NULL, last_receipt DESC, i.name COLLATE NOCASE'
          : 'i.name COLLATE NOCASE';
    return db.getAllAsync<ItemRow>(
      `SELECT i.*, COALESCE((SELECT SUM(qty) FROM stock s WHERE s.item_id = i.id), 0) AS qty,
              (SELECT MAX(at) FROM moves m WHERE m.item_id = i.id AND m.kind = 'receipt') AS last_receipt
         FROM items i WHERE ${where.join(' AND ')} ${having ? `GROUP BY i.id ${having}` : ''}
        ORDER BY ${order}`,
      ...params,
    );
  },

  async get(db: DB, id: number): Promise<ItemRow | null> {
    return db.getFirstAsync<ItemRow>(
      `SELECT i.*, COALESCE((SELECT SUM(qty) FROM stock s WHERE s.item_id = i.id), 0) AS qty,
              (SELECT MAX(at) FROM moves m WHERE m.item_id = i.id AND m.kind = 'receipt') AS last_receipt
         FROM items i WHERE i.id = ?`, id);
  },

  async places(db: DB, itemId: number): Promise<StockPlace[]> {
    return db.getAllAsync<StockPlace>(
      `SELECT c.id AS cell_id, c.code, c.name, s.qty FROM stock s JOIN cells c ON c.id = s.cell_id
        WHERE s.item_id = ? AND s.qty > 0 ORDER BY c.code COLLATE NOCASE`, itemId);
  },

  /** Создать или изменить товар. Артикул и наименование обязательны, артикул / ШК / SPP — без повторов. */
  async save(db: DB, data: { id?: number; article: string; name: string; spp?: string | null; barcode?: string | null;
    unit?: string | null; comment?: string | null }): Promise<number> {
    const rec = {
      article: (data.article ?? '').trim(),
      name: (data.name ?? '').trim(),
      spp: emptyToNull(data.spp),
      barcode: emptyToNull(data.barcode),
      unit: emptyToNull(data.unit) ?? 'шт',
      comment: emptyToNull(data.comment),
    };
    if (!rec.article) throw new BusinessError('Укажите артикул');
    if (!rec.name) throw new BusinessError('Укажите наименование');
    const dup = async (field: 'article' | 'barcode' | 'spp', label: string) => {
      const v = rec[field];
      if (!v) return;
      const other = await db.getFirstAsync<{ name: string }>(
        `SELECT name FROM items WHERE ${field} = ? AND deleted_at IS NULL AND id <> ?`, v, data.id ?? 0);
      if (other) throw new BusinessError(`${label} «${v}» уже есть у товара «${other.name}»`);
    };
    await dup('article', 'Артикул');
    await dup('barcode', 'Штрихкод');
    await dup('spp', 'SPP номер');
    const search = searchText(rec);
    if (data.id) {
      await db.runAsync(
        'UPDATE items SET article = ?, name = ?, spp = ?, barcode = ?, unit = ?, comment = ?, search = ? WHERE id = ?',
        rec.article, rec.name, rec.spp, rec.barcode, rec.unit, rec.comment, search, data.id);
      return data.id;
    }
    const r = await db.runAsync(
      'INSERT INTO items(article, name, spp, barcode, unit, comment, search) VALUES(?, ?, ?, ?, ?, ?, ?)',
      rec.article, rec.name, rec.spp, rec.barcode, rec.unit, rec.comment, search);
    return r.lastInsertRowId;
  },

  /** Удалить из номенклатуры можно только товар без остатка (история движений сохраняется). */
  async remove(db: DB, id: number) {
    const it = await items.get(db, id);
    if (!it) return;
    if (it.qty > 0) throw new BusinessError(`На складе ещё ${it.qty} ${it.unit} — сначала спишите остаток расходным ордером`);
    const draft = await db.getFirstAsync<{ number: string }>(
      `SELECT o.number FROM order_lines l JOIN orders o ON o.id = l.order_id WHERE l.item_id = ? AND o.status = 'draft'`, id);
    if (draft) throw new BusinessError(`Товар есть в непроведённом ордере ${draft.number}`);
    await db.runAsync("UPDATE items SET deleted_at = datetime('now', 'localtime') WHERE id = ?", id);
  },

  /** Поиск товара по отсканированному коду: штрихкод, затем SPP, затем артикул. */
  async findByCode(db: DB, code: string): Promise<Item | null> {
    const c = code.trim();
    if (!c) return null;
    for (const field of ['barcode', 'spp', 'article'] as const) {
      const it = await db.getFirstAsync<Item>(`SELECT * FROM items WHERE ${field} = ? AND deleted_at IS NULL`, c);
      if (it) return it;
    }
    return db.getFirstAsync<Item>(
      'SELECT * FROM items WHERE deleted_at IS NULL AND (lower(barcode) = lower(?) OR lower(article) = lower(?) OR lower(spp) = lower(?))',
      c, c, c);
  },
};

/* ─────────────── ячейки ─────────────── */

export const cells = {
  async list(db: DB, search = ''): Promise<CellRow[]> {
    const params: SqlParam[] = [];
    let where = '';
    if (search.trim()) {
      where = 'WHERE c.code LIKE ? OR c.name LIKE ?';
      params.push(`%${search.trim()}%`, `%${search.trim()}%`);
    }
    return db.getAllAsync<CellRow>(
      `SELECT c.*, (SELECT COUNT(*) FROM stock s WHERE s.cell_id = c.id AND s.qty > 0) AS positions,
              COALESCE((SELECT SUM(qty) FROM stock s WHERE s.cell_id = c.id), 0) AS qty
         FROM cells c ${where} ORDER BY c.code = '${MAIN_CELL_CODE}' DESC, c.code COLLATE NOCASE`, ...params);
  },

  async get(db: DB, id: number): Promise<Cell | null> {
    return db.getFirstAsync<Cell>('SELECT * FROM cells WHERE id = ?', id);
  },

  main: ensureMainCell,

  async contents(db: DB, cellId: number) {
    return db.getAllAsync<{ item_id: number; article: string; name: string; spp: string | null; unit: string; qty: number }>(
      `SELECT i.id AS item_id, i.article, i.name, i.spp, i.unit, s.qty FROM stock s JOIN items i ON i.id = s.item_id
        WHERE s.cell_id = ? AND s.qty > 0 ORDER BY i.name COLLATE NOCASE`, cellId);
  },

  async save(db: DB, data: { id?: number; code: string; name?: string | null; comment?: string | null }): Promise<number> {
    const code = (data.code ?? '').trim().toUpperCase();
    if (!code) throw new BusinessError('Укажите код ячейки, например A-01-01');
    const other = await db.getFirstAsync<{ id: number }>('SELECT id FROM cells WHERE code = ? AND id <> ?', code, data.id ?? 0);
    if (other) throw new BusinessError(`Ячейка ${code} уже есть`);
    if (data.id) {
      const cur = await cells.get(db, data.id);
      if (cur?.code === MAIN_CELL_CODE && code !== MAIN_CELL_CODE) throw new BusinessError('Код основной ячейки менять нельзя');
      await db.runAsync('UPDATE cells SET code = ?, name = ?, comment = ? WHERE id = ?', code, emptyToNull(data.name), emptyToNull(data.comment), data.id);
      return data.id;
    }
    const r = await db.runAsync('INSERT INTO cells(code, name, comment) VALUES(?, ?, ?)', code, emptyToNull(data.name), emptyToNull(data.comment));
    return r.lastInsertRowId;
  },

  /** Создать ряд ячеек: префикс + номера с ведущими нулями (A-01 … A-20). */
  async createRange(db: DB, prefix: string, from: number, to: number): Promise<number> {
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from) throw new BusinessError('Неверный диапазон номеров');
    if (to - from >= 500) throw new BusinessError('За один раз — не больше 500 ячеек');
    const width = Math.max(2, String(to).length);
    let made = 0;
    await inTransaction(db, async (tx) => {
      for (let n = from; n <= to; n++) {
        const code = `${prefix.trim().toUpperCase()}${String(n).padStart(width, '0')}`;
        const r = await tx.runAsync('INSERT OR IGNORE INTO cells(code) VALUES(?)', code);
        made += r.changes;
      }
    });
    return made;
  },

  async remove(db: DB, id: number) {
    const c = await cells.get(db, id);
    if (!c) return;
    if (c.code === MAIN_CELL_CODE) throw new BusinessError('Основную ячейку удалить нельзя');
    const busy = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM stock WHERE cell_id = ? AND qty > 0', id);
    if (busy?.n) throw new BusinessError('В ячейке есть товар — сначала переместите или спишите его');
    const used = await db.getFirstAsync<{ n: number }>(
      'SELECT (SELECT COUNT(*) FROM moves WHERE cell_id = ? OR to_cell_id = ?) + (SELECT COUNT(*) FROM order_lines WHERE cell_id = ?) AS n', id, id, id);
    if (used?.n) throw new BusinessError('Ячейка есть в истории движений или в ордерах — её можно только переименовать');
    await db.runAsync('DELETE FROM stock WHERE cell_id = ?', id);
    await db.runAsync('DELETE FROM cells WHERE id = ?', id);
  },

  /** Ячейка по скану: свой QR (PWL:C:код) или просто код ячейки. */
  async findByCode(db: DB, raw: string): Promise<Cell | null> {
    const t = raw.trim();
    const code = (t.startsWith(CELL_QR_PREFIX) ? t.slice(CELL_QR_PREFIX.length) : t).toUpperCase();
    if (!code) return null;
    return db.getFirstAsync<Cell>('SELECT * FROM cells WHERE code = ?', code);
  },
};

/* ─────────────── остатки ─────────────── */

async function addStock(db: DB, itemId: number, cellId: number, delta: number) {
  await db.runAsync(
    `INSERT INTO stock(item_id, cell_id, qty) VALUES(?, ?, ?)
     ON CONFLICT(item_id, cell_id) DO UPDATE SET qty = round(qty + excluded.qty, 3)`, itemId, cellId, round3(delta));
  await db.runAsync('DELETE FROM stock WHERE item_id = ? AND cell_id = ? AND qty = 0', itemId, cellId);
}

async function stockAt(db: DB, itemId: number, cellId: number): Promise<number> {
  return (await db.getFirstAsync<{ qty: number }>('SELECT qty FROM stock WHERE item_id = ? AND cell_id = ?', itemId, cellId))?.qty ?? 0;
}

/** Перемещение товара между ячейками (без ордера) — попадает в историю. */
export async function moveStock(db: DB, p: { itemId: number; fromCellId: number; toCellId: number; qty: number; comment?: string | null }) {
  const qty = checkQty(p.qty);
  if (p.fromCellId === p.toCellId) throw new BusinessError('Ячейки «откуда» и «куда» совпадают');
  await inTransaction(db, async (tx) => {
    const have = await stockAt(tx, p.itemId, p.fromCellId);
    if (have < qty) throw new BusinessError(`В ячейке только ${have} — переместить ${qty} нельзя`);
    await addStock(tx, p.itemId, p.fromCellId, -qty);
    await addStock(tx, p.itemId, p.toCellId, qty);
    await tx.runAsync('INSERT INTO moves(kind, item_id, cell_id, to_cell_id, qty, comment) VALUES(?, ?, ?, ?, ?, ?)',
      'move', p.itemId, p.fromCellId, p.toCellId, qty, emptyToNull(p.comment));
  });
}

/* ─────────────── ордера ─────────────── */

const LINE_SELECT = `
  SELECT l.id, l.order_id, l.item_id, l.cell_id, l.qty, i.article, i.name, i.spp, i.barcode, i.unit,
         c.code AS cell_code, c.name AS cell_name,
         COALESCE((SELECT qty FROM stock s WHERE s.item_id = l.item_id AND s.cell_id = l.cell_id), 0) AS available
    FROM order_lines l JOIN items i ON i.id = l.item_id JOIN cells c ON c.id = l.cell_id`;

async function draftOrder(db: DB, id: number): Promise<Order> {
  const o = await orders.get(db, id);
  if (!o) throw new BusinessError('Ордер не найден');
  if (o.status !== 'draft') throw new BusinessError(`Ордер ${o.number} проведён — изменять его нельзя. Отмените проведение.`);
  return o;
}

export const orders = {
  async list(db: DB, opts: { type?: OrderType; status?: 'draft' | 'posted'; search?: string } = {}): Promise<OrderRow[]> {
    const where: string[] = [];
    const params: SqlParam[] = [];
    if (opts.type) { where.push('o.type = ?'); params.push(opts.type); }
    if (opts.status) { where.push('o.status = ?'); params.push(opts.status); }
    if (opts.search?.trim()) {
      where.push('(o.number LIKE ? OR o.partner LIKE ? OR o.comment LIKE ?)');
      const q = `%${opts.search.trim()}%`;
      params.push(q, q, q);
    }
    return db.getAllAsync<OrderRow>(
      `SELECT o.*, (SELECT COUNT(*) FROM order_lines l WHERE l.order_id = o.id) AS lines,
              COALESCE((SELECT SUM(qty) FROM order_lines l WHERE l.order_id = o.id), 0) AS total
         FROM orders o ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY o.doc_date DESC, o.id DESC`, ...params);
  },

  async get(db: DB, id: number): Promise<Order | null> {
    return db.getFirstAsync<Order>('SELECT * FROM orders WHERE id = ?', id);
  },

  async lines(db: DB, id: number): Promise<OrderLine[]> {
    return db.getAllAsync<OrderLine>(`${LINE_SELECT} WHERE l.order_id = ? ORDER BY l.id`, id);
  },

  async create(db: DB, type: OrderType): Promise<number> {
    let id = 0;
    await inTransaction(db, async (tx) => {
      const key = `seq.${type}`;
      const n = Number((await getMeta(tx, key)) ?? 0) + 1;
      await setMeta(tx, key, String(n));
      const r = await tx.runAsync('INSERT INTO orders(type, number) VALUES(?, ?)', type, `${PREFIX[type]}-${String(n).padStart(6, '0')}`);
      id = r.lastInsertRowId;
    });
    return id;
  },

  async updateHeader(db: DB, id: number, h: { partner?: string | null; comment?: string | null; doc_date?: string }) {
    await draftOrder(db, id);
    await db.runAsync('UPDATE orders SET partner = ?, comment = ?, doc_date = COALESCE(?, doc_date) WHERE id = ?',
      emptyToNull(h.partner), emptyToNull(h.comment), h.doc_date ?? null, id);
  },

  /**
   * Добавить товар в ордер (повторный скан того же товара в ту же ячейку увеличивает количество).
   * Для расхода без указанной ячейки берётся ячейка, где этого товара больше всего.
   */
  async addLine(db: DB, id: number, p: { itemId: number; qty: number; cellId?: number | null }): Promise<OrderLine> {
    const o = await draftOrder(db, id);
    const qty = checkQty(p.qty);
    let cellId = p.cellId ?? null;
    if (!cellId && o.type === 'issue') {
      cellId = (await db.getFirstAsync<{ cell_id: number }>(
        'SELECT cell_id FROM stock WHERE item_id = ? AND qty > 0 ORDER BY qty DESC LIMIT 1', p.itemId))?.cell_id ?? null;
    }
    cellId ??= await ensureMainCell(db);
    const same = await db.getFirstAsync<{ id: number }>(
      'SELECT id FROM order_lines WHERE order_id = ? AND item_id = ? AND cell_id = ?', id, p.itemId, cellId);
    let lineId: number;
    if (same) {
      await db.runAsync('UPDATE order_lines SET qty = round(qty + ?, 3) WHERE id = ?', qty, same.id);
      lineId = same.id;
    } else {
      lineId = (await db.runAsync('INSERT INTO order_lines(order_id, item_id, cell_id, qty) VALUES(?, ?, ?, ?)', id, p.itemId, cellId, qty)).lastInsertRowId;
    }
    return (await db.getFirstAsync<OrderLine>(`${LINE_SELECT} WHERE l.id = ?`, lineId))!;
  },

  async setLineQty(db: DB, lineId: number, qty: number) {
    const l = await db.getFirstAsync<{ order_id: number }>('SELECT order_id FROM order_lines WHERE id = ?', lineId);
    if (!l) return;
    await draftOrder(db, l.order_id);
    if (qty <= 0) await db.runAsync('DELETE FROM order_lines WHERE id = ?', lineId);
    else await db.runAsync('UPDATE order_lines SET qty = ? WHERE id = ?', checkQty(qty), lineId);
  },

  async setLineCell(db: DB, lineId: number, cellId: number) {
    const l = await db.getFirstAsync<{ order_id: number; item_id: number }>('SELECT order_id, item_id FROM order_lines WHERE id = ?', lineId);
    if (!l) return;
    await draftOrder(db, l.order_id);
    await db.runAsync('UPDATE order_lines SET cell_id = ? WHERE id = ?', cellId, lineId);
  },

  async removeLine(db: DB, lineId: number) {
    await orders.setLineQty(db, lineId, 0);
  },

  async remove(db: DB, id: number) {
    await draftOrder(db, id);
    await db.runAsync('DELETE FROM order_lines WHERE order_id = ?', id);
    await db.runAsync('DELETE FROM orders WHERE id = ?', id);
  },

  /** Провести: приход — товар в ячейки, расход — списание (остатка должно хватать). */
  async post(db: DB, id: number) {
    const o = await draftOrder(db, id);
    await inTransaction(db, async (tx) => {
      const lines = await orders.lines(tx, id);
      if (!lines.length) throw new BusinessError('В ордере нет товаров');
      if (o.type === 'issue') {
        // одна позиция может быть в нескольких строках — проверяем суммарно по ячейке
        const need = new Map<string, { l: OrderLine; qty: number }>();
        for (const l of lines) {
          const k = `${l.item_id}:${l.cell_id}`;
          const cur = need.get(k);
          need.set(k, { l, qty: round3((cur?.qty ?? 0) + l.qty) });
        }
        for (const { l, qty } of need.values()) {
          if (l.available < qty) {
            throw new BusinessError(`Не хватает «${l.name}» в ячейке ${l.cell_code}: есть ${l.available}, нужно ${qty}`);
          }
        }
      }
      const sign = o.type === 'receipt' ? 1 : -1;
      for (const l of lines) {
        await addStock(tx, l.item_id, l.cell_id, sign * l.qty);
        await tx.runAsync('INSERT INTO moves(kind, order_id, item_id, cell_id, qty) VALUES(?, ?, ?, ?, ?)', o.type, id, l.item_id, l.cell_id, l.qty);
      }
      await tx.runAsync("UPDATE orders SET status = 'posted', posted_at = datetime('now', 'localtime') WHERE id = ?", id);
    });
  },

  /** Отменить проведение: движения ордера убираются, остатки возвращаются как были. */
  async unpost(db: DB, id: number) {
    const o = await orders.get(db, id);
    if (!o || o.status !== 'posted') throw new BusinessError('Ордер не проведён');
    await inTransaction(db, async (tx) => {
      const lines = await orders.lines(tx, id);
      if (o.type === 'receipt') {
        for (const l of lines) {
          const have = await stockAt(tx, l.item_id, l.cell_id);
          if (have < l.qty) {
            throw new BusinessError(`«${l.name}» из ячейки ${l.cell_code} уже списан или перемещён (осталось ${have}) — отменить приход нельзя`);
          }
        }
      }
      const sign = o.type === 'receipt' ? -1 : 1;
      for (const l of lines) await addStock(tx, l.item_id, l.cell_id, sign * l.qty);
      await tx.runAsync('DELETE FROM moves WHERE order_id = ?', id);
      await tx.runAsync("UPDATE orders SET status = 'draft', posted_at = NULL WHERE id = ?", id);
    });
  },
};

/* ─────────────── история движений ─────────────── */

export interface MoveFilter {
  itemId?: number | null;
  cellId?: number | null;
  kind?: MoveKind | null;
  /** YYYY-MM-DD включительно. */
  from?: string | null;
  to?: string | null;
  minQty?: number | null;
  maxQty?: number | null;
  limit?: number;
}

export async function history(db: DB, f: MoveFilter = {}): Promise<Move[]> {
  const where: string[] = [];
  const params: SqlParam[] = [];
  if (f.itemId) { where.push('m.item_id = ?'); params.push(f.itemId); }
  if (f.cellId) { where.push('(m.cell_id = ? OR m.to_cell_id = ?)'); params.push(f.cellId, f.cellId); }
  if (f.kind) { where.push('m.kind = ?'); params.push(f.kind); }
  if (f.from) { where.push('m.at >= ?'); params.push(f.from); }
  if (f.to) { where.push('m.at < date(?, \'+1 day\')'); params.push(f.to); }
  if (f.minQty != null) { where.push('m.qty >= ?'); params.push(f.minQty); }
  if (f.maxQty != null) { where.push('m.qty <= ?'); params.push(f.maxQty); }
  return db.getAllAsync<Move>(
    `SELECT m.*, o.number AS order_number, i.article, i.name, i.spp, i.unit, c.code AS cell_code, t.code AS to_cell_code
       FROM moves m JOIN items i ON i.id = m.item_id JOIN cells c ON c.id = m.cell_id
       LEFT JOIN cells t ON t.id = m.to_cell_id LEFT JOIN orders o ON o.id = m.order_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY m.at DESC, m.id DESC LIMIT ?`,
    ...params, f.limit ?? 1000,
  );
}

/* ─────────────── сводка ─────────────── */

export async function summary(db: DB) {
  return (await db.getFirstAsync<{ items: number; in_stock: number; total: number; drafts: number }>(
    `SELECT (SELECT COUNT(*) FROM items WHERE deleted_at IS NULL) AS items,
            (SELECT COUNT(DISTINCT item_id) FROM stock WHERE qty > 0) AS in_stock,
            COALESCE((SELECT SUM(qty) FROM stock), 0) AS total,
            (SELECT COUNT(*) FROM orders WHERE status = 'draft') AS drafts`))!;
}
