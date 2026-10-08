import { need, type Ctx } from '../ctx';
import { can } from '../roles';

const TABLES: [string, string][] = [
  ['users', 'Пользователи'], ['warehouses', 'Склады'], ['racks', 'Стеллажи'], ['cells', 'Ячейки'], ['boxes', 'Короба'],
  ['items', 'Номенклатура'], ['stock', 'Партии на складе'], ['documents', 'Документы'], ['doc_lines', 'Строки документов'],
  ['moves', 'Движения'], ['custody', 'ТМЦ на руках'], ['organizations', 'Организации'], ['counterparties', 'Контрагенты'],
  ['contracts', 'Договоры'], ['upd_docs', 'УПД'], ['sessions', 'Сеансы входа'],
];

/** Раздел «Разработчик» (только администратор): сведения о базе данных. */
export const dev = {
  async info(ctx: Ctx) {
    need(ctx, can.develop, 'раздел «Разработчик» (только администратор)');
    const v = await ctx.db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    const pages = await ctx.db.getFirstAsync<{ page_count: number }>('PRAGMA page_count');
    const size = await ctx.db.getFirstAsync<{ page_size: number }>('PRAGMA page_size');
    const tables: { name: string; label: string; rows: number }[] = [];
    for (const [name, label] of TABLES) {
      const r = await ctx.db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${name}`).catch(() => null);
      if (r) tables.push({ name, label, rows: r.n });
    }
    return {
      schemaVersion: v?.user_version ?? 0,
      sizeBytes: (pages?.page_count ?? 0) * (size?.page_size ?? 0),
      tables,
    };
  },
};
