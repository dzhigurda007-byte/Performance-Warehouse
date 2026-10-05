import type { SQLiteDatabase } from 'expo-sqlite';
import { inTransaction } from './tx';
import { allocate, placeKey, type AllocSource } from '../domain/allocation';
import { formatBoxCode, formatDocNumber, type ScanTarget } from '../domain/codes';
import type {
  Box,
  Cell,
  CellAddress,
  DocLine,
  DocMode,
  DocType,
  DocumentRow,
  Item,
  MoveRow,
  Place,
  Rack,
  StockRow,
  Warehouse,
} from '../domain/types';

type DB = SQLiteDatabase;

export class BusinessError extends Error {}

// ---------------------------------------------------------------- helpers

const ADDRESS_SQL = `w.code || ' / ' || r.code || ' / ' || c.code`;

async function nextSeq(db: DB, key: string): Promise<number> {
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM meta WHERE key = ?', key);
  const n = (row ? Number(row.value) : 0) + 1;
  await db.runAsync(
    'INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key,
    String(n),
  );
  return n;
}

export async function getMeta(db: DB, key: string): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string | null }>('SELECT value FROM meta WHERE key = ?', key);
  return row?.value ?? null;
}

export async function setMeta(db: DB, key: string, value: string | null): Promise<void> {
  await db.runAsync(
    'INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key,
    value,
  );
}

function emptyToNull(s: string | null | undefined): string | null {
  const t = (s ?? '').trim();
  return t.length ? t : null;
}

// ---------------------------------------------------------------- warehouses / racks / cells

export function listWarehouses(db: DB) {
  return db.getAllAsync<Warehouse & { racks: number; cells: number }>(`
    SELECT w.*,
      (SELECT COUNT(*) FROM racks r WHERE r.warehouse_id = w.id) AS racks,
      (SELECT COUNT(*) FROM cells c JOIN racks r ON r.id = c.rack_id WHERE r.warehouse_id = w.id) AS cells
    FROM warehouses w ORDER BY w.code`);
}

export function getWarehouse(db: DB, id: number) {
  return db.getFirstAsync<Warehouse>('SELECT * FROM warehouses WHERE id = ?', id);
}

export async function saveWarehouse(db: DB, w: { id?: number; code: string; name: string; address?: string }) {
  if (!w.code.trim() || !w.name.trim()) throw new BusinessError('Укажите код и наименование склада');
  if (w.id) {
    await db.runAsync('UPDATE warehouses SET code = ?, name = ?, address = ? WHERE id = ?',
      w.code.trim(), w.name.trim(), emptyToNull(w.address), w.id);
    return w.id;
  }
  const r = await db.runAsync('INSERT INTO warehouses(code, name, address) VALUES(?, ?, ?)',
    w.code.trim(), w.name.trim(), emptyToNull(w.address));
  return r.lastInsertRowId;
}

export function listRacks(db: DB, warehouseId: number) {
  return db.getAllAsync<Rack & { cells: number }>(`
    SELECT r.*, (SELECT COUNT(*) FROM cells c WHERE c.rack_id = r.id) AS cells
    FROM racks r WHERE r.warehouse_id = ? ORDER BY r.code`, warehouseId);
}

export function getRack(db: DB, id: number) {
  return db.getFirstAsync<Rack & { warehouse_code: string; warehouse_name: string }>(`
    SELECT r.*, w.code AS warehouse_code, w.name AS warehouse_name
    FROM racks r JOIN warehouses w ON w.id = r.warehouse_id WHERE r.id = ?`, id);
}

export async function addRack(db: DB, warehouseId: number, code: string, name?: string) {
  if (!code.trim()) throw new BusinessError('Укажите код стеллажа');
  const r = await db.runAsync('INSERT INTO racks(warehouse_id, code, name) VALUES(?, ?, ?)',
    warehouseId, code.trim(), emptyToNull(name));
  return r.lastInsertRowId;
}

/**
 * Массовое создание ячеек: уровни × позиции, код ячейки «<уровень>-<позиция>»,
 * например 1-01, 1-02 … 4-10 (как адресация в WMS: стеллаж-ярус-место).
 */
