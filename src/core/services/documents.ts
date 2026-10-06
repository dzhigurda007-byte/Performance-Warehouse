import { allocate, placeKey, type AllocSource } from '../allocation';
import { formatCustodyCode, formatDocNumber } from '../codes';
import { deny, isSuperiorOf, need, type Ctx } from '../ctx';
import { BusinessError, emptyToNull, getMeta, inTransaction, nextSeq, round3, today, type DB } from '../db';
import { can, rank, ROLE_RANK, type Role } from '../roles';
import {
  CONDITION_NOT_ACCEPTED,
  type Allocation,
  type DocLine,
  type DocMode,
  type DocType,
  type DocumentRow,
  type Place,
  type PostMode,
  type ReturnCondition,
} from '../types';
import { findItemByCode, items, type ImportRow } from './items';
import { ADDRESS_SQL, cellOfPlace, changeStock, placeOf } from './stock';
import { ensureBufferCell } from './structure';

export const SETTING_CUSTODY = 'feature_custody';

export async function custodyEnabled(db: DB): Promise<boolean> {
  return (await getMeta(db, SETTING_CUSTODY)) === '1';
}

const DOC_SELECT = `
  SELECT d.*, u.full_name AS created_by_name, pu.full_name AS posted_by_name, bd.number AS base_doc_number,
    wh.name AS warehouse_name,
    (SELECT COUNT(*) FROM doc_lines l WHERE l.doc_id = d.id) AS lines_count
  FROM documents d
  JOIN users u ON u.id = d.created_by
  LEFT JOIN users pu ON pu.id = d.posted_by
  LEFT JOIN documents bd ON bd.id = d.base_doc_id
  LEFT JOIN warehouses wh ON wh.id = d.warehouse_id`;

async function getDocRaw(db: DB, id: number) {
  const d = await db.getFirstAsync<DocumentRow>(`${DOC_SELECT} WHERE d.id = ?`, id);
  if (!d) throw new BusinessError('Документ не найден');
  return d;
}

/** Кто может работать с черновиком: кладовщик и выше — с любым, сотрудник — только со своим расходом. */
async function assertCanEdit(ctx: Ctx, docId: number) {
  const d = await getDocRaw(ctx.db, docId);
  if (d.status !== 'draft') throw new BusinessError('Документ проведён — сначала отмените проведение');
  if (can.operate(ctx.user.role)) return d;
  if (d.type === 'issue' && d.created_by === ctx.user.id && can.takeForSelf(ctx.user.role)) return d;
  deny('изменение документа');
}

/** Провести возвратный приход может тот, кто выдавал, его руководитель или администратор. */
async function canPostReturn(ctx: Ctx, d: DocumentRow) {
  if (ctx.user.role === 'admin') return true;
  const base = d.base_doc_id ? await getDocRaw(ctx.db, d.base_doc_id) : null;
  const issuer = base?.posted_by ?? d.created_by;
  return issuer === ctx.user.id || (await isSuperiorOf(ctx.db, ctx.user.id, issuer));
}

async function warehouseOfCell(db: DB, cellId: number | null): Promise<number | null> {
  if (!cellId) return null;
  const r = await db.getFirstAsync<{ id: number }>(
    'SELECT r.warehouse_id AS id FROM cells c JOIN racks r ON r.id = c.rack_id WHERE c.id = ?', cellId);
  return r?.id ?? null;
}

