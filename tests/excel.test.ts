import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rowsFromSheet } from '../src/lib/excelRows';

test('приход из Excel: три столбца Артикул · Наименование · Количество', () => {
  const rows = rowsFromSheet([
    ['Артикул', 'Наименование', 'Количество'],
    ['HAMMER', 'Молоток', 4],
    [1001, 'Лопата', '2,5'],
    ['', '', ''],
  ], 'receipt');
  assert.deepEqual(rows.map((r) => [r.sku, r.name, r.barcode, r.qty]), [['HAMMER', 'Молоток', null, 4], ['1001', 'Лопата', null, 2.5]]);
  // без строки заголовков — по порядку столбцов
  assert.deepEqual(rowsFromSheet([['A-1', 'Перчатки', 10]], 'receipt').map((r) => [r.sku, r.qty]), [['A-1', 10]]);
  // количество названо иначе — берётся третий столбец
  assert.equal(rowsFromSheet([['Артикул', 'Наименование', 'Кол-во, шт'], ['A-1', 'Перчатки', 3]], 'receipt')[0].qty, 3);
});

test('номенклатура из Excel: Артикул · Название · ШК', () => {
  const rows = rowsFromSheet([['артикул', 'Название', 'ШК'], ['HAMMER', 'Молоток', 4601234567893]]);
  assert.deepEqual(rows.map((r) => [r.sku, r.name, r.barcode, r.qty]), [['HAMMER', 'Молоток', '4601234567893', null]]);
  assert.equal(rowsFromSheet([['A-1', 'Перчатки', '222']])[0].barcode, '222');
});