export async function addCells(db: DB, rackId: number, levels: number, positions: number) {
  if (levels < 1 || positions < 1 || levels * positions > 2000) {
    throw new BusinessError('Некорректное количество ячеек');
  }
  let created = 0;
  await inTransaction(db, async (txn) => {
    for (let l = 1; l <= levels; l++) {
      for (let p = 1; p <= positions; p++) {
        const code = `${l}-${String(p).padStart(2, '0')}`;
        const r = await txn.runAsync('INSERT OR IGNORE INTO cells(rack_id, code) VALUES(?, ?)', rackId, code);
        created += r.changes;
      }
    }
  });
  return created;
}

export async function addCell(db: DB, rackId: number, code: string) {
  if (!code.trim()) throw new BusinessError('Укажите код ячейки');
  const r = await db.runAsync('INSERT INTO cells(rack_id, code) VALUES(?, ?)', rackId, code.trim());
  return r.lastInsertRowId;
}

export function listCells(db: DB, rackId: number) {
  return db.getAllAsync<Cell & { positions: number; boxes: number }>(`
    SELECT c.*,
      (SELECT COUNT(*) FROM stock s WHERE s.cell_id = c.id AND s.qty > 0) AS positions,
      (SELECT COUNT(*) FROM boxes b WHERE b.cell_id = c.id) AS boxes
    FROM cells c WHERE c.rack_id = ? ORDER BY c.code`, rackId);
}

export function getCell(db: DB, id: number) {
  return db.getFirstAsync<CellAddress>(`
    SELECT c.*, r.code AS rack_code, w.id AS warehouse_id, w.code AS warehouse_code,
      w.name AS warehouse_name, ${ADDRESS_SQL} AS address
    FROM cells c JOIN racks r ON r.id = c.rack_id JOIN warehouses w ON w.id = r.warehouse_id
    WHERE c.id = ?`, id);
}

export function listCellsOfWarehouse(db: DB, warehouseId: number) {
  return db.getAllAsync<CellAddress>(`
    SELECT c.*, r.code AS rack_code, w.id AS warehouse_id, w.code AS warehouse_code,
      w.name AS warehouse_name, ${ADDRESS_SQL} AS address
    FROM cells c JOIN racks r ON r.id = c.rack_id JOIN warehouses w ON w.id = r.warehouse_id
    WHERE w.id = ? ORDER BY r.code, c.code`, warehouseId);
}

async function assertEmpty(db: DB, where: string, id: number, what: string) {
  const row = await db.getFirstAsync<{ n: number }>(`
    SELECT COUNT(*) AS n FROM stock s
    LEFT JOIN boxes b ON b.id = s.box_id
    JOIN cells c ON c.id = COALESCE(s.cell_id, b.cell_id)
    JOIN racks r ON r.id = c.rack_id
    WHERE s.qty > 0 AND ${where} = ?`, id);
  if (row && row.n > 0) throw new BusinessError(`${what} не пуст(а): сначала освободите место хранения`);
  const boxes = await db.getFirstAsync<{ n: number }>(`
    SELECT COUNT(*) AS n FROM boxes b JOIN cells c ON c.id = b.cell_id JOIN racks r ON r.id = c.rack_id
    WHERE ${where} = ?`, id);
  if (boxes && boxes.n > 0) throw new BusinessError(`${what}: в нём есть короба, переместите их`);
  const used = await db.getFirstAsync<{ n: number }>(`
    SELECT COUNT(*) AS n FROM cells c JOIN racks r ON r.id = c.rack_id
    WHERE ${where} = ? AND (EXISTS (SELECT 1 FROM moves m WHERE m.cell_id = c.id)
      OR EXISTS (SELECT 1 FROM doc_lines l WHERE l.cell_id = c.id OR l.to_cell_id = c.id))`, id);
  if (used && used.n > 0) {
    throw new BusinessError(`${what}: по адресам есть история документов — удаление нарушит журнал движений`);
  }
}

export async function deleteCell(db: DB, id: number) {
  await assertEmpty(db, 'c.id', id, 'Ячейка');
  await db.runAsync('DELETE FROM cells WHERE id = ?', id);
}