async function writeMove(db: DB, m: {
  docId: number; itemId: number; boxId: number | null; cellId: number | null; qty: number; userId: number;
  kind: string; receivedAt: string | null; recipient?: string | null; holderId?: number | null;
}) {
  await db.runAsync(`INSERT INTO moves(doc_id, item_id, box_id, cell_id, qty, user_id, recipient, kind, received_at, holder_id)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  m.docId, m.itemId, m.boxId, m.cellId, m.qty, m.userId, m.recipient ?? null, m.kind, m.receivedAt, m.holderId ?? null);
}

async function markPosted(db: DB, docId: number, userId: number, postMode: PostMode | null = null) {
  await db.runAsync(`UPDATE documents SET status = 'posted', posted_by = ?, posted_at = datetime('now','localtime'),
    post_mode = COALESCE(?, post_mode) WHERE id = ?`, userId, postMode, docId);
}

export async function createReturnReceipt(db: DB, issueDocId: number): Promise<number | null> {
  const pending = await db.getAllAsync<{
    id: number; item_id: number; qty: number; return_condition: ReturnCondition; return_comment: string | null;
    warehouse_id: number | null; issued_by: number;
  }>(`SELECT id, item_id, qty, return_condition, return_comment, warehouse_id, issued_by FROM custody
      WHERE issue_doc_id = ? AND status = 'returned' AND return_doc_id IS NULL ORDER BY id`, issueDocId);
  if (!pending.length) return null;
  const issue = await getDocRaw(db, issueDocId);
  const n = await nextSeq(db, 'seq_receipt');
  const r = await db.runAsync(`INSERT INTO documents(type, mode, number, created_by, source, base_doc_id, warehouse_id, partner, comment)
    VALUES('receipt', 'fact', ?, ?, 'return', ?, ?, ?, ?)`,
  formatDocNumber('receipt', n), issue.posted_by ?? pending[0].issued_by, issueDocId, pending[0].warehouse_id,
  `Возврат по ${issue.number}`, 'Сформирован автоматически по возврату ТМЦ');
  const docId = r.lastInsertRowId;
  for (const c of pending) {
    const accept = CONDITION_NOT_ACCEPTED.includes(c.return_condition) ? 0 : 1;
    await db.runAsync(`INSERT INTO doc_lines(doc_id, item_id, qty, custody_id, condition, note, accept)
      VALUES(?, ?, ?, ?, ?, ?, ?)`, docId, c.item_id, c.qty, c.id, c.return_condition, c.return_comment, accept);
    await db.runAsync('UPDATE custody SET return_doc_id = ? WHERE id = ?', docId, c.id);
  }
  return docId;
}

export const documents = {
  async list(ctx: Ctx, f: { type?: DocType; status?: 'draft' | 'posted'; source?: string } = {}) {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (f.type) { where.push('d.type = ?'); args.push(f.type); }
    if (f.status) { where.push('d.status = ?'); args.push(f.status); }
    if (f.source) { where.push('d.source = ?'); args.push(f.source); }
    if (!can.operate(ctx.user.role)) { where.push('d.created_by = ?'); args.push(ctx.user.id); }
    return ctx.db.getAllAsync<DocumentRow>(
      `${DOC_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY d.id DESC LIMIT 500`, ...args);
  },

  async get(ctx: Ctx, id: number) {
    const d = await getDocRaw(ctx.db, id);
    if (!can.operate(ctx.user.role) && d.created_by !== ctx.user.id && !(await canPostReturn(ctx, d))) deny('просмотр документа');
    return d;
  },

  lines: (ctx: Ctx, docId: number) =>
    ctx.db.getAllAsync<DocLine>(`
      SELECT l.*, i.sku, i.name AS item_name, i.unit, i.barcode, b.code AS box_code, k.code AS custody_code,
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
      LEFT JOIN custody k ON k.id = l.custody_id
      WHERE l.doc_id = ?
      ORDER BY w.code, r.code, c.code, b.code, l.id`, docId),

  async create(ctx: Ctx, type: DocType, mode: DocMode, opts: { warehouseId?: number | null; source?: string } = {}) {
    if (type === 'issue') need(ctx, can.takeForSelf, 'оформление расхода');
    else need(ctx, can.operate);
    const n = await nextSeq(ctx.db, `seq_${type}`);
    const r = await ctx.db.runAsync(
      'INSERT INTO documents(type, mode, number, created_by, warehouse_id, source) VALUES(?, ?, ?, ?, ?, ?)',
      type, mode, formatDocNumber(type, n), ctx.user.id, opts.warehouseId ?? null, opts.source ?? 'manual');
    return r.lastInsertRowId;
  },

  async updateHeader(ctx: Ctx, id: number, h: { partner?: string; recipient?: string; comment?: string; warehouseId?: number | null }) {
    await assertCanEdit(ctx, id);
    await ctx.db.runAsync(`UPDATE documents SET partner = ?, recipient = ?, comment = ?,
      warehouse_id = COALESCE(?, warehouse_id) WHERE id = ?`,
    emptyToNull(h.partner), emptyToNull(h.recipient), emptyToNull(h.comment), h.warehouseId ?? null, id);
  },

  async remove(ctx: Ctx, id: number) {
    const d = await assertCanEdit(ctx, id);
    if (d.source === 'return') {
      await ctx.db.runAsync('UPDATE custody SET return_doc_id = NULL WHERE return_doc_id = ?', id);
    }
    await ctx.db.runAsync('DELETE FROM documents WHERE id = ?', id);
  },

  /**
   * Добавить строку. Для прихода место можно не указывать — товар попадёт в
   * буферную ячейку склада. Одинаковые товар + место сворачиваются в одну строку.
   */
  async addLine(ctx: Ctx, docId: number, line: { itemId: number; qty: number; cellId?: number | null; boxId?: number | null }) {
    const d = await assertCanEdit(ctx, docId);
    if (!(line.qty > 0)) throw new BusinessError('Количество должно быть больше нуля');
    if (d.source === 'return') throw new BusinessError('Строки возвратного прихода формируются из возвратов');
    const cellId = line.boxId ? null : line.cellId ?? null;
    const boxId = line.boxId ?? null;
    if (d.type === 'issue' && !cellId && !boxId) throw new BusinessError('Укажите, откуда берётся товар');
    const existing = await ctx.db.getFirstAsync<{ id: number }>(`
      SELECT id FROM doc_lines WHERE doc_id = ? AND item_id = ? AND IFNULL(cell_id, 0) = ? AND IFNULL(box_id, 0) = ?`,
    docId, line.itemId, cellId ?? 0, boxId ?? 0);
    if (existing) {
      await ctx.db.runAsync('UPDATE doc_lines SET qty = round(qty + ?, 3) WHERE id = ?', line.qty, existing.id);
      return existing.id;
    }
    const r = await ctx.db.runAsync('INSERT INTO doc_lines(doc_id, item_id, qty, cell_id, box_id) VALUES(?, ?, ?, ?, ?)',
      docId, line.itemId, round3(line.qty), cellId, boxId);
    return r.lastInsertRowId;
  },

  /** Приход по ШК: найти товар по штрихкоду / артикулу и добавить qty штук (несколько штук по одному ШК). */
  async addLineByCode(ctx: Ctx, docId: number, code: string, qty: number, place?: { cellId?: number | null; boxId?: number | null }) {
    const item = await findItemByCode(ctx.db, code);
    if (!item) throw new BusinessError(`Товар с кодом ${code} не найден в номенклатуре`, 'not_found');
    await documents.addLine(ctx, docId, { itemId: item.id, qty, ...(place ?? {}) });
    return item;
  },

  async updateLine(ctx: Ctx, lineId: number, patch: { qty?: number; place?: Place | null; note?: string; condition?: ReturnCondition }) {
    const l = await ctx.db.getFirstAsync<{ doc_id: number }>('SELECT doc_id FROM doc_lines WHERE id = ?', lineId);
    if (!l) return;
    const d = await getDocRaw(ctx.db, l.doc_id);
    if (d.source === 'return') {
      if (d.status !== 'draft') throw new BusinessError('Документ проведён');
      if (!(await canPostReturn(ctx, d))) deny('изменение возврата');
    } else await assertCanEdit(ctx, l.doc_id);
    if (patch.qty !== undefined) {
      if (!(patch.qty > 0)) throw new BusinessError('Количество должно быть больше нуля');
      if (d.source === 'return') throw new BusinessError('Количество возврата менять нельзя');
      await ctx.db.runAsync('UPDATE doc_lines SET qty = ? WHERE id = ?', round3(patch.qty), lineId);
    }
    if (patch.place !== undefined) {
      await ctx.db.runAsync('UPDATE doc_lines SET cell_id = ?, box_id = ? WHERE id = ?',
        patch.place?.boxId ? null : patch.place?.cellId ?? null, patch.place?.boxId ?? null, lineId);
    }
    if (patch.note !== undefined) await ctx.db.runAsync('UPDATE doc_lines SET note = ? WHERE id = ?', emptyToNull(patch.note), lineId);
    if (patch.condition) {
      await ctx.db.runAsync('UPDATE doc_lines SET condition = ?, accept = ? WHERE id = ?',
        patch.condition, CONDITION_NOT_ACCEPTED.includes(patch.condition) ? 0 : 1, lineId);
    }
  },

  async deleteLine(ctx: Ctx, lineId: number) {
    const l = await ctx.db.getFirstAsync<{ doc_id: number }>('SELECT doc_id FROM doc_lines WHERE id = ?', lineId);
    if (!l) return;
    const d = await assertCanEdit(ctx, l.doc_id);
    if (d.source === 'return') throw new BusinessError('Строки возврата удалять нельзя');
    await ctx.db.runAsync('DELETE FROM doc_lines WHERE id = ?', lineId);
  },

  /** Расход по заявке: места отбора подбираются по FIFO (по дате приёмки). */
  async addIssueLineAuto(ctx: Ctx, docId: number, itemId: number, qty: number) {
    const d = await assertCanEdit(ctx, docId);
    const sources = await ctx.db.getAllAsync<AllocSource>(`
      SELECT s.item_id, s.cell_id, s.box_id, SUM(s.qty) AS qty, MIN(s.received_at) AS first_in_at FROM stock s
      LEFT JOIN boxes b ON b.id = s.box_id
      LEFT JOIN cells c ON c.id = COALESCE(s.cell_id, b.cell_id)
      LEFT JOIN racks r ON r.id = c.rack_id
      WHERE s.item_id = ? AND s.qty > 0 AND (? = 0 OR r.warehouse_id = ?)
      GROUP BY s.item_id, s.cell_id, s.box_id`, itemId, d.warehouse_id ?? 0, d.warehouse_id ?? 0);
    const lines = await ctx.db.getAllAsync<{ cell_id: number | null; box_id: number | null; qty: number }>(
      'SELECT cell_id, box_id, qty FROM doc_lines WHERE doc_id = ? AND item_id = ?', docId, itemId);
    const reserved = new Map<string, number>();
    for (const l of lines) {
      const k = placeKey(l.cell_id, l.box_id);
      reserved.set(k, (reserved.get(k) ?? 0) + l.qty);
    }
    const res = allocate(sources, qty, reserved);
    await inTransaction(ctx.db, async (t) => {
      const tctx = { ...ctx, db: t };
      for (const p of res.picks) await documents.addLine(tctx, docId, { itemId, qty: p.qty, cellId: p.cell_id, boxId: p.box_id });
    });
    return res;
  },

  /**
   * Приходный ордер из Excel (Артикул, Название, ШК, Количество).
   * Неизвестные товары заводятся в номенклатуру. Без места хранения —
   * после проведения товар окажется в буферной ячейке склада.
   */
  async createReceiptFromRows(ctx: Ctx, warehouseId: number, rows: ImportRow[], comment?: string) {
    need(ctx, can.operate);
    if (!rows.length) throw new BusinessError('Файл пуст');
    const errors: string[] = [];
    let docId = 0;
    await inTransaction(ctx.db, async (t) => {
      const n = await nextSeq(t, 'seq_receipt');
      docId = (await t.runAsync(`INSERT INTO documents(type, mode, number, created_by, warehouse_id, source, comment)
        VALUES('receipt', 'plan', ?, ?, ?, 'excel', ?)`,
      formatDocNumber('receipt', n), ctx.user.id, warehouseId, emptyToNull(comment) ?? 'Загружен из Excel')).lastInsertRowId;
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const qty = Number(row.qty ?? 0);
        if (!(qty > 0)) { errors.push(`Строка ${i + 2}: не указано количество`); continue; }
        if (!row.sku?.toString().trim() && !row.barcode?.toString().trim()) { errors.push(`Строка ${i + 2}: не указан артикул`); continue; }
        try {
          await items.upsertForReceipt(t, row);
          const item = await findItemByCode(t, (row.sku || row.barcode || '').toString());
          if (!item) throw new BusinessError('товар не найден');
          await t.runAsync(`INSERT INTO doc_lines(doc_id, item_id, qty) VALUES(?, ?, ?)`, docId, item.id, round3(qty));
        } catch (e) {
          errors.push(`Строка ${i + 2}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    });
    return { docId, errors };
  },

  // ---------------------------------------------------------------- распределение по получателям

  allocations: (ctx: Ctx, docId: number) =>
    ctx.db.getAllAsync<Allocation & { user_name: string; role: Role; item_name: string; unit: string }>(`
      SELECT a.item_id, a.user_id, a.qty, u.full_name AS user_name, u.role, i.name AS item_name, i.unit
      FROM issue_allocations a JOIN users u ON u.id = a.user_id JOIN items i ON i.id = a.item_id
      WHERE a.doc_id = ? ORDER BY u.full_name, i.name`, docId),

  async setAllocations(ctx: Ctx, docId: number, list: Allocation[]) {
    const d = await assertCanEdit(ctx, docId);
    if (d.type !== 'issue') throw new BusinessError('Получатели указываются только в расходном ордере');
    await inTransaction(ctx.db, async (t) => {
      await t.runAsync('DELETE FROM issue_allocations WHERE doc_id = ?', docId);
      for (const a of list) {
        if (!(a.qty > 0)) continue;
        await t.runAsync(`INSERT INTO issue_allocations(doc_id, item_id, user_id, qty) VALUES(?, ?, ?, ?)
          ON CONFLICT(doc_id, item_id, user_id) DO UPDATE SET qty = round(qty + excluded.qty, 3)`,
        docId, a.item_id, a.user_id, round3(a.qty));
      }
    });
  },

  // ---------------------------------------------------------------- проведение

  /** Провести приходный ордер (в т.ч. возвратный). */
  async postReceipt(ctx: Ctx, docId: number) {
    const db = ctx.db;
    const d = await getDocRaw(db, docId);
    if (d.type !== 'receipt') throw new BusinessError('Это не приходный ордер');
    if (d.status !== 'draft') throw new BusinessError('Документ уже проведён');
    if (d.source === 'return') {
      if (!(await canPostReturn(ctx, d))) deny('проведение возврата: провести может выдавший ТМЦ или его руководитель');
    } else need(ctx, can.operate);
    await inTransaction(db, async (t) => {
      const lines = await t.getAllAsync<{ id: number; item_id: number; qty: number; cell_id: number | null;
        box_id: number | null; accept: number; custody_id: number | null; condition: ReturnCondition | null }>(
        'SELECT id, item_id, qty, cell_id, box_id, accept, custody_id, condition FROM doc_lines WHERE doc_id = ?', docId);
      if (!lines.length) throw new BusinessError('В документе нет строк');
      let buffer: number | null = null;
      for (const l of lines) {
        if (l.custody_id) {
          const status = l.accept ? 'closed' : l.condition === 'lost' ? 'lost' : 'written_off';
          await t.runAsync('UPDATE custody SET status = ? WHERE id = ?', status, l.custody_id);
        }
        if (!l.accept) continue;
        let place: Place;
        if (l.cell_id || l.box_id) place = placeOf(l.cell_id, l.box_id);
        else {
          if (!d.warehouse_id) throw new BusinessError('Укажите склад или место хранения для строк без адреса');
          buffer ??= await ensureBufferCell(t, d.warehouse_id);
          place = { cellId: buffer };
          await t.runAsync('UPDATE doc_lines SET cell_id = ? WHERE id = ?', buffer, l.id);
        }
        const lots = await changeStock(t, l.item_id, place, l.qty, today());
        const holder = l.custody_id
          ? (await t.getFirstAsync<{ h: number }>('SELECT holder_id AS h FROM custody WHERE id = ?', l.custody_id))?.h
          : null;
        await writeMove(t, {
          docId, itemId: l.item_id, boxId: place.boxId ?? null, cellId: await cellOfPlace(t, place.cellId ?? null, place.boxId ?? null),
          qty: l.qty, userId: ctx.user.id, kind: d.source === 'return' ? 'return_in' : 'receipt',
          receivedAt: lots[0].received_at, holderId: holder,
        });
      }
      await markPosted(t, docId, ctx.user.id);
    });
  },

  /**
   * Провести расходный ордер.
   *  «Списать» — товар уходит из базы;
   *  «Выдать»  — товар передаётся под ответственность получателей (custody),
   *             каждому — свой инвентарный QR.
   */
  async postIssue(ctx: Ctx, docId: number, mode: PostMode) {
    const db = ctx.db;
    const d = await getDocRaw(db, docId);
    if (d.type !== 'issue') throw new BusinessError('Это не расходный ордер');
    if (d.status !== 'draft') throw new BusinessError('Документ уже проведён');
    const role = ctx.user.role;
    if (mode === 'writeoff') need(ctx, can.operate, 'списание');
    else {
      need(ctx, can.takeForSelf, 'выдачу');
      if (!(await custodyEnabled(db))) throw new BusinessError('Выдача ТМЦ под ответственность выключена в настройках');
    }
    if (!can.operate(role) && d.created_by !== ctx.user.id) deny('проведение чужого документа');

    await inTransaction(db, async (t) => {
      const lines = await t.getAllAsync<{ item_id: number; qty: number; cell_id: number | null; box_id: number | null }>(
        'SELECT item_id, qty, cell_id, box_id FROM doc_lines WHERE doc_id = ?', docId);
      if (!lines.length) throw new BusinessError('В документе нет строк');

      // --- получатели
      let allocs: Allocation[] = [];
      let recipientText = d.recipient;
      if (mode === 'custody') {
        allocs = await t.getAllAsync<Allocation>('SELECT item_id, user_id, qty FROM issue_allocations WHERE doc_id = ?', docId);
        if (!allocs.length && rank(role) <= ROLE_RANK.employee) {
          allocs = lines.map((l) => ({ item_id: l.item_id, user_id: ctx.user.id, qty: l.qty }));
        }
        if (!allocs.length) throw new BusinessError('Укажите, кому выдаются ТМЦ');
        const byItem = new Map<number, number>();
        for (const l of lines) byItem.set(l.item_id, round3((byItem.get(l.item_id) ?? 0) + l.qty));
        const allocByItem = new Map<number, number>();
        for (const a of allocs) allocByItem.set(a.item_id, round3((allocByItem.get(a.item_id) ?? 0) + a.qty));
        for (const [itemId, qty] of byItem) {
          if ((allocByItem.get(itemId) ?? 0) !== qty) {
            const it = await t.getFirstAsync<{ name: string }>('SELECT name FROM items WHERE id = ?', itemId);
            throw new BusinessError(`«${it?.name}»: в ордере ${qty}, распределено ${allocByItem.get(itemId) ?? 0}`);
          }
        }
        for (const id of allocByItem.keys()) if (!byItem.has(id)) throw new BusinessError('Распределён товар, которого нет в ордере');
        const names: string[] = [];
        for (const uid of new Set(allocs.map((a) => a.user_id))) {
          const u = await t.getFirstAsync<{ full_name: string; role: Role; active: number }>(
            'SELECT full_name, role, active FROM users WHERE id = ?', uid);
          if (!u || !u.active) throw new BusinessError('Получатель не найден или заблокирован');
          if (!can.issueTo(role, u.role, uid === ctx.user.id)) {
            throw new BusinessError(`Нельзя выдать ТМЦ пользователю ${u.full_name}: его роль не ниже вашей`);
          }
          names.push(u.full_name);
        }
        recipientText = names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')} и ещё ${names.length - 3}`;
      }

      // --- расход со склада
      let warehouseId: number | null = d.warehouse_id;
      for (const l of lines) {
        const place = placeOf(l.cell_id, l.box_id);
        const cellId = await cellOfPlace(t, l.cell_id, l.box_id);
        warehouseId ??= await warehouseOfCell(t, cellId);
        const lots = await changeStock(t, l.item_id, place, -l.qty);
        for (const lot of lots) {
          await writeMove(t, {
            docId, itemId: l.item_id, boxId: l.box_id, cellId, qty: -lot.qty, userId: ctx.user.id,
            kind: mode === 'writeoff' ? 'writeoff' : 'custody_out', receivedAt: lot.received_at, recipient: recipientText,
          });
        }
      }

      // --- ТМЦ на руки
      if (mode === 'custody') {
        for (const a of allocs) {
          const it = await t.getFirstAsync<{ track_units: number }>('SELECT track_units FROM items WHERE id = ?', a.item_id);
          const perUnit = !!it?.track_units && Number.isInteger(a.qty) && a.qty <= 500;
          const parts = perUnit ? Array.from({ length: a.qty }, () => 1) : [a.qty];
          for (const q of parts) {
            const code = formatCustodyCode(await nextSeq(t, 'seq_custody'));
            await t.runAsync(`INSERT INTO custody(code, item_id, qty, holder_id, issued_by, issue_doc_id, warehouse_id)
              VALUES(?, ?, ?, ?, ?, ?, ?)`, code, a.item_id, q, a.user_id, ctx.user.id, docId, warehouseId);
          }
        }
      }
      await t.runAsync('UPDATE documents SET recipient = ?, warehouse_id = COALESCE(warehouse_id, ?) WHERE id = ?',
        recipientText, warehouseId, docId);
      await markPosted(t, docId, ctx.user.id, mode);
    });
  },

  /** Отмена проведения (как в 1С): остатки возвращаются, движения удаляются. */
  async unpost(ctx: Ctx, docId: number) {
    const db = ctx.db;
    const d = await getDocRaw(db, docId);
    if (d.status !== 'posted') throw new BusinessError('Документ не проведён');
    if (d.type === 'move') throw new BusinessError('Перемещение отменяется обратным перемещением');
    if (d.source === 'return') {
      if (!(await canPostReturn(ctx, d))) deny('отмену проведения возврата');
    } else need(ctx, can.operate);
    await inTransaction(db, async (t) => {
      if (d.type === 'issue' && d.post_mode === 'custody') {
        const moved = await t.getFirstAsync<{ n: number }>(
          "SELECT COUNT(*) AS n FROM custody WHERE issue_doc_id = ? AND status <> 'held'", docId);
        if (moved && moved.n > 0) throw new BusinessError('По выдаче уже есть возвраты — отмена невозможна');
        await t.runAsync('DELETE FROM custody WHERE issue_doc_id = ?', docId);
      }
      if (d.source === 'return') {
        await t.runAsync("UPDATE custody SET status = 'returned' WHERE return_doc_id = ?", docId);
      }
      const moves = await t.getAllAsync<{ item_id: number; qty: number; cell_id: number | null; box_id: number | null; received_at: string | null }>(
        'SELECT item_id, qty, cell_id, box_id, received_at FROM moves WHERE doc_id = ?', docId);
      for (const m of moves) {
        const place: Place = m.box_id ? { boxId: m.box_id } : { cellId: m.cell_id! };
        await changeStock(t, m.item_id, place, -m.qty, m.received_at);
      }
      await t.runAsync('DELETE FROM moves WHERE doc_id = ?', docId);
      await t.runAsync("UPDATE documents SET status = 'draft', posted_by = NULL, posted_at = NULL, post_mode = NULL WHERE id = ?", docId);
    });
  },

  /**
   * Перемещение товара между местами хранения, в т.ч. части количества
   * по одному ШК. Партии (дата приёмки) сохраняются. Документ «ПМ» проводится сразу.
   */
  async moveStock(ctx: Ctx, m: { itemId: number; from: Place; to: Place; qty: number; receivedAt?: string | null }) {
    need(ctx, can.operate, 'перемещение');
    if (!(m.qty > 0)) throw new BusinessError('Количество должно быть больше нуля');
    const db = ctx.db;
    const fromKey = placeKey(m.from.cellId ?? null, m.from.boxId ?? null);
    const toKey = placeKey(m.to.cellId ?? null, m.to.boxId ?? null);
    if (fromKey === toKey) throw new BusinessError('Место назначения совпадает с исходным');
    const n = await nextSeq(db, 'seq_move');
    let docId = 0;
    await inTransaction(db, async (t) => {
      docId = (await t.runAsync(`INSERT INTO documents(type, mode, number, status, created_by, posted_by, posted_at)
        VALUES('move', 'fact', ?, 'posted', ?, ?, datetime('now','localtime'))`,
      formatDocNumber('move', n), ctx.user.id, ctx.user.id)).lastInsertRowId;
      const fromCell = await cellOfPlace(t, m.from.cellId ?? null, m.from.boxId ?? null);
      const toCell = await cellOfPlace(t, m.to.cellId ?? null, m.to.boxId ?? null);
      const lots = await changeStock(t, m.itemId, m.from, -m.qty, m.receivedAt);
      for (const lot of lots) {
        await changeStock(t, m.itemId, m.to, lot.qty, lot.received_at);
        await t.runAsync(`INSERT INTO doc_lines(doc_id, item_id, qty, cell_id, box_id, to_cell_id, to_box_id, received_at)
          VALUES(?, ?, ?, ?, ?, ?, ?, ?)`, docId, m.itemId, lot.qty, m.from.boxId ? null : m.from.cellId ?? null,
        m.from.boxId ?? null, toCell, m.to.boxId ?? null, lot.received_at);
        await writeMove(t, { docId, itemId: m.itemId, boxId: m.from.boxId ?? null, cellId: fromCell, qty: -lot.qty,
          userId: ctx.user.id, kind: 'move', receivedAt: lot.received_at });
        await writeMove(t, { docId, itemId: m.itemId, boxId: m.to.boxId ?? null, cellId: toCell, qty: lot.qty,
          userId: ctx.user.id, kind: 'move', receivedAt: lot.received_at });
      }
    });
    return docId;
  },
};
