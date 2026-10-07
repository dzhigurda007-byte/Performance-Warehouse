import { need, type Ctx } from '../ctx';
import { BusinessError, emptyToNull, fold, inTransaction, likeFold, type DB } from '../db';
import { can } from '../roles';
import type { Item, ItemGroup } from '../types';

export type ItemListRow = Item & { total: number; group_name: string | null };

export interface ImportRow {
  sku?: string | null;
  name?: string | null;
  barcode?: string | null;
  group?: string | null;
  qty?: number | null;
}

export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
}

/** id группы и всех её подгрупп. */
async function groupWithChildren(db: DB, groupId: number): Promise<number[]> {
  const all = await db.getAllAsync<{ id: number; parent_id: number | null }>('SELECT id, parent_id FROM item_groups');
  const out = [groupId];
  for (let i = 0; i < out.length; i++) for (const g of all) if (g.parent_id === out[i]) out.push(g.id);
  return out;
}

/** Найти или создать группу по пути «Инструмент / Ручной». */
async function groupByPath(db: DB, path: string): Promise<number | null> {
  const parts = path.split('/').map((p) => p.trim()).filter(Boolean);
  let parent: number | null = null;
  for (const name of parts) {
    const found: { id: number } | null = await db.getFirstAsync(
      'SELECT id FROM item_groups WHERE name = ? COLLATE NOCASE AND IFNULL(parent_id, 0) = ?', name, parent ?? 0);
    if (found) parent = found.id;
    else parent = (await db.runAsync('INSERT INTO item_groups(name, parent_id) VALUES(?, ?)', name, parent)).lastInsertRowId;
  }
  return parent;
}

export async function findItemByCode(db: DB, code: string) {
  const v = code.trim();
  return db.getFirstAsync<Item>(
    'SELECT * FROM items WHERE deleted_at IS NULL AND (barcode = ? OR sku = ? COLLATE NOCASE) ORDER BY barcode = ? DESC LIMIT 1', v, v, v);
}

async function upsertItem(db: DB, row: ImportRow): Promise<'created' | 'updated' | 'skipped'> {
  const sku = (row.sku ?? '').toString().trim();
  const name = (row.name ?? '').toString().trim();
  const barcode = emptyToNull(row.barcode?.toString());
  if (!sku && !barcode) return 'skipped';
  const existing = sku
    ? await db.getFirstAsync<Item>('SELECT * FROM items WHERE sku = ? COLLATE NOCASE', sku)
    : await db.getFirstAsync<Item>('SELECT * FROM items WHERE barcode = ?', barcode);
  const groupId = row.group ? await groupByPath(db, row.group) : null;
  if (barcode) {
    const dup = await db.getFirstAsync<{ id: number; sku: string }>(
      'SELECT id, sku FROM items WHERE barcode = ? AND id <> ?', barcode, existing?.id ?? 0);
    if (dup) throw new BusinessError(`ШК ${barcode} уже назначен товару ${dup.sku}`);
  }
  if (existing) {
    await db.runAsync(`UPDATE items SET name = COALESCE(?, name), barcode = COALESCE(?, barcode),
      group_id = COALESCE(?, group_id), search_name = ? WHERE id = ?`, name || null, barcode, groupId,
    fold(`${name || existing.name} ${existing.sku}`), existing.id);
    return 'updated';
  }
  if (!name) throw new BusinessError(`Нет названия для ${sku || barcode}`);
  const newSku = sku || `ШК-${barcode}`;
  await db.runAsync('INSERT INTO items(sku, name, unit, barcode, group_id, search_name) VALUES(?, ?, ?, ?, ?, ?)',
    newSku, name, 'шт', barcode, groupId, fold(`${name} ${newSku}`));
  return 'created';
}