export async function deleteRack(db: DB, id: number) {
  await assertEmpty(db, 'r.id', id, 'Стеллаж');
  await db.runAsync('DELETE FROM racks WHERE id = ?', id);
}

export async function deleteWarehouse(db: DB, id: number) {
  await assertEmpty(db, 'r.warehouse_id', id, 'Склад');
  await db.runAsync('DELETE FROM warehouses WHERE id = ?', id);
}

// ---------------------------------------------------------------- boxes

export function getBox(db: DB, id: number) {
  return db.getFirstAsync<Box & { address: string | null }>(`
    SELECT b.*, ${ADDRESS_SQL} AS address FROM boxes b
    LEFT JOIN cells c ON c.id = b.cell_id LEFT JOIN racks r ON r.id = c.rack_id
    LEFT JOIN warehouses w ON w.id = r.warehouse_id WHERE b.id = ?`, id);
}

export function findBoxByCode(db: DB, code: string) {
  return db.getFirstAsync<Box>('SELECT * FROM boxes WHERE code = ?', code.trim());
}

export function listBoxesInCell(db: DB, cellId: number) {
  return db.getAllAsync<Box & { positions: number; total: number }>(`
    SELECT b.*,
      (SELECT COUNT(*) FROM stock s WHERE s.box_id = b.id AND s.qty > 0) AS positions,
      (SELECT IFNULL(SUM(s.qty), 0) FROM stock s WHERE s.box_id = b.id) AS total
    FROM boxes b WHERE b.cell_id = ? ORDER BY b.code`, cellId);
}

export async function createBox(db: DB, cellId: number, name?: string) {
  const n = await nextSeq(db, 'seq_box');
  const code = formatBoxCode(n);
  const r = await db.runAsync('INSERT INTO boxes(code, name, cell_id) VALUES(?, ?, ?)', code, emptyToNull(name), cellId);
  return { id: r.lastInsertRowId, code };
}

export async function renameBox(db: DB, id: number, name: string) {
  await db.runAsync('UPDATE boxes SET name = ? WHERE id = ?', emptyToNull(name), id);
}

export async function deleteBox(db: DB, id: number) {
  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM stock WHERE box_id = ? AND qty > 0', id);
  if (row && row.n > 0) throw new BusinessError('Короб не пуст');
  const used = await db.getFirstAsync<{ n: number }>(
    'SELECT (SELECT COUNT(*) FROM moves WHERE box_id = ?) + (SELECT COUNT(*) FROM doc_lines WHERE box_id = ?) AS n', id, id);
  if (used && used.n > 0) throw new BusinessError('Короб уже участвовал в документах — его можно только оставить пустым');
  await db.runAsync('DELETE FROM stock WHERE box_id = ?', id);
  await db.runAsync('DELETE FROM boxes WHERE id = ?', id);
}

// ---------------------------------------------------------------- items (номенклатура)

export function listItems(db: DB, search = '') {
  const q = `%${search.trim()}%`;
  return db.getAllAsync<Item & { total: number }>(`
    SELECT i.*, (SELECT IFNULL(SUM(qty), 0) FROM stock s WHERE s.item_id = i.id) AS total
    FROM items i
    WHERE ? = '%%' OR i.name LIKE ? OR i.sku LIKE ? OR IFNULL(i.barcode, '') LIKE ?
    ORDER BY i.name LIMIT 300`, q, q, q, q);
}

export function getItem(db: DB, id: number) {
  return db.getFirstAsync<Item>('SELECT * FROM items WHERE id = ?', id);
}

export async function saveItem(db: DB, it: Partial<Item> & { sku: string; name: string }) {
  const sku = it.sku.trim();
  const name = it.name.trim();
  if (!sku || !name) throw new BusinessError('Укажите артикул и наименование');
  if (/\s/.test(sku)) throw new BusinessError('Артикул не должен содержать пробелов');
  const barcode = emptyToNull(it.barcode);
  if (barcode) {
    const dup = await db.getFirstAsync<{ id: number }>(
      'SELECT id FROM items WHERE barcode = ? AND id <> ?', barcode, it.id ?? 0);
    if (dup) throw new BusinessError('Этот штрихкод уже назначен другому товару');
  }
  const unit = emptyToNull(it.unit) ?? 'шт';
  try {
    if (it.id) {
      await db.runAsync('UPDATE items SET sku = ?, name = ?, unit = ?, barcode = ?, description = ? WHERE id = ?',
        sku, name, unit, barcode, emptyToNull(it.description), it.id);
      return it.id;
    }
    const r = await db.runAsync('INSERT INTO items(sku, name, unit, barcode, description) VALUES(?, ?, ?, ?, ?)',
      sku, name, unit, barcode, emptyToNull(it.description));
    return r.lastInsertRowId;
  } catch (e) {
    if (String(e).includes('UNIQUE')) throw new BusinessError('Товар с таким артикулом уже существует');
    throw e;
  }
}

