import { need, type Ctx } from '../ctx';
import { likeFold } from '../db';
import { parseScan } from '../codes';
import { can } from '../roles';
import type { Box, CellAddress, CustodyRow, Item, MoveRow, Rack } from '../types';
import { custody } from './custody';
import { findItemByCode } from './items';
import { ADDRESS_SQL } from './stock';
import { structure } from './structure';

export interface HistoryFilter {
  itemId?: number;
  userId?: number;
  docId?: number;
  boxId?: number;
  cellId?: number;
  direction?: 'in' | 'out';
  search?: string;
}

export type Resolved =
  | { type: 'rack'; rack: Rack & { warehouse_code: string; warehouse_name: string } }
  | { type: 'cell'; cell: CellAddress }
  | { type: 'box'; box: Box }
  | { type: 'item'; item: Item }
  | { type: 'custody'; custody: CustodyRow }
  | { type: 'server'; url: string }
  | { type: 'invite'; server: string; token: string }
  | { type: 'none'; value: string };

export const history = {
  moves(ctx: Ctx, f: HistoryFilter = {}) {
    need(ctx, can.stockTab, 'просмотр истории');
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (!can.operate(ctx.user.role)) { where.push('(m.user_id = ? OR m.holder_id = ?)'); args.push(ctx.user.id, ctx.user.id); }
    if (f.itemId) { where.push('m.item_id = ?'); args.push(f.itemId); }
    if (f.userId) { where.push('m.user_id = ?'); args.push(f.userId); }
    if (f.docId) { where.push('m.doc_id = ?'); args.push(f.docId); }
    if (f.boxId) { where.push('m.box_id = ?'); args.push(f.boxId); }
    if (f.cellId) { where.push('m.cell_id = ?'); args.push(f.cellId); }
    if (f.direction === 'in') where.push('m.qty > 0');
    if (f.direction === 'out') where.push('m.qty < 0');
    if (f.search?.trim()) {
      const q = `%${f.search.trim()}%`;
      where.push("(i.search_name LIKE ? OR i.sku LIKE ? OR IFNULL(m.recipient,'') LIKE ? OR u.full_name LIKE ? OR IFNULL(d.number,'') LIKE ?)");
      args.push(likeFold(f.search), q, q, q, q);
    }
    return ctx.db.getAllAsync<MoveRow>(`
      SELECT m.id, m.doc_id, d.number AS doc_number, d.type AS doc_type, m.item_id, i.sku, i.name AS item_name,
        i.unit, m.qty, b.code AS box_code, ${ADDRESS_SQL} AS address, u.full_name AS user_name,
        m.recipient, m.created_at, m.kind, m.received_at
      FROM moves m
      JOIN items i ON i.id = m.item_id
      JOIN users u ON u.id = m.user_id
      LEFT JOIN documents d ON d.id = m.doc_id
      LEFT JOIN boxes b ON b.id = m.box_id
      LEFT JOIN cells c ON c.id = m.cell_id
      LEFT JOIN racks r ON r.id = c.rack_id
      LEFT JOIN warehouses w ON w.id = r.warehouse_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY m.id DESC LIMIT 1000`, ...args);
  },

  /** Распознать отсканированный код: внутренний QR, ШК производителя, инвентарный номер, приглашение. */
  async resolveScan(ctx: Ctx, raw: string): Promise<Resolved> {
    const t = parseScan(raw);
    switch (t.kind) {
      case 'server':
        return { type: 'server', url: t.url };
      case 'invite':
        return { type: 'invite', server: t.server, token: t.token };
      case 'rack': {
        const rack = await structure.getRack(ctx, t.id);
        return rack ? { type: 'rack', rack } : { type: 'none', value: `Стеллаж #${t.id}` };
      }
      case 'cell': {
        const cell = await structure.getCell(ctx, t.id);
        return cell ? { type: 'cell', cell } : { type: 'none', value: `Ячейка #${t.id}` };
      }
      case 'box': {
        const box = await structure.findBoxByCode(ctx, t.code);
        return box ? { type: 'box', box } : { type: 'none', value: t.code };
      }
      case 'custody': {
        const k = await custody.findByCode(ctx, t.code);
        return k ? { type: 'custody', custody: k } : { type: 'none', value: t.code };
      }
      case 'item': {
        const item = await ctx.db.getFirstAsync<Item>('SELECT * FROM items WHERE sku = ?', t.sku);
        return item ? { type: 'item', item } : { type: 'none', value: t.sku };
      }
      case 'raw': {
        const item = await findItemByCode(ctx.db, t.value);
        if (item) return { type: 'item', item };
        const box = await structure.findBoxByCode(ctx, t.value);
        if (box) return { type: 'box', box };
        const k = await custody.findByCode(ctx, t.value);
        if (k) return { type: 'custody', custody: k };
        // код ячейки, набранный вручную
        const cell = await structure.findCellByText(ctx, t.value);
        if (cell) return { type: 'cell', cell };
        return { type: 'none', value: t.value };
      }
    }
  },
};
