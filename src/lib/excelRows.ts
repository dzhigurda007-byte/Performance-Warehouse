import type { ImportRow } from '../core/services/items';

export type Cell = string | number | boolean | Date | null | unknown;

/** items — номенклатура (Артикул, Название, ШК); receipt — приходный ордер (Артикул, Наименование, Количество). */
export type ExcelKind = 'items' | 'receipt';

const HEADERS: Record<keyof ImportRow, RegExp> = {
  sku: /^(артикул|арт\.?|sku|код товара)$/i,
  name: /^(название|наименование|name|товар)$/i,
  barcode: /^(шк|штрих-?код|штрихкод|barcode|ean)$/i,
  group: /^(группа|категория|вид|group)$/i,
  qty: /^(количество|кол-?во|qty|кол)$/i,
};

/** Порядок столбцов, если в файле нет строки заголовков. */
const DEFAULT_COLS: Record<ExcelKind, Partial<Record<keyof ImportRow, number>>> = {
  items: { sku: 0, name: 1, barcode: 2, group: 3 },
  receipt: { sku: 0, name: 1, qty: 2 },
};

const text = (v: Cell) => (v === null || v === undefined ? '' : String(v).trim());

function toQty(v: Cell): number | null {
  const n = Number(text(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) && n !== 0 ? n : null;
}

/**
 * Строки листа → записи. Первая строка — заголовки (порядок столбцов любой):
 *  номенклатура — «Артикул», «Название», «ШК» [, «Группа»];
 *  приход       — «Артикул», «Наименование», «Количество».
 * Если заголовков нет — столбцы берутся по порядку, как перечислено выше.
 */
export function rowsFromSheet(sheet: Cell[][], kind: ExcelKind = 'items'): ImportRow[] {
  if (!sheet.length) return [];
  const header = sheet[0].map(text);
  const map: Partial<Record<keyof ImportRow, number>> = {};
  header.forEach((h, i) => {
    for (const [key, re] of Object.entries(HEADERS) as [keyof ImportRow, RegExp][]) if (re.test(h)) map[key] ??= i;
  });
  const hasHeader = Object.keys(map).length > 0;
  const cols = hasHeader ? map : DEFAULT_COLS[kind];
  // Заголовок количества назван иначе («Кол-во, шт» и т.п.) — берём третий столбец, если он свободен.
  if (hasHeader && kind === 'receipt' && cols.qty === undefined && !Object.values(cols).includes(2)) cols.qty = 2;
  const body = hasHeader ? sheet.slice(1) : sheet;
  return body
    .map((r) => ({
      sku: cols.sku !== undefined ? text(r[cols.sku]).replace(/\.0$/, '') : null,
      name: cols.name !== undefined ? text(r[cols.name]) : null,
      barcode: cols.barcode !== undefined ? text(r[cols.barcode]).replace(/\.0$/, '') || null : null,
      group: cols.group !== undefined ? text(r[cols.group]) || null : null,
      qty: cols.qty !== undefined ? toQty(r[cols.qty]) : null,
    }))
    .filter((r) => r.sku || r.name || r.barcode);
}