export async function deleteItem(db: DB, id: number) {
  const used = await db.getFirstAsync<{ n: number }>(
    'SELECT (SELECT COUNT(*) FROM moves WHERE item_id = ?) + (SELECT COUNT(*) FROM doc_lines WHERE item_id = ?) AS n', id, id);
  if (used && used.n > 0) throw new BusinessError('Товар используется в документах — удалить нельзя');
  await db.runAsync('DELETE FROM items WHERE id = ?', id);
}

export async function suggestSku(db: DB) {
  const n = await db.getFirstAsync<{ n: number }>('SELECT IFNULL(MAX(id), 0) + 1 AS n FROM items');
  return `TM-${String(n?.n ?? 1).padStart(5, '0')}`;
}

// ---------------------------------------------------------------- stock (остатки)

const STOCK_SELECT = `
  SELECT s.id, s.item_id, i.sku, i.name AS item_name, i.unit, s.qty, s.first_in_at,
    COALESCE(s.cell_id, b.cell_id) AS cell_id, s.box_id, b.code AS box_code,
    ${ADDRESS_SQL} AS address
  FROM stock s
  JOIN items i ON i.id = s.item_id
  LEFT JOIN boxes b ON b.id = s.box_id
  LEFT JOIN cells c ON c.id = COALESCE(s.cell_id, b.cell_id)
  LEFT JOIN racks r ON r.id = c.rack_id
  LEFT JOIN warehouses w ON w.id = r.warehouse_id`;

export function stockByItem(db: DB, itemId: number) {
  return db.getAllAsync<StockRow>(`${STOCK_SELECT} WHERE s.item_id = ? AND s.qty > 0 ORDER BY s.first_in_at`, itemId);
}

export function stockLooseInCell(db: DB, cellId: number) {
  return db.getAllAsync<StockRow>(`${STOCK_SELECT} WHERE s.cell_id = ? AND s.qty > 0 ORDER BY i.name`, cellId);
}

export function stockInBox(db: DB, boxId: number) {
  return db.getAllAsync<StockRow>(`${STOCK_SELECT} WHERE s.box_id = ? AND s.qty > 0 ORDER BY i.name`, boxId);
}

/** Всё, что физически находится в ячейке: россыпь + содержимое коробов. */
export function stockAllInCell(db: DB, cellId: number) {
  return db.getAllAsync<StockRow>(
    `${STOCK_SELECT} WHERE (s.cell_id = ? OR b.cell_id = ?) AND s.qty > 0 ORDER BY b.code, i.name`, cellId, cellId);
}

export function stockSearch(db: DB, search: string) {
  const q = `%${search.trim()}%`;
  return db.getAllAsync<StockRow>(`${STOCK_SELECT}
    WHERE s.qty > 0 AND (? = '%%' OR i.name LIKE ? OR i.sku LIKE ? OR IFNULL(i.barcode,'') LIKE ? OR IFNULL(b.code,'') LIKE ?)
    ORDER BY i.name, s.first_in_at LIMIT 300`, q, q, q, q, q);
}

