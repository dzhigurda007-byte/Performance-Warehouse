import { formatBoxCode, formatDocNumber } from '../codes';
import { need, type Ctx } from '../ctx';
import { BusinessError, emptyToNull, inTransaction, nextSeq, type DB } from '../db';
import { can } from '../roles';
import type { Box, Cell, CellAddress, Rack, Warehouse } from '../types';
import { ADDRESS_SQL } from './stock';

export const BUFFER_RACK = 'БУФ';
export const BUFFER_CELL = 'ПРИЁМКА';

const CELL_ADDR_SELECT = `
  SELECT c.*, r.code AS rack_code, w.id AS warehouse_id, w.code AS warehouse_code,
    w.name AS warehouse_name, ${ADDRESS_SQL} AS address
  FROM cells c JOIN racks r ON r.id = c.rack_id JOIN warehouses w ON w.id = r.warehouse_id`;

/**
 * Буферная ячейка склада: сюда падает приход, оформленный с ПК / из Excel
 * и возвраты ТМЦ, а затем товар раскладывается по ячейкам перемещением.
 */
export async function ensureBufferCell(db: DB, warehouseId: number): Promise<number> {
  const existing = await db.getFirstAsync<{ id: number }>(`
    SELECT c.id FROM cells c JOIN racks r ON r.id = c.rack_id
    WHERE r.warehouse_id = ? AND c.is_buffer = 1 ORDER BY c.id LIMIT 1`, warehouseId);
  if (existing) return existing.id;
  let rack = await db.getFirstAsync<{ id: number }>('SELECT id FROM racks WHERE warehouse_id = ? AND code = ?',
    warehouseId, BUFFER_RACK);
  if (!rack) {
    const r = await db.runAsync('INSERT INTO racks(warehouse_id, code, name) VALUES(?, ?, ?)',
      warehouseId, BUFFER_RACK, 'Буферная зона');
    rack = { id: r.lastInsertRowId };
  }
  const c = await db.runAsync('INSERT INTO cells(rack_id, code, is_buffer) VALUES(?, ?, 1)', rack.id, BUFFER_CELL);
  return c.lastInsertRowId;
}

async function assertEmpty(db: DB, where: string, id: number, what: string) {
  const row = await db.getFirstAsync<{ n: number }>(`
    SELECT COUNT(*) AS n FROM stock s
    LEFT JOIN boxes b ON b.id = s.box_id
    JOIN cells c ON c.id = COALESCE(s.cell_id, b.cell_id)
    JOIN racks r ON r.id = c.rack_id
    WHERE s.qty > 0 AND ${where} = ?`, id);
  if (row && row.n > 0) throw new BusinessError(`${what}: есть товар, сначала освободите место хранения`);
  const boxes = await db.getFirstAsync<{ n: number }>(`
    SELECT COUNT(*) AS n FROM boxes b JOIN cells c ON c.id = b.cell_id JOIN racks r ON r.id = c.rack_id
    WHERE ${where} = ?`, id);
  if (boxes && boxes.n > 0) throw new BusinessError(`${what}: есть короба, переместите их`);
  const used = await db.getFirstAsync<{ n: number }>(`
    SELECT COUNT(*) AS n FROM cells c JOIN racks r ON r.id = c.rack_id
    WHERE ${where} = ? AND (EXISTS (SELECT 1 FROM moves m WHERE m.cell_id = c.id)
      OR EXISTS (SELECT 1 FROM doc_lines l WHERE l.cell_id = c.id OR l.to_cell_id = c.id))`, id);
  if (used && used.n > 0) {
    throw new BusinessError(`${what}: по адресам есть история документов — удаление нарушит журнал движений`);
  }
}

