import { need, type Ctx } from '../ctx';
import { BusinessError, fold, inTransaction, likeFold, type DB } from '../db';
import {
  KIND_TITLE, normalizeRecord, type Contract, type Counterparty, type Organization, type RefKind, type RefRecord,
} from '../refs';
import { can } from '../roles';

/**
 * Справочники: свои организации, контрагенты (юр. / физ. лица), договоры.
 * Читать могут кладовщик и выше (нужны для УПД), изменять — руководитель и администратор.
 */
function check(kind: RefKind, input: RefRecord) {
  const { value, errors } = normalizeRecord(kind, input);
  if (errors.length) throw new BusinessError(`${KIND_TITLE[kind]}: ${errors.join('; ')}`);
  return value;
}

/** Вставить / обновить запись; набор колонок берётся из описания полей, не из данных. */
async function upsert(db: DB, table: string, id: number | undefined, value: RefRecord, extra: RefRecord = {}) {
  const row = { ...value, ...extra };
  const cols = Object.keys(row);
  if (id) {
    await db.runAsync(`UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, ...cols.map((c) => row[c] ?? null), id);
    return id;
  }
  const r = await db.runAsync(`INSERT INTO ${table}(${cols.join(', ')}) VALUES(${cols.map(() => '?').join(', ')})`, ...cols.map((c) => row[c] ?? null));
  return r.lastInsertRowId;
}

const CONTRACT_SELECT = `
  SELECT c.*, o.name AS org_name, p.name AS party_name, p.kind AS party_kind
  FROM contracts c
  LEFT JOIN organizations o ON o.id = c.org_id
  LEFT JOIN counterparties p ON p.id = c.counterparty_id`;

export const refs = {
  // ---------------------------------------------------------------- свои организации

  listOrgs(ctx: Ctx) {
    need(ctx, can.operate, 'справочник');
    return ctx.db.getAllAsync<Organization>('SELECT * FROM organizations ORDER BY is_default DESC, name');
  },

  getOrg(ctx: Ctx, id: number) {
    need(ctx, can.operate, 'справочник');
    return ctx.db.getFirstAsync<Organization>('SELECT * FROM organizations WHERE id = ?', id);
  },

  /** Организация по умолчанию — продавец в УПД, наша сторона в договорах. */
  async defaultOrg(ctx: Ctx) {
    need(ctx, can.operate, 'справочник');
    return ctx.db.getFirstAsync<Organization>('SELECT * FROM organizations ORDER BY is_default DESC, id LIMIT 1');
  },

  async saveOrg(ctx: Ctx, input: RefRecord & { is_default?: number | boolean }) {
    need(ctx, can.manageItems, 'справочник (руководитель, администратор)');
    const value = check('org', input);
    let id = 0;
    await inTransaction(ctx.db, async (t) => {
      const first = !(await t.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM organizations'))?.n;
      const makeDefault = first || !!input.is_default;
      if (makeDefault) await t.runAsync('UPDATE organizations SET is_default = 0');
      id = await upsert(t, 'organizations', input.id, value, makeDefault ? { is_default: 1 } : {});
    });
    return id;
  },

  async deleteOrg(ctx: Ctx, id: number) {
    need(ctx, can.manageItems, 'справочник (руководитель, администратор)');
    const used = await ctx.db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM contracts WHERE org_id = ?', id);
    if (used?.n) throw new BusinessError(`Организация указана в договорах (${used.n}) — сначала измените или удалите их`);
    await ctx.db.runAsync('DELETE FROM organizations WHERE id = ?', id);
  },

  // ---------------------------------------------------------------- контрагенты

  listParties(ctx: Ctx, kind?: 'legal' | 'person' | null, search = '') {
    need(ctx, can.operate, 'справочник');
    const q = search.trim();
    return ctx.db.getAllAsync<Counterparty>(`
      SELECT * FROM counterparties
      WHERE (? = '' OR kind = ?) AND (? = '' OR search_name LIKE ? OR IFNULL(inn, '') LIKE ?)
      ORDER BY name LIMIT 500`, kind ?? '', kind ?? '', q, likeFold(q), `%${q}%`);
  },

  getParty(ctx: Ctx, id: number) {
    need(ctx, can.operate, 'справочник');
    return ctx.db.getFirstAsync<Counterparty>('SELECT * FROM counterparties WHERE id = ?', id);
  },

  async saveParty(ctx: Ctx, kind: 'legal' | 'person', input: RefRecord) {
    need(ctx, can.manageItems, 'справочник (руководитель, администратор)');
    const value = check(kind, input);
    if (input.id) {
      const cur = await ctx.db.getFirstAsync<{ kind: string }>('SELECT kind FROM counterparties WHERE id = ?', input.id);
      if (!cur) throw new BusinessError('Контрагент не найден');
      if (cur.kind !== kind) throw new BusinessError('Нельзя сменить вид контрагента (юр. / физ. лицо)');
    }
    const inn = value.inn as string | null;
    if (inn) {
      const dup = await ctx.db.getFirstAsync<{ name: string }>('SELECT name FROM counterparties WHERE inn = ? AND id <> ?', inn, input.id ?? 0);
      if (dup && !value.kpp) throw new BusinessError(`ИНН ${inn} уже есть в справочнике: ${dup.name}`);
    }
    return upsert(ctx.db, 'counterparties', input.id, value, { kind, search_name: fold(`${value.name ?? ''} ${value.short_name ?? ''}`) });
  },

  async deleteParty(ctx: Ctx, id: number) {
    need(ctx, can.manageItems, 'справочник (руководитель, администратор)');
    const used = await ctx.db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM contracts WHERE counterparty_id = ?', id);
    if (used?.n) throw new BusinessError(`Контрагент — сторона договоров (${used.n}) — сначала измените или удалите их`);
    await ctx.db.runAsync('DELETE FROM counterparties WHERE id = ?', id);
  },

  // ---------------------------------------------------------------- договоры

  listContracts(ctx: Ctx, f: { counterpartyId?: number | null; search?: string } = {}) {
    need(ctx, can.operate, 'справочник');
    const q = (f.search ?? '').trim();
    return ctx.db.getAllAsync<Contract>(`${CONTRACT_SELECT}
      WHERE (? = 0 OR c.counterparty_id = ?)
        AND (? = '' OR c.number LIKE ? OR IFNULL(p.search_name, '') LIKE ? OR IFNULL(c.title, '') LIKE ?)
      ORDER BY c.date DESC, c.id DESC LIMIT 500`,
    f.counterpartyId ?? 0, f.counterpartyId ?? 0, q, `%${q}%`, likeFold(q), `%${q}%`);
  },

  getContract(ctx: Ctx, id: number) {
    need(ctx, can.operate, 'справочник');
    return ctx.db.getFirstAsync<Contract>(`${CONTRACT_SELECT} WHERE c.id = ?`, id);
  },

  async saveContract(ctx: Ctx, input: RefRecord & { org_id?: number | null; counterparty_id?: number | null }) {
    need(ctx, can.manageItems, 'справочник (руководитель, администратор)');
    const value = check('contract', input);
    const orgId = input.org_id ?? null;
    const partyId = input.counterparty_id ?? null;
    if (!orgId) throw new BusinessError('Договор: выберите нашу организацию (сторону договора)');
    if (!partyId) throw new BusinessError('Договор: выберите контрагента (юр. или физ. лицо)');
    if (!(await ctx.db.getFirstAsync('SELECT id FROM organizations WHERE id = ?', orgId))) throw new BusinessError('Организация не найдена');
    if (!(await ctx.db.getFirstAsync('SELECT id FROM counterparties WHERE id = ?', partyId))) throw new BusinessError('Контрагент не найден');
    if (value.valid_until && value.date && String(value.valid_until) < String(value.date)) {
      throw new BusinessError('Договор: «действует до» раньше даты договора');
    }
    return upsert(ctx.db, 'contracts', input.id, value, { org_id: orgId, counterparty_id: partyId });
  },

  async deleteContract(ctx: Ctx, id: number) {
    need(ctx, can.manageItems, 'справочник (руководитель, администратор)');
    await ctx.db.runAsync('DELETE FROM contracts WHERE id = ?', id);
  },
};

