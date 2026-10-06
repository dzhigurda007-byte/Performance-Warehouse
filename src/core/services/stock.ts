import { BusinessError, round3, today, type DB } from '../db';
import type { Place, StockRow } from '../types';

export const ADDRESS_SQL = `w.code || ' / ' || r.code || ' / ' || c.code`;

export const STOCK_SELECT = `
  SELECT s.id, s.item_id, i.sku, i.name AS item_name, i.unit, s.qty, s.first_in_at, s.received_at,
    COALESCE(s.cell_id, b.cell_id) AS cell_id, s.box_id, b.code AS box_code, c.is_buffer,
    ${ADDRESS_SQL} AS address
  FROM stock s
  JOIN items i ON i.id = s.item_id
  LEFT JOIN boxes b ON b.id = s.box_id
  LEFT JOIN cells c ON c.id = COALESCE(s.cell_id, b.cell_id)
  LEFT JOIN racks r ON r.id = c.rack_id
  LEFT JOIN warehouses w ON w.id = r.warehouse_id`;

export function placeOf(cellId: number | null | undefined, boxId: number | null | undefined): Place {
  if (boxId) return { boxId };
  if (cellId) return { cellId };
  throw new BusinessError('Не указано место хранения');
}

export async function cellOfPlace(db: DB, cellId: number | null, boxId: number | null): Promise<number | null> {
  if (!boxId) return cellId;
  const b = await db.getFirstAsync<{ cell_id: number | null }>('SELECT cell_id FROM boxes WHERE id = ?', boxId);
  return b?.cell_id ?? null;
}

export interface LotQty {
  received_at: string;
  qty: number;
}

/**
 * Изменить остаток в месте хранения.
 *  delta > 0 — приход партии с датой receivedAt (по умолчанию сегодня);
 *  delta < 0 — расход: из указанной партии, а если она не указана — по FIFO
 *              (сначала самые старые партии этого места).
 * Возвращает затронутые партии — они пишутся в движения, чтобы дата
 * приёмки «ехала» вместе с товаром при перемещении.
 */
export async function changeStock(
  db: DB, itemId: number, place: Place, delta: number, receivedAt?: string | null,
): Promise<LotQty[]> {
  const cellId = place.boxId ? null : place.cellId!;
  const boxId = place.boxId ?? null;
  if (delta > 0) {
    const lot = receivedAt || today();
    const row = await db.getFirstAsync<{ id: number }>(
      `SELECT id FROM stock WHERE item_id = ? AND IFNULL(cell_id, 0) = ? AND IFNULL(box_id, 0) = ? AND received_at = ?`,
      itemId, cellId ?? 0, boxId ?? 0, lot);
    if (row) await db.runAsync('UPDATE stock SET qty = round(qty + ?, 3) WHERE id = ?', delta, row.id);
    else {
      await db.runAsync('INSERT INTO stock(item_id, cell_id, box_id, qty, received_at) VALUES(?, ?, ?, ?, ?)',
        itemId, cellId, boxId, round3(delta), lot);
    }
    return [{ received_at: lot, qty: round3(delta) }];
  }
  let need = round3(-delta);
  const rows = await db.getAllAsync<{ id: number; qty: number; received_at: string }>(
    `SELECT id, qty, received_at FROM stock
     WHERE item_id = ? AND IFNULL(cell_id, 0) = ? AND IFNULL(box_id, 0) = ? AND qty > 0
       ${receivedAt ? 'AND received_at = ?' : ''}
     ORDER BY received_at, id`,
    ...([itemId, cellId ?? 0, boxId ?? 0, ...(receivedAt ? [receivedAt] : [])] as (string | number)[]));
  const available = round3(rows.reduce((a, r) => a + r.qty, 0));
  if (available < need) {
    const item = await db.getFirstAsync<{ name: string; unit: string }>('SELECT name, unit FROM items WHERE id = ?', itemId);
    throw new BusinessError(
      `Недостаточно «${item?.name ?? itemId}» в месте хранения: есть ${available} ${item?.unit ?? ''}, требуется ${need}`);
  }
  const used: LotQty[] = [];
  for (const r of rows) {
    if (need <= 0) break;
    const take = Math.min(r.qty, need);
    const left = round3(r.qty - take);
    if (left <= 0) await db.runAsync('DELETE FROM stock WHERE id = ?', r.id);
    else await db.runAsync('UPDATE stock SET qty = ? WHERE id = ?', left, r.id);
    used.push({ received_at: r.received_at, qty: round3(take) });
    need = round3(need - take);
  }
  return used;
}

export async function availableAt(db: DB, itemId: number, place: Place): Promise<number> {
  const row = await db.getFirstAsync<{ q: number }>(
    'SELECT IFNULL(SUM(qty), 0) AS q FROM stock WHERE item_id = ? AND IFNULL(cell_id, 0) = ? AND IFNULL(box_id, 0) = ?',
    itemId, place.boxId ? 0 : place.cellId!, place.boxId ?? 0);
  return round3(row?.q ?? 0);
}

// ---------------------------------------------------------------- запросы остатков

export const stockQueries = {
  byItem: (db: DB, itemId: number) =>
    db.getAllAsync<StockRow>(`${STOCK_SELECT} WHERE s.item_id = ? AND s.qty > 0 ORDER BY s.received_at, s.id`, itemId),
  looseInCell: (db: DB, cellId: number) =>
    db.getAllAsync<StockRow>(`${STOCK_SELECT} WHERE s.cell_id = ? AND s.qty > 0 ORDER BY i.name, s.received_at`, cellId),
  inBox: (db: DB, boxId: number) =>
    db.getAllAsync<StockRow>(`${STOCK_SELECT} WHERE s.box_id = ? AND s.qty > 0 ORDER BY i.name, s.received_at`, boxId),
  allInCell: (db: DB, cellId: number) =>
    db.getAllAsync<StockRow>(
      `${STOCK_SELECT} WHERE (s.cell_id = ? OR b.cell_id = ?) AND s.qty > 0 ORDER BY b.code, i.name, s.received_at`,
      cellId, cellId),
  /** Всё, что лежит на стеллаже: россыпь в ячейках и содержимое коробов. */
  inRack: (db: DB, rackId: number) =>
    db.getAllAsync<StockRow>(`${STOCK_SELECT} WHERE r.id = ? AND s.qty > 0 ORDER BY c.code, b.code, i.name, s.received_at`, rackId),
  search: (db: DB, search: string, warehouseId?: number | null) => {
    const q = `%${search.trim()}%`;
    return db.getAllAsync<StockRow>(`${STOCK_SELECT}
      WHERE s.qty > 0 AND (? = '%%' OR i.name LIKE ? OR i.sku LIKE ? OR IFNULL(i.barcode,'') LIKE ? OR IFNULL(b.code,'') LIKE ?)
        AND (? = 0 OR w.id = ?)
      ORDER BY i.name, s.received_at LIMIT 500`, q, q, q, q, q, warehouseId ?? 0, warehouseId ?? 0);
  },
};