export const items = {
  async list(ctx: Ctx, search = '', groupId?: number | null) {
    const q = `%${search.trim()}%`;
    const groups = groupId ? await groupWithChildren(ctx.db, groupId) : [];
    return ctx.db.getAllAsync<ItemListRow>(`
      SELECT i.*, g.name AS group_name, (SELECT IFNULL(SUM(qty), 0) FROM stock s WHERE s.item_id = i.id) AS total
      FROM items i LEFT JOIN item_groups g ON g.id = i.group_id
      WHERE i.deleted_at IS NULL AND (? = '%%' OR i.search_name LIKE ? OR i.sku LIKE ? OR IFNULL(i.barcode, '') LIKE ?)
        ${groups.length ? `AND i.group_id IN (${groups.map(() => '?').join(',')})` : ''}
      ORDER BY i.name LIMIT 500`, q, likeFold(search), q, q, ...groups);
  },

  get: (ctx: Ctx, id: number) =>
    ctx.db.getFirstAsync<Item & { group_name: string | null }>(
      'SELECT i.*, g.name AS group_name FROM items i LEFT JOIN item_groups g ON g.id = i.group_id WHERE i.id = ?', id),

  async save(ctx: Ctx, it: Partial<Item> & { sku: string; name: string }) {
    need(ctx, can.manageItems, 'номенклатура (только руководитель и администратор)');
    const sku = it.sku.trim();
    const name = it.name.trim();
    if (!sku || !name) throw new BusinessError('Укажите артикул и наименование');
    if (/\s/.test(sku)) throw new BusinessError('Артикул не должен содержать пробелов');
    const barcode = emptyToNull(it.barcode);
    if (barcode) {
      const dup = await ctx.db.getFirstAsync<{ id: number }>(
        'SELECT id FROM items WHERE barcode = ? AND id <> ?', barcode, it.id ?? 0);
      if (dup) throw new BusinessError('Этот штрихкод уже назначен другому товару');
    }
    const unit = emptyToNull(it.unit) ?? 'шт';
    const price = it.price === undefined || it.price === null || (it.price as unknown) === '' ? null : Number(it.price);
    if (price !== null && !(Number.isFinite(price) && price >= 0)) throw new BusinessError('Цена — неотрицательное число');
    const args = [sku, name, unit, barcode, emptyToNull(it.description), it.group_id ?? null, it.track_units ? 1 : 0, fold(`${name} ${sku}`),
      price === null ? null : Math.round(price * 100) / 100];
    try {
      if (it.id) {
        await ctx.db.runAsync(`UPDATE items SET sku = ?, name = ?, unit = ?, barcode = ?, description = ?, group_id = ?,
          track_units = ?, search_name = ?, price = ? WHERE id = ?`, ...args, it.id);
        return it.id;
      }
      const r = await ctx.db.runAsync(`INSERT INTO items(sku, name, unit, barcode, description, group_id, track_units, search_name, price)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`, ...args);
      return r.lastInsertRowId;
    } catch (e) {
      if (String(e).includes('UNIQUE')) throw new BusinessError('Товар с таким артикулом уже существует');
      throw e;
    }
  },

  /**
   * Удалить товар из номенклатуры (руководитель, администратор).
   * Без истории — удаляется из базы полностью. С историей — убирается из номенклатуры и поиска,
   * а проведённые документы и движения сохраняются; артикул и ШК освобождаются для новых товаров.
   * Нельзя, пока товар есть на складе, на руках или в черновиках документов.
   */
  async remove(ctx: Ctx, id: number): Promise<'deleted' | 'archived'> {
    need(ctx, can.manageItems, 'номенклатура (только руководитель и администратор)');
    const it = await ctx.db.getFirstAsync<Item & { deleted_at: string | null }>('SELECT * FROM items WHERE id = ?', id);
    if (!it || it.deleted_at) return 'deleted';
    const stock = await ctx.db.getFirstAsync<{ q: number }>('SELECT IFNULL(SUM(qty), 0) AS q FROM stock WHERE item_id = ?', id);
    if ((stock?.q ?? 0) > 0) throw new BusinessError(`«${it.name}»: на складе числится ${stock!.q} ${it.unit} — сначала спишите или переместите остаток`);
    const held = await ctx.db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM custody WHERE item_id = ? AND status = 'held'", id);
    if ((held?.n ?? 0) > 0) throw new BusinessError(`«${it.name}»: числится на руках у сотрудников (${held!.n}) — сначала оформите возврат`);
    const drafts = await ctx.db.getAllAsync<{ number: string }>(`
      SELECT DISTINCT d.number FROM documents d
      WHERE d.status = 'draft' AND (EXISTS (SELECT 1 FROM doc_lines l WHERE l.doc_id = d.id AND l.item_id = ?)
        OR EXISTS (SELECT 1 FROM doc_plan p WHERE p.doc_id = d.id AND p.item_id = ?))`, id, id);
    if (drafts.length) throw new BusinessError(`«${it.name}» есть в черновиках: ${drafts.map((d) => d.number).join(', ')} — уберите его оттуда`);
    const used = await ctx.db.getFirstAsync<{ n: number }>(`SELECT (SELECT COUNT(*) FROM moves WHERE item_id = ?)
      + (SELECT COUNT(*) FROM doc_lines WHERE item_id = ?) + (SELECT COUNT(*) FROM custody WHERE item_id = ?)
      + (SELECT COUNT(*) FROM doc_plan WHERE item_id = ?) + (SELECT COUNT(*) FROM stock WHERE item_id = ?) AS n`, id, id, id, id, id);
    if (!used?.n) {
      await ctx.db.runAsync('DELETE FROM items WHERE id = ?', id);
      return 'deleted';
    }
    await ctx.db.runAsync(`UPDATE items SET deleted_at = datetime('now','localtime'), barcode = NULL,
      sku = sku || ' (удалён #' || id || ')', search_name = NULL WHERE id = ?`, id);
    return 'archived';
  },

  /** Удалить несколько товаров; ошибки по отдельным товарам не мешают остальным. */
  async removeMany(ctx: Ctx, ids: number[]) {
    need(ctx, can.manageItems, 'номенклатура (только руководитель и администратор)');
    const res = { deleted: 0, archived: 0, errors: [] as string[] };
    for (const id of ids) {
      try {
        const r = await items.remove(ctx, id);
        if (r === 'deleted') res.deleted++;
        else res.archived++;
      } catch (e) {
        res.errors.push(e instanceof Error ? e.message : String(e));
      }
    }
    return res;
  },

  async suggestSku(ctx: Ctx) {
    const n = await ctx.db.getFirstAsync<{ n: number }>('SELECT IFNULL(MAX(id), 0) + 1 AS n FROM items');
    return `TM-${String(n?.n ?? 1).padStart(5, '0')}`;
  },

  findByCode: (ctx: Ctx, code: string) => findItemByCode(ctx.db, code),

  /**
   * Загрузка номенклатуры из Excel: столбцы «Артикул», «Название», «ШК»
   * (+ необязательная «Группа» вида «Инструмент / Ручной»).
   * Существующие артикулы обновляются, новые создаются.
   */
  async importRows(ctx: Ctx, rows: ImportRow[]): Promise<ImportResult> {
    need(ctx, can.manageItems, 'номенклатура (только руководитель и администратор)');
    const res: ImportResult = { created: 0, updated: 0, skipped: 0, errors: [] };
    await inTransaction(ctx.db, async (t) => {
      for (let i = 0; i < rows.length; i++) {
        try {
          res[await upsertItem(t, rows[i])] += 1;
        } catch (e) {
          res.errors.push(`Строка ${i + 2}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    });
    return res;
  },

  // ---------------------------------------------------------------- группы

  listGroups: (ctx: Ctx) =>
    ctx.db.getAllAsync<ItemGroup>(`SELECT g.*, (SELECT COUNT(*) FROM items i WHERE i.group_id = g.id AND i.deleted_at IS NULL) AS items
      FROM item_groups g ORDER BY g.name`),

  async saveGroup(ctx: Ctx, g: { id?: number; name: string; parent_id?: number | null }) {
    need(ctx, can.manageItems, 'номенклатура (только руководитель и администратор)');
    const name = g.name.trim();
    if (!name) throw new BusinessError('Укажите название группы');
    if (g.id && g.parent_id) {
      const children = await groupWithChildren(ctx.db, g.id);
      if (children.includes(g.parent_id)) throw new BusinessError('Группа не может быть вложена сама в себя');
    }
    if (g.id) {
      await ctx.db.runAsync('UPDATE item_groups SET name = ?, parent_id = ? WHERE id = ?', name, g.parent_id ?? null, g.id);
      return g.id;
    }
    return (await ctx.db.runAsync('INSERT INTO item_groups(name, parent_id) VALUES(?, ?)', name, g.parent_id ?? null))
      .lastInsertRowId;
  },

  async deleteGroup(ctx: Ctx, id: number) {
    need(ctx, can.manageItems, 'номенклатура (только руководитель и администратор)');
    const ids = await groupWithChildren(ctx.db, id);
    await ctx.db.runAsync(`UPDATE items SET group_id = NULL WHERE group_id IN (${ids.map(() => '?').join(',')})`, ...ids);
    await ctx.db.runAsync('DELETE FROM item_groups WHERE id = ?', id);
  },

  /** Используется приходом из Excel. */
  upsertForReceipt: upsertItem,
};