export const structure = {
  listWarehouses: (ctx: Ctx) =>
    ctx.db.getAllAsync<Warehouse & { racks: number; cells: number }>(`
      SELECT w.*,
        (SELECT COUNT(*) FROM racks r WHERE r.warehouse_id = w.id) AS racks,
        (SELECT COUNT(*) FROM cells c JOIN racks r ON r.id = c.rack_id WHERE r.warehouse_id = w.id) AS cells
      FROM warehouses w ORDER BY w.code`),

  getWarehouse: (ctx: Ctx, id: number) => ctx.db.getFirstAsync<Warehouse>('SELECT * FROM warehouses WHERE id = ?', id),

  async saveWarehouse(ctx: Ctx, w: { id?: number; code: string; name: string; address?: string }) {
    need(ctx, can.operate);
    if (!w.code.trim() || !w.name.trim()) throw new BusinessError('Укажите код и наименование склада');
    try {
      if (w.id) {
        await ctx.db.runAsync('UPDATE warehouses SET code = ?, name = ?, address = ? WHERE id = ?',
          w.code.trim(), w.name.trim(), emptyToNull(w.address), w.id);
        return w.id;
      }
      let id = 0;
      await inTransaction(ctx.db, async (t) => {
        const r = await t.runAsync('INSERT INTO warehouses(code, name, address) VALUES(?, ?, ?)',
          w.code.trim(), w.name.trim(), emptyToNull(w.address));
        id = r.lastInsertRowId;
        await ensureBufferCell(t, id);
      });
      return id;
    } catch (e) {
      if (String(e).includes('UNIQUE')) throw new BusinessError('Склад с таким кодом уже есть');
      throw e;
    }
  },

  async deleteWarehouse(ctx: Ctx, id: number) {
    need(ctx, can.administer);
    await assertEmpty(ctx.db, 'r.warehouse_id', id, 'Склад');
    await ctx.db.runAsync('DELETE FROM warehouses WHERE id = ?', id);
  },

  listRacks: (ctx: Ctx, warehouseId: number) =>
    ctx.db.getAllAsync<Rack & { cells: number; is_buffer: number }>(`
      SELECT r.*, (SELECT COUNT(*) FROM cells c WHERE c.rack_id = r.id) AS cells,
        EXISTS (SELECT 1 FROM cells c WHERE c.rack_id = r.id AND c.is_buffer = 1) AS is_buffer
      FROM racks r WHERE r.warehouse_id = ? ORDER BY is_buffer DESC, r.code`, warehouseId),

  getRack: (ctx: Ctx, id: number) =>
    ctx.db.getFirstAsync<Rack & { warehouse_code: string; warehouse_name: string }>(`
      SELECT r.*, w.code AS warehouse_code, w.name AS warehouse_name
      FROM racks r JOIN warehouses w ON w.id = r.warehouse_id WHERE r.id = ?`, id),

  async addRack(ctx: Ctx, warehouseId: number, code: string, name?: string) {
    need(ctx, can.operate);
    if (!code.trim()) throw new BusinessError('Укажите код стеллажа');
    try {
      const r = await ctx.db.runAsync('INSERT INTO racks(warehouse_id, code, name) VALUES(?, ?, ?)',
        warehouseId, code.trim(), emptyToNull(name));
      return r.lastInsertRowId;
    } catch (e) {
      if (String(e).includes('UNIQUE')) throw new BusinessError('Стеллаж с таким кодом уже есть');
      throw e;
    }
  },

  async deleteRack(ctx: Ctx, id: number) {
    need(ctx, can.operate);
    await assertEmpty(ctx.db, 'r.id', id, 'Стеллаж');
    await ctx.db.runAsync('DELETE FROM racks WHERE id = ?', id);
  },

  /** Ячейки сеткой «ярус × место»: 1-01, 1-02 … */
  async addCells(ctx: Ctx, rackId: number, levels: number, positions: number) {
    need(ctx, can.operate);
    if (!(levels >= 1 && positions >= 1) || levels * positions > 2000) throw new BusinessError('Некорректное количество ячеек');
    let created = 0;
    await inTransaction(ctx.db, async (t) => {
      for (let l = 1; l <= levels; l++) {
        for (let p = 1; p <= positions; p++) {
          const r = await t.runAsync('INSERT OR IGNORE INTO cells(rack_id, code) VALUES(?, ?)',
            rackId, `${l}-${String(p).padStart(2, '0')}`);
          created += r.changes;
        }
      }
    });
    return created;
  },

  async addCell(ctx: Ctx, rackId: number, code: string) {
    need(ctx, can.operate);
    if (!code.trim()) throw new BusinessError('Укажите код ячейки');
    try {
      const r = await ctx.db.runAsync('INSERT INTO cells(rack_id, code) VALUES(?, ?)', rackId, code.trim());
      return r.lastInsertRowId;
    } catch (e) {
      if (String(e).includes('UNIQUE')) throw new BusinessError('Ячейка с таким кодом уже есть');
      throw e;
    }
  },

  async deleteCell(ctx: Ctx, id: number) {
    need(ctx, can.operate);
    const c = await ctx.db.getFirstAsync<{ is_buffer: number }>('SELECT is_buffer FROM cells WHERE id = ?', id);
    if (c?.is_buffer) throw new BusinessError('Буферную ячейку удалить нельзя');
    await assertEmpty(ctx.db, 'c.id', id, 'Ячейка');
    await ctx.db.runAsync('DELETE FROM cells WHERE id = ?', id);
  },

  listCells: (ctx: Ctx, rackId: number) =>
    ctx.db.getAllAsync<Cell & { positions: number; boxes: number }>(`
      SELECT c.*,
        (SELECT COUNT(DISTINCT s.item_id) FROM stock s WHERE s.cell_id = c.id AND s.qty > 0) AS positions,
        (SELECT COUNT(*) FROM boxes b WHERE b.cell_id = c.id) AS boxes
      FROM cells c WHERE c.rack_id = ? ORDER BY c.code`, rackId),

  getCell: (ctx: Ctx, id: number) => ctx.db.getFirstAsync<CellAddress>(`${CELL_ADDR_SELECT} WHERE c.id = ?`, id),

  /**
   * Найти ячейку по набранному вручную коду: «1-01», «A-1-01», «A 1-01» или полный адрес «СК1/A/1-01».
   * Регистр и пробелы не важны; если код подходит к нескольким ячейкам — не угадываем (null).
   */
  async findCellByText(ctx: Ctx, text: string): Promise<CellAddress | null> {
    const norm = (v: string) => v.toLocaleUpperCase('ru-RU').replace(/\s+/g, '').replace(/[\\/|.]+/g, '/');
    const t = norm(text);
    if (!t) return null;
    const all = await ctx.db.getAllAsync<CellAddress>(CELL_ADDR_SELECT);
    const by = (f: (c: CellAddress) => string[]) => all.filter((c) => f(c).some((v) => norm(v) === t));
    for (const match of [
      by((c) => [c.address ?? '', `${c.warehouse_code}/${c.rack_code}-${c.code}`]),
      by((c) => [`${c.rack_code}-${c.code}`, `${c.rack_code}/${c.code}`, `${c.rack_code}${c.code}`]),
      by((c) => [c.code]),
    ]) {
      if (match.length === 1) return match[0];
      if (match.length > 1) return null;
    }
    return null;
  },

  listCellsOfWarehouse: (ctx: Ctx, warehouseId: number) =>
    ctx.db.getAllAsync<CellAddress>(`${CELL_ADDR_SELECT} WHERE w.id = ? ORDER BY c.is_buffer DESC, r.code, c.code`,
      warehouseId),

  async bufferCell(ctx: Ctx, warehouseId: number) {
    const id = await ensureBufferCell(ctx.db, warehouseId);
    return ctx.db.getFirstAsync<CellAddress>(`${CELL_ADDR_SELECT} WHERE c.id = ?`, id);
  },

  // ---------------------------------------------------------------- короба

  getBox: (ctx: Ctx, id: number) =>
    ctx.db.getFirstAsync<Box & { address: string | null }>(`
      SELECT b.*, ${ADDRESS_SQL} AS address FROM boxes b
      LEFT JOIN cells c ON c.id = b.cell_id LEFT JOIN racks r ON r.id = c.rack_id
      LEFT JOIN warehouses w ON w.id = r.warehouse_id WHERE b.id = ?`, id),

  findBoxByCode: (ctx: Ctx, code: string) =>
    ctx.db.getFirstAsync<Box>('SELECT * FROM boxes WHERE code = ?', code.trim()),

  listBoxesInCell: (ctx: Ctx, cellId: number) =>
    ctx.db.getAllAsync<Box & { positions: number; total: number }>(`
      SELECT b.*,
        (SELECT COUNT(DISTINCT s.item_id) FROM stock s WHERE s.box_id = b.id AND s.qty > 0) AS positions,
        (SELECT IFNULL(SUM(s.qty), 0) FROM stock s WHERE s.box_id = b.id) AS total
      FROM boxes b WHERE b.cell_id = ? ORDER BY b.code`, cellId),

  async createBox(ctx: Ctx, cellId: number, name?: string) {
    need(ctx, can.operate);
    const code = formatBoxCode(await nextSeq(ctx.db, 'seq_box'));
    const r = await ctx.db.runAsync('INSERT INTO boxes(code, name, cell_id) VALUES(?, ?, ?)', code, emptyToNull(name), cellId);
    return { id: r.lastInsertRowId, code };
  },

  /**
   * Генератор коробов: создать сразу count коробов со сквозной нумерацией BX-000001…
   * Без ячейки — «свободные» короба: этикетки печатаются и клеятся заранее, в ячейку короб
   * ставится потом (перемещение короба). Возвращает созданные коды по порядку.
   */
  async createBoxes(ctx: Ctx, opts: { count: number; name?: string | null; cellId?: number | null }) {
    need(ctx, can.operate);
    const count = Math.floor(Number(opts.count));
    if (!(count >= 1 && count <= 1000)) throw new BusinessError('Количество коробов — от 1 до 1000 за раз');
    if (opts.cellId && !(await ctx.db.getFirstAsync('SELECT id FROM cells WHERE id = ?', opts.cellId))) {
      throw new BusinessError('Ячейка не найдена');
    }
    const out: { id: number; code: string }[] = [];
    await inTransaction(ctx.db, async (t) => {
      for (let i = 0; i < count; i++) {
        const code = formatBoxCode(await nextSeq(t, 'seq_box'));
        const r = await t.runAsync('INSERT INTO boxes(code, name, cell_id) VALUES(?, ?, ?)', code, emptyToNull(opts.name ?? ''), opts.cellId ?? null);
        out.push({ id: r.lastInsertRowId, code });
      }
    });
    return out;
  },

  /** Короба для повторной печати: свободные (без ячейки) или все, свежие сверху. */
  listBoxes(ctx: Ctx, f: { unplaced?: boolean; search?: string } = {}) {
    need(ctx, can.operate);
    const q = (f.search ?? '').trim();
    return ctx.db.getAllAsync<Box & { address: string | null; positions: number }>(`
      SELECT b.*, ${ADDRESS_SQL} AS address,
        (SELECT COUNT(DISTINCT s.item_id) FROM stock s WHERE s.box_id = b.id AND s.qty > 0) AS positions
      FROM boxes b
      LEFT JOIN cells c ON c.id = b.cell_id LEFT JOIN racks r ON r.id = c.rack_id LEFT JOIN warehouses w ON w.id = r.warehouse_id
      WHERE (? = 0 OR b.cell_id IS NULL) AND (? = '' OR b.code LIKE ? OR IFNULL(b.name, '') LIKE ?)
      ORDER BY b.id DESC LIMIT 1000`, f.unplaced ? 1 : 0, q, `%${q}%`, `%${q}%`);
  },

  async renameBox(ctx: Ctx, id: number, name: string) {
    need(ctx, can.operate);
    await ctx.db.runAsync('UPDATE boxes SET name = ? WHERE id = ?', emptyToNull(name), id);
  },

  async deleteBox(ctx: Ctx, id: number) {
    need(ctx, can.operate);
    const row = await ctx.db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM stock WHERE box_id = ? AND qty > 0', id);
    if (row && row.n > 0) throw new BusinessError('Короб не пуст');
    const used = await ctx.db.getFirstAsync<{ n: number }>(
      'SELECT (SELECT COUNT(*) FROM moves WHERE box_id = ?) + (SELECT COUNT(*) FROM doc_lines WHERE box_id = ? OR to_box_id = ?) AS n',
      id, id, id);
    if (used && used.n > 0) throw new BusinessError('Короб уже участвовал в документах — его можно только оставить пустым');
    await ctx.db.runAsync('DELETE FROM stock WHERE box_id = ?', id);
    await ctx.db.runAsync('DELETE FROM boxes WHERE id = ?', id);
  },

  /** Перемещение короба целиком: документ «ПМ» проводится сразу, партии едут вместе с коробом. */
  async moveBox(ctx: Ctx, boxId: number, toCellId: number) {
    need(ctx, can.operate);
    const db = ctx.db;
    const box = await structure.getBox(ctx, boxId);
    if (!box) throw new BusinessError('Короб не найден');
    if (box.cell_id === toCellId) throw new BusinessError('Короб уже в этой ячейке');
    const n = await nextSeq(db, 'seq_move');
    let docId = 0;
    await inTransaction(db, async (t) => {
      const r = await t.runAsync(`
        INSERT INTO documents(type, mode, number, status, created_by, posted_by, posted_at, comment)
        VALUES('move', 'fact', ?, 'posted', ?, ?, datetime('now','localtime'), ?)`,
        formatDocNumber('move', n), ctx.user.id, ctx.user.id, `Перемещение короба ${box.code}`);
      docId = r.lastInsertRowId;
      const content = await t.getAllAsync<{ item_id: number; qty: number; received_at: string }>(
        'SELECT item_id, qty, received_at FROM stock WHERE box_id = ? AND qty > 0', boxId);
      for (const s of content) {
        await t.runAsync(`INSERT INTO doc_lines(doc_id, item_id, qty, cell_id, box_id, to_cell_id, received_at)
          VALUES(?, ?, ?, NULL, ?, ?, ?)`, docId, s.item_id, s.qty, boxId, toCellId, s.received_at);
        await t.runAsync(`INSERT INTO moves(doc_id, item_id, box_id, cell_id, qty, user_id, kind, received_at)
          VALUES(?, ?, ?, ?, ?, ?, 'move', ?)`, docId, s.item_id, boxId, box.cell_id, -s.qty, ctx.user.id, s.received_at);
        await t.runAsync(`INSERT INTO moves(doc_id, item_id, box_id, cell_id, qty, user_id, kind, received_at)
          VALUES(?, ?, ?, ?, ?, ?, 'move', ?)`, docId, s.item_id, boxId, toCellId, s.qty, ctx.user.id, s.received_at);
      }
      await t.runAsync('UPDATE boxes SET cell_id = ? WHERE id = ?', toCellId, boxId);
    });
    return docId;
  },
};
