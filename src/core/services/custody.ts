import { deny, isSuperiorOf, subordinateIds, type Ctx } from '../ctx';
import { BusinessError, emptyToNull, inTransaction } from '../db';
import { can } from '../roles';
import { CONDITION_LABEL, type CustodyRow, type ReturnCondition } from '../types';
import { createReturnReceipt } from './documents';

const CUSTODY_SELECT = `
  SELECT k.*, i.sku, i.name AS item_name, i.unit,
    h.full_name AS holder_name, h.role AS holder_role, ib.full_name AS issued_by_name,
    d.number AS issue_doc_number, rb.full_name AS returned_by_name, rd.number AS return_doc_number
  FROM custody k
  JOIN items i ON i.id = k.item_id
  JOIN users h ON h.id = k.holder_id
  JOIN users ib ON ib.id = k.issued_by
  JOIN documents d ON d.id = k.issue_doc_id
  LEFT JOIN users rb ON rb.id = k.returned_by
  LEFT JOIN documents rd ON rd.id = k.return_doc_id`;

export interface ReturnEntry {
  custodyId: number;
  condition?: ReturnCondition;
  comment?: string;
}

/** Может ли пользователь оформить возврат / видеть запись: держатель, выдавший, их руководитель, админ. */
async function canTouch(ctx: Ctx, k: { holder_id: number; issued_by: number }) {
  const me = ctx.user.id;
  if (ctx.user.role === 'admin' || k.holder_id === me || k.issued_by === me) return true;
  return (await isSuperiorOf(ctx.db, me, k.issued_by)) || (await isSuperiorOf(ctx.db, me, k.holder_id));
}

