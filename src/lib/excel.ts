import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { Platform } from 'react-native';
import { readSheet } from 'read-excel-file/universal';
import type { ImportRow } from '../core/services/items';

type Cell = string | number | boolean | Date | null | unknown;

const HEADERS: Record<keyof ImportRow, RegExp> = {
  sku: /^(артикул|арт\.?|sku|код товара)$/i,
  name: /^(название|наименование|name|товар)$/i,
  barcode: /^(шк|штрих-?код|штрихкод|barcode|ean)$/i,
  group: /^(группа|категория|вид|group)$/i,
  qty: /^(количество|кол-?во|qty|кол)$/i,
};

const text = (v: Cell) => (v === null || v === undefined ? '' : String(v).trim());

/**
 * Строки листа → записи номенклатуры. Первая строка — заголовки
 * («артикул», «Название», «ШК», необязательно «Группа», «Количество»).
 * Если заголовков нет — порядок столбцов: Артикул, Название, ШК, Количество.
 */
export function rowsFromSheet(sheet: Cell[][]): ImportRow[] {
  if (!sheet.length) return [];
  const header = sheet[0].map(text);
  const map: Partial<Record<keyof ImportRow, number>> = {};
  header.forEach((h, i) => {
    for (const [key, re] of Object.entries(HEADERS) as [keyof ImportRow, RegExp][]) if (re.test(h)) map[key] ??= i;
  });
  const hasHeader = map.sku !== undefined || map.name !== undefined || map.barcode !== undefined;
  const cols = hasHeader ? map : { sku: 0, name: 1, barcode: 2, qty: 3 };
  const body = hasHeader ? sheet.slice(1) : sheet;
  return body
    .map((r) => ({
      sku: cols.sku !== undefined ? text(r[cols.sku]) : null,
      name: cols.name !== undefined ? text(r[cols.name]) : null,
      barcode: cols.barcode !== undefined ? text(r[cols.barcode]).replace(/\.0$/, '') : null,
      group: cols.group !== undefined ? text(r[cols.group]) : null,
      qty: cols.qty !== undefined ? Number(String(r[cols.qty] ?? '').replace(',', '.')) || null : null,
    }))
    .filter((r) => r.sku || r.name || r.barcode);
}

/** Выбрать файл .xlsx и прочитать первый лист. */
export async function pickExcel(): Promise<{ name: string; rows: ImportRow[] } | null> {
  const res = await DocumentPicker.getDocumentAsync({
    type: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel', '*/*'],
    copyToCacheDirectory: true,
  });
  if (res.canceled || !res.assets?.length) return null;
  const asset = res.assets[0];
  if (!/\.xlsx$/i.test(asset.name)) throw new Error('Нужен файл Excel в формате .xlsx (Файл → Сохранить как → Книга Excel)');
  const buffer = Platform.OS === 'web' && asset.file ? await asset.file.arrayBuffer() : await new File(asset.uri).arrayBuffer();
  const sheet = (await readSheet(buffer)) as Cell[][];
  return { name: asset.name, rows: rowsFromSheet(sheet) };
}