async function changeStock(db: DB, itemId: number, place: Place, delta: number) {
  const cellId = place.boxId ? null : place.cellId!;
  const boxId = place.boxId ?? null;
  const row = await db.getFirstAsync<{ id: number; qty: number }>(
    'SELECT id, qty FROM stock WHERE item_id = ? AND IFNULL(cell_id, 0) = ? AND IFNULL(box_id, 0) = ?',
    itemId, cellId ?? 0, boxId ?? 0);
  const current = row?.qty ?? 0;
  const next = Math.round((current + delta) * 1000) / 1000;
  if (next < 0) {
    const item = await getItem(db, itemId);
    throw new BusinessError(
      `Недостаточно «${item?.name ?? itemId}» в месте хранения: есть ${current}, требуется ${-delta}`);
  }
  if (!row) {
    await db.runAsync('INSERT INTO stock(item_id, cell_id, box_id, qty) VALUES(?, ?, ?, ?)', itemId, cellId, boxId, next);
  } else if (next === 0) {
    await db.runAsync('DELETE FROM stock WHERE id = ?', row.id);
  } else {
    await db.runAsync('UPDATE stock SET qty = ? WHERE id = ?', next, row.id);
  }
}

async function cellOfPlace(db: DB, cellId: number | null, boxId: number | null): Promise<number | null> {
  if (!boxId) return cellId;
  const b = await db.getFirstAsync<{ cell_id: number | null }>('SELECT cell_id FROM boxes WHERE id = ?', boxId);
  return b?.cell_id ?? null;
}

// ---------------------------------------------------------------- documents

export async function createDocument(db: DB, type: DocType, mode: DocMode, userId: number) {
  const n = await nextSeq(db, `seq_${type}`);
  const r = await db.runAsync('INSERT INTO documents(type, mode, number, created_by) VALUES(?, ?, ?, ?)',
    type, mode, formatDocNumber(type, n), userId);
  return r.lastInsertRowId;
}

const DOC_SELECT = `
  SELECT d.*, u.full_name AS created_by_name, pu.full_name AS posted_by_name,
    (SELECT COUNT(*) FROM doc_lines l WHERE l.doc_id = d.id) AS lines_count
  FROM documents d
  JOIN users u ON u.id = d.created_by
  LEFT JOIN users pu ON pu.id = d.posted_by`;

export function listDocuments(db: DB, type?: DocType) {
  if (type) return db.getAllAsync<DocumentRow>(`${DOC_SELECT} WHERE d.type = ? ORDER BY d.id DESC LIMIT 300`, type);
  return db.getAllAsync<DocumentRow>(`${DOC_SELECT} ORDER BY d.id DESC LIMIT 300`);
}

export function getDocument(db: DB, id: number) {
  return db.getFirstAsync<DocumentRow>(`${DOC_SELECT} WHERE d.id = ?`, id);
}

export async function updateDocumentHeader(
  db: DB, id: number, h: { partner?: string; recipient?: string; comment?: string },
) {
  await db.runAsync('UPDATE documents SET partner = ?, recipient = ?, comment = ? WHERE id = ? AND status = \'draft\'',
    emptyToNull(h.partner), emptyToNull(h.recipient), emptyToNull(h.comment), id);
}

export function listLines(db: DB, docId: number) {
  return db.getAllAsync<DocLine>(`
    SELECT l.*, i.sku, i.name AS item_name, i.unit, i.barcode, b.code AS box_code,
      ${ADDRESS_SQL} AS address,
      tw.code || ' / ' || tr.code || ' / ' || tc.code AS to_address
    FROM doc_lines l
    JOIN items i ON i.id = l.item_id
    LEFT JOIN boxes b ON b.id = l.box_id
    LEFT JOIN cells c ON c.id = COALESCE(l.cell_id, b.cell_id)
    LEFT JOIN racks r ON r.id = c.rack_id
    LEFT JOIN warehouses w ON w.id = r.warehouse_id
    LEFT JOIN cells tc ON tc.id = l.to_cell_id
    LEFT JOIN racks tr ON tr.id = tc.rack_id
    LEFT JOIN warehouses tw ON tw.id = tr.warehouse_id
    WHERE l.doc_id = ?
    ORDER BY w.code, r.code, c.code, b.code, l.id`, docId);
}

async function assertDraft(db: DB, docId: number) {
  const d = await db.getFirstAsync<{ status: string }>('SELECT status FROM documents WHERE id = ?', docId);
  if (!d) throw new BusinessError('Документ не найден');
  if (d.status !== 'draft') throw new BusinessError('Документ проведён — сначала отмените проведение');
}

