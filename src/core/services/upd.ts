import { need, type Ctx } from '../ctx';
import { BusinessError, today } from '../db';
import { can } from '../roles';
import type { DocumentRow } from '../types';
import { updTotals, type UpdData, type UpdLine, type UpdParty, type VatRate } from '../upd';
import { documents } from './documents';

const DEFAULT_VAT: VatRate = 22;

/** Строки УПД из расходного ордера: одна строка на товар (отбор из разных мест суммируется). */
async function linesOfDoc(ctx: Ctx, docId: number): Promise<UpdLine[]> {
  const rows = await ctx.db.getAllAsync<{ item_id: number; sku: string; name: string; unit: string; qty: number; price: number | null }>(`
    SELECT l.item_id, i.sku, i.name, i.unit, round(SUM(l.qty), 3) AS qty, i.price
    FROM doc_lines l JOIN items i ON i.id = l.item_id
    WHERE l.doc_id = ? GROUP BY l.item_id ORDER BY MIN(l.id)`, docId);
  return rows.map((r) => ({ item_id: r.item_id, sku: r.sku, name: r.name, unit: r.unit, qty: r.qty, price: r.price ?? 0 }));
}

const grossOf = (net: number, vat: VatRate) => Math.round(net * (1 + (vat === 'none' ? 0 : vat) / 100) * 100) / 100;

export const upd = {
  /**
   * Данные УПД по расходному ордеру: сохранённые ранее или заготовка из ордера.
   * Строки всегда берутся из ордера (вдруг его изменили), цены — из сохранённого УПД или последние по товару.
   */
  async get(ctx: Ctx, docId: number): Promise<{ data: UpdData; saved: boolean; doc: DocumentRow }> {
    need(ctx, can.operate, 'УПД');
    const doc = await documents.get(ctx, docId);
    if (doc.type !== 'issue') throw new BusinessError('УПД оформляется по расходному ордеру');
    const lines = await linesOfDoc(ctx, docId);
    const row = await ctx.db.getFirstAsync<{ data: string }>('SELECT data FROM upd_docs WHERE doc_id = ?', docId);
    if (row) {
      const saved = JSON.parse(row.data) as UpdData;
      const price = new Map(saved.lines.map((l) => [l.item_id, l.price]));
      return {
        doc, saved: true,
        data: { ...saved, lines: lines.map((l) => ({ ...l, price: price.get(l.item_id) ?? (saved.priceWithVat ? grossOf(l.price, saved.vat) : l.price) })) },
      };
    }
    const date = (doc.posted_at ?? doc.doc_date).slice(0, 10) || today();
    const data: UpdData = {
      status: 1,
      number: doc.number,
      date,
      buyer: { name: doc.recipient ?? '', inn: '', kpp: '', address: '' },
      consigneeSame: true,
      consignee: { name: '', address: '' },
      basis: doc.partner ?? '',
      paymentDoc: '',
      shipDate: date,
      vat: DEFAULT_VAT,
      priceWithVat: true,
      lines: lines.map((l) => ({ ...l, price: grossOf(l.price, DEFAULT_VAT) })),
      passedBy: doc.assignee_name ?? doc.posted_by_name ?? '',
      receivedBy: '',
    };
    return { doc, saved: false, data };
  },

  /** Сохранить УПД; последняя цена без НДС запоминается в товаре — подставится в следующий раз. */
  async save(ctx: Ctx, docId: number, data: UpdData) {
    need(ctx, can.operate, 'УПД');
    const doc = await documents.get(ctx, docId);
    if (doc.type !== 'issue') throw new BusinessError('УПД оформляется по расходному ордеру');
    if (!data.number?.trim()) throw new BusinessError('Укажите номер УПД');
    if (data.lines.some((l) => !(l.price >= 0))) throw new BusinessError('Цена не может быть отрицательной');
    const t = updTotals(data);
    await ctx.db.runAsync(`INSERT INTO upd_docs(doc_id, data, updated_by) VALUES(?, ?, ?)
      ON CONFLICT(doc_id) DO UPDATE SET data = excluded.data, updated_by = excluded.updated_by, updated_at = datetime('now','localtime')`,
    docId, JSON.stringify(data), ctx.user.id);
    for (const r of t.rows) if (r.price > 0) await ctx.db.runAsync('UPDATE items SET price = ? WHERE id = ?', r.priceNet, r.item_id);
    return t;
  },

  /** Покупатели из прошлых УПД — чтобы не вводить реквизиты заново. */
  async buyers(ctx: Ctx): Promise<UpdParty[]> {
    need(ctx, can.operate, 'УПД');
    const rows = await ctx.db.getAllAsync<{ data: string }>('SELECT data FROM upd_docs ORDER BY updated_at DESC LIMIT 300');
    const out = new Map<string, UpdParty>();
    for (const r of rows) {
      const b = (JSON.parse(r.data) as UpdData).buyer;
      const key = `${b.inn.trim()}|${b.name.trim().toLowerCase()}`;
      if (b.name.trim() && !out.has(key)) out.set(key, b);
    }
    return [...out.values()].slice(0, 30);
  },
};