export const custody = {
  /** «Мои ТМЦ»: что числится на мне. */
  mine: (ctx: Ctx, active = true) =>
    ctx.db.getAllAsync<CustodyRow>(
      `${CUSTODY_SELECT} WHERE k.holder_id = ? ${active ? "AND k.status IN ('held','returned')" : ''}
       ORDER BY k.status = 'held' DESC, k.issued_at DESC LIMIT 1000`, ctx.user.id),

  /**
   * «Выдано»: кому, что, сколько и когда выдал я (scope=mine) или
   * мои подчинённые (scope=team, для руководителя), или все (admin).
   */
  async issued(ctx: Ctx, f: { scope?: 'mine' | 'team'; active?: boolean; holderId?: number } = {}) {
    if (!can.operate(ctx.user.role)) deny('просмотр выдач');
    const where: string[] = [];
    const args: number[] = [];
    if (f.scope === 'team' && can.viewTeam(ctx.user.role)) {
      if (ctx.user.role !== 'admin') {
        const ids = [ctx.user.id, ...(await subordinateIds(ctx.db, ctx.user.id))];
        where.push(`k.issued_by IN (${ids.map(() => '?').join(',')})`);
        args.push(...ids);
      }
    } else {
      where.push('k.issued_by = ?');
      args.push(ctx.user.id);
    }
    if (f.active) where.push("k.status IN ('held','returned')");
    if (f.holderId) { where.push('k.holder_id = ?'); args.push(f.holderId); }
    return ctx.db.getAllAsync<CustodyRow>(
      `${CUSTODY_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY k.issued_at DESC, k.id LIMIT 2000`,
      ...args);
  },

  async get(ctx: Ctx, id: number) {
    const k = await ctx.db.getFirstAsync<CustodyRow>(`${CUSTODY_SELECT} WHERE k.id = ?`, id);
    if (!k) throw new BusinessError('Запись выдачи не найдена');
    if (!(await canTouch(ctx, k)) && !can.operate(ctx.user.role)) deny('просмотр выдачи');
    return k;
  },

  async findByCode(ctx: Ctx, code: string) {
    const k = await ctx.db.getFirstAsync<{ id: number }>('SELECT id FROM custody WHERE code = ?', code.trim());
    return k ? custody.get(ctx, k.id) : null;
  },

  byIssueDoc: (ctx: Ctx, docId: number) =>
    ctx.db.getAllAsync<CustodyRow>(`${CUSTODY_SELECT} WHERE k.issue_doc_id = ? ORDER BY h.full_name, i.name, k.id`, docId),

  /**
   * Возврат ТМЦ. Оформляет получатель или выдавший (или их руководитель).
   * По умолчанию отметка «Без повреждений». Когда по расходному ордеру
   * вернули всё, автоматически формируется приходный ордер с отметками.
   */
  async returnItems(ctx: Ctx, entries: ReturnEntry[]) {
    if (!entries.length) throw new BusinessError('Выберите ТМЦ для возврата');
    const createdReceipts: number[] = [];
    await inTransaction(ctx.db, async (t) => {
      const tctx = { ...ctx, db: t };
      const docs = new Set<number>();
      for (const e of entries) {
        const k = await t.getFirstAsync<{ id: number; holder_id: number; issued_by: number; status: string; issue_doc_id: number; code: string }>(
          'SELECT id, holder_id, issued_by, status, issue_doc_id, code FROM custody WHERE id = ?', e.custodyId);
        if (!k) throw new BusinessError('Запись выдачи не найдена');
        if (k.status !== 'held') throw new BusinessError(`${k.code}: уже возвращено`);
        if (!(await canTouch(tctx, k))) deny(`возврат ${k.code}`);
        const condition: ReturnCondition = e.condition && e.condition in CONDITION_LABEL ? e.condition : 'ok';
        await t.runAsync(`UPDATE custody SET status = 'returned', return_condition = ?, return_comment = ?,
          returned_by = ?, returned_at = datetime('now','localtime') WHERE id = ?`,
        condition, emptyToNull(e.comment), ctx.user.id, k.id);
        docs.add(k.issue_doc_id);
      }
      for (const docId of docs) {
        const held = await t.getFirstAsync<{ n: number }>(
          "SELECT COUNT(*) AS n FROM custody WHERE issue_doc_id = ? AND status = 'held'", docId);
        if (held && held.n === 0) {
          const r = await createReturnReceipt(t, docId);
          if (r) createdReceipts.push(r);
        }
      }
    });
    return { receipts: createdReceipts };
  },

  /** Сформировать приход по уже возвращённым ТМЦ, не дожидаясь остальных. */
  async receiptForReturned(ctx: Ctx, issueDocId: number) {
    const any = await ctx.db.getFirstAsync<{ holder_id: number; issued_by: number }>(
      'SELECT holder_id, issued_by FROM custody WHERE issue_doc_id = ? LIMIT 1', issueDocId);
    if (!any) throw new BusinessError('По документу нет выдач');
    const me = ctx.user.id;
    if (!(ctx.user.role === 'admin' || any.issued_by === me || (await isSuperiorOf(ctx.db, me, any.issued_by)))) {
      deny('оформление прихода по возврату');
    }
    let id: number | null = null;
    await inTransaction(ctx.db, async (t) => {
      id = await createReturnReceipt(t, issueDocId);
    });
    if (!id) throw new BusinessError('Нет возвращённых ТМЦ без приходного ордера');
    return id;
  },

  /** Возвратные приходы, которые ждут проведения и которые я могу провести. */
  async pendingReturnReceipts(ctx: Ctx) {
    const rows = await ctx.db.getAllAsync<{ id: number; number: string; base_doc_number: string; issuer: number;
      issuer_name: string; lines: number; created_at: string }>(`
      SELECT d.id, d.number, bd.number AS base_doc_number, bd.posted_by AS issuer, u.full_name AS issuer_name,
        (SELECT COUNT(*) FROM doc_lines l WHERE l.doc_id = d.id) AS lines, d.doc_date AS created_at
      FROM documents d JOIN documents bd ON bd.id = d.base_doc_id JOIN users u ON u.id = bd.posted_by
      WHERE d.source = 'return' AND d.status = 'draft' ORDER BY d.id DESC`);
    const out = [];
    for (const r of rows) {
      if (ctx.user.role === 'admin' || r.issuer === ctx.user.id || (await isSuperiorOf(ctx.db, ctx.user.id, r.issuer))) out.push(r);
    }
    return out;
  },
};