/**
 * Добавить строку. Одинаковые товар+место сворачиваются в одну строку
 * (как при сканировании в МойСклад: повторный скан увеличивает количество).
 */
export async function addLine(
  db: DB, docId: number, line: { itemId: number; qty: number; cellId?: number | null; boxId?: number | null },
) {
  await assertDraft(db, docId);
  const cellId = line.boxId ? null : line.cellId ?? null;
  const boxId = line.boxId ?? null;
  const existing = await db.getFirstAsync<{ id: number }>(`
    SELECT id FROM doc_lines WHERE doc_id = ? AND item_id = ? AND IFNULL(cell_id, 0) = ? AND IFNULL(box_id, 0) = ?`,
    docId, line.itemId, cellId ?? 0, boxId ?? 0);
  if (existing) {
    await db.runAsync('UPDATE doc_lines SET qty = qty + ? WHERE id = ?', line.qty, existing.id);
    return existing.id;
  }
  const r = await db.runAsync('INSERT INTO doc_lines(doc_id, item_id, qty, cell_id, box_id) VALUES(?, ?, ?, ?, ?)',
    docId, line.itemId, line.qty, cellId, boxId);
  return r.lastInsertRowId;
}

export async function updateLine(db: DB, lineId: number, patch: { qty?: number; place?: Place }) {
  const l = await db.getFirstAsync<{ doc_id: number }>('SELECT doc_id FROM doc_lines WHERE id = ?', lineId);
  if (!l) return;
  await assertDraft(db, l.doc_id);
  if (patch.qty !== undefined) await db.runAsync('UPDATE doc_lines SET qty = ? WHERE id = ?', patch.qty, lineId);
  if (patch.place) {
    await db.runAsync('UPDATE doc_lines SET cell_id = ?, box_id = ? WHERE id = ?',
      patch.place.boxId ? null : patch.place.cellId ?? null, patch.place.boxId ?? null, lineId);
  }
}

export async function deleteLine(db: DB, lineId: number) {
  const l = await db.getFirstAsync<{ doc_id: number }>('SELECT doc_id FROM doc_lines WHERE id = ?', lineId);
  if (!l) return;
  await assertDraft(db, l.doc_id);
  await db.runAsync('DELETE FROM doc_lines WHERE id = ?', lineId);
}

export async function deleteDocument(db: DB, docId: number) {
  await assertDraft(db, docId);
  await db.runAsync('DELETE FROM documents WHERE id = ?', docId);
}

/**
 * Расходный ордер «по плану»: добавить товар, а места отбора подобрать
 * автоматически (FIFO) с учётом того, что уже зарезервировано в документе.
 * Если нужно больше, чем есть, строки добавляются на доступное количество,
 * а нехватка возвращается вызывающему.
 */
export async function addIssueLineAuto(db: DB, docId: number, itemId: number, qty: number) {
  await assertDraft(db, docId);
  const sources = await db.getAllAsync<AllocSource>(`
    SELECT s.item_id, s.cell_id, s.box_id, s.qty, s.first_in_at FROM stock s
    WHERE s.item_id = ? AND s.qty > 0`, itemId);
  const lines = await db.getAllAsync<{ cell_id: number | null; box_id: number | null; qty: number }>(
    'SELECT cell_id, box_id, qty FROM doc_lines WHERE doc_id = ? AND item_id = ?', docId, itemId);
  const reserved = new Map<string, number>();
  for (const l of lines) {
    const k = placeKey(l.cell_id, l.box_id);
    reserved.set(k, (reserved.get(k) ?? 0) + l.qty);
  }
  const res = allocate(sources, qty, reserved);
  await inTransaction(db, async (txn) => {
    for (const p of res.picks) {
      await addLine(txn, docId, { itemId, qty: p.qty, cellId: p.cell_id, boxId: p.box_id });
    }
  });
  return res;
}

/** Проведение документа: запись движений в регистр и изменение остатков — атомарно. */
export async function postDocument(db: DB, docId: number, userId: number) {
  await inTransaction(db, async (txn) => {
    const t = txn;
    const doc = await t.getFirstAsync<{ type: DocType; status: string; recipient: string | null }>(
      'SELECT type, status, recipient FROM documents WHERE id = ?', docId);
    if (!doc) throw new BusinessError('Документ не найден');
    if (doc.status !== 'draft') throw new BusinessError('Документ уже проведён');
    const lines = await t.getAllAsync<{ item_id: number; qty: number; cell_id: number | null; box_id: number | null }>(
      'SELECT item_id, qty, cell_id, box_id FROM doc_lines WHERE doc_id = ?', docId);
    if (!lines.length) throw new BusinessError('В документе нет строк');
    if (doc.type === 'issue' && !doc.recipient) {
      throw new BusinessError('Укажите, кому выдаются ТМЦ (поле «Получатель»)');
    }
    const sign = doc.type === 'receipt' ? 1 : -1;
    for (const l of lines) {
      if (!l.cell_id && !l.box_id) throw new BusinessError('Не во всех строках указано место хранения');
      const place: Place = l.box_id ? { boxId: l.box_id } : { cellId: l.cell_id! };
      await changeStock(t, l.item_id, place, sign * l.qty);
      await t.runAsync(
        'INSERT INTO moves(doc_id, item_id, box_id, cell_id, qty, user_id, recipient) VALUES(?, ?, ?, ?, ?, ?, ?)',
        docId, l.item_id, l.box_id, await cellOfPlace(t, l.cell_id, l.box_id), sign * l.qty, userId, doc.recipient);
    }
    await t.runAsync(
      "UPDATE documents SET status = 'posted', posted_by = ?, posted_at = datetime('now','localtime') WHERE id = ?",
      userId, docId);
  });
}

/** Отмена проведения (как в 1С): сторнируем остатки и удаляем движения документа. */
export async function unpostDocument(db: DB, docId: number) {
  await inTransaction(db, async (txn) => {
    const t = txn;
    const doc = await t.getFirstAsync<{ type: DocType; status: string }>(
      'SELECT type, status FROM documents WHERE id = ?', docId);
    if (!doc || doc.status !== 'posted') throw new BusinessError('Документ не проведён');
    if (doc.type === 'move') throw new BusinessError('Перемещение короба отменяется обратным перемещением');
    const moves = await t.getAllAsync<{ item_id: number; qty: number; cell_id: number | null; box_id: number | null }>(
      'SELECT item_id, qty, cell_id, box_id FROM moves WHERE doc_id = ?', docId);
    for (const m of moves) {
      const place: Place = m.box_id ? { boxId: m.box_id } : { cellId: m.cell_id! };
      await changeStock(t, m.item_id, place, -m.qty);
    }
    await t.runAsync('DELETE FROM moves WHERE doc_id = ?', docId);
    await t.runAsync("UPDATE documents SET status = 'draft', posted_by = NULL, posted_at = NULL WHERE id = ?", docId);
  });
}

/** Перемещение короба в другую ячейку: документ «ПМ» проводится сразу. */
export async function moveBox(db: DB, boxId: number, toCellId: number, userId: number) {
  const box = await getBox(db, boxId);
  if (!box) throw new BusinessError('Короб не найден');
  if (box.cell_id === toCellId) throw new BusinessError('Короб уже в этой ячейке');
  const n = await nextSeq(db, 'seq_move');
  await inTransaction(db, async (txn) => {
    const t = txn;
    const r = await t.runAsync(`
      INSERT INTO documents(type, mode, number, status, created_by, posted_by, posted_at, comment)
      VALUES('move', 'fact', ?, 'posted', ?, ?, datetime('now','localtime'), ?)`,
      formatDocNumber('move', n), userId, userId, `Перемещение короба ${box.code}`);
    const docId = r.lastInsertRowId;
    const content = await t.getAllAsync<{ item_id: number; qty: number }>(
      'SELECT item_id, qty FROM stock WHERE box_id = ? AND qty > 0', boxId);
    for (const s of content) {
      await t.runAsync('INSERT INTO doc_lines(doc_id, item_id, qty, cell_id, box_id, to_cell_id) VALUES(?, ?, ?, NULL, ?, ?)',
        docId, s.item_id, s.qty, boxId, toCellId);
      await t.runAsync('INSERT INTO moves(doc_id, item_id, box_id, cell_id, qty, user_id) VALUES(?, ?, ?, ?, ?, ?)',
        docId, s.item_id, boxId, box.cell_id, -s.qty, userId);
      await t.runAsync('INSERT INTO moves(doc_id, item_id, box_id, cell_id, qty, user_id) VALUES(?, ?, ?, ?, ?, ?)',
        docId, s.item_id, boxId, toCellId, s.qty, userId);
    }
    await t.runAsync('UPDATE boxes SET cell_id = ? WHERE id = ?', toCellId, boxId);
  });
}

// ---------------------------------------------------------------- history

export interface HistoryFilter {
  itemId?: number;
  userId?: number;
  docId?: number;
  boxId?: number;
  cellId?: number;
  direction?: 'in' | 'out';
  search?: string;
}

export function listMoves(db: DB, f: HistoryFilter = {}) {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (f.itemId) { where.push('m.item_id = ?'); args.push(f.itemId); }
  if (f.userId) { where.push('m.user_id = ?'); args.push(f.userId); }
  if (f.docId) { where.push('m.doc_id = ?'); args.push(f.docId); }
  if (f.boxId) { where.push('m.box_id = ?'); args.push(f.boxId); }
  if (f.cellId) { where.push('m.cell_id = ?'); args.push(f.cellId); }
  if (f.direction === 'in') where.push('m.qty > 0');
  if (f.direction === 'out') where.push('m.qty < 0');
  if (f.search?.trim()) {
    const q = `%${f.search.trim()}%`;
    where.push("(i.name LIKE ? OR i.sku LIKE ? OR IFNULL(m.recipient,'') LIKE ? OR u.full_name LIKE ? OR IFNULL(d.number,'') LIKE ?)");
    args.push(q, q, q, q, q);
  }
  return db.getAllAsync<MoveRow>(`
    SELECT m.id, m.doc_id, d.number AS doc_number, d.type AS doc_type, m.item_id, i.sku, i.name AS item_name,
      i.unit, m.qty, b.code AS box_code, ${ADDRESS_SQL} AS address, u.full_name AS user_name,
      m.recipient, m.created_at
    FROM moves m
    JOIN items i ON i.id = m.item_id
    JOIN users u ON u.id = m.user_id
    LEFT JOIN documents d ON d.id = m.doc_id
    LEFT JOIN boxes b ON b.id = m.box_id
    LEFT JOIN cells c ON c.id = m.cell_id
    LEFT JOIN racks r ON r.id = c.rack_id
    LEFT JOIN warehouses w ON w.id = r.warehouse_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY m.id DESC LIMIT 500`, ...args);
}

export function listUsers(db: DB) {
  return db.getAllAsync<{ id: number; login: string; full_name: string }>(
    'SELECT id, login, full_name FROM users ORDER BY full_name');
}

// ---------------------------------------------------------------- scanning

export type Resolved =
  | { type: 'cell'; cell: CellAddress }
  | { type: 'box'; box: Box }
  | { type: 'item'; item: Item }
  | { type: 'none'; value: string };

/** Распознать отсканированный код: внутренний QR или штрихкод производителя. */
export async function resolveScan(db: DB, t: ScanTarget): Promise<Resolved> {
  switch (t.kind) {
    case 'cell': {
      const cell = await getCell(db, t.id);
      return cell ? { type: 'cell', cell } : { type: 'none', value: `Ячейка #${t.id}` };
    }
    case 'box': {
      const box = await findBoxByCode(db, t.code);
      return box ? { type: 'box', box } : { type: 'none', value: t.code };
    }
    case 'item': {
      const item = await db.getFirstAsync<Item>('SELECT * FROM items WHERE sku = ?', t.sku);
      return item ? { type: 'item', item } : { type: 'none', value: t.sku };
    }
    case 'raw': {
      const item = await db.getFirstAsync<Item>(
        'SELECT * FROM items WHERE barcode = ? OR sku = ? ORDER BY barcode = ? DESC LIMIT 1', t.value, t.value, t.value);
      if (item) return { type: 'item', item };
      const box = await findBoxByCode(db, t.value);
      if (box) return { type: 'box', box };
      return { type: 'none', value: t.value };
    }
  }
}
