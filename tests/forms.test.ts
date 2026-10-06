import assert from 'node:assert/strict';
import { test } from 'node:test';
import { flattenTree, parseDateInput, parseQtyInput, stockTree } from '../src/core/stockTree';
import type { DocLine, DocumentRow, ItemGroup, StockReportRow } from '../src/core/types';
import { documentForm, stockReportForm } from '../src/lib/docForms';

const doc = (o: Partial<DocumentRow>): DocumentRow => ({
  id: 1, type: 'receipt', mode: 'fact', number: 'ПО-000012', doc_date: '2026-10-06 10:00:00', status: 'posted',
  partner: 'ООО Поставщик', recipient: null, comment: null, created_by: 1, created_by_name: 'Иванов И.И.',
  posted_by: 1, posted_by_name: 'Петров П.П.', posted_at: '2026-10-06 11:30:00', lines_count: 1, post_mode: null,
  source: 'manual', base_doc_id: null, base_doc_number: null, warehouse_id: 1, warehouse_name: 'Основной', plan_count: 0, ...o,
});
const line = (o: Partial<DocLine>): DocLine => ({
  id: 1, doc_id: 1, item_id: 1, sku: 'KOMB', item_name: 'Комбайн <Bosch>', unit: 'шт', barcode: null, qty: 3,
  cell_id: 1, box_id: null, box_code: null, to_cell_id: null, address: 'СК1 / A / A1', to_address: null,
  received_at: '2026-10-06', custody_id: null, custody_code: null, condition: null, note: null, accept: 1, ...o,
});

test('печатные формы: отдельный HTML-документ с реквизитами, таблицей и подписями', () => {
  const r = documentForm(doc({}), [line({})], { org: 'ООО «Склад»', printedBy: 'Петров', printedAt: '2026-10-06 12:00' });
  assert.equal(r.fileName, 'Приходный ордер ПО-000012');
  assert.match(r.html, /^<!doctype html>/);
  assert.match(r.html, /@page \{ size: A4/);
  assert.match(r.html, /ПРИХОДНЫЙ ОРДЕР № ПО-000012/);
  assert.match(r.html, /ООО «Склад»/);
  assert.match(r.html, /Комбайн &lt;Bosch&gt;/); // экранирование
  assert.match(r.html, /06\.10\.2026/);
  assert.match(r.html, /Принял \(кладовщик\)/);

  const i = documentForm(doc({ type: 'issue', number: 'РО-000003', status: 'draft', post_mode: null, recipient: 'Бригада 1' }), [line({})],
    {}, { allocations: [{ user_name: 'Сидоров', item_name: 'Лопата', qty: 1, unit: 'шт' }] });
  assert.match(i.html, /РАСХОДНЫЙ ОРДЕР № РО-000003/);
  assert.match(i.html, /Место хранения/);
  assert.match(i.html, /СК1 \/ A \/ A1/);
  assert.match(i.html, /Распределение по получателям/);
  assert.match(i.html, /Отпустил/);

  const m = documentForm(doc({ type: 'move', number: 'ПМ-1' }), [line({ to_address: 'СК1 / B / B1' })]);
  assert.match(m.html, /НАКЛАДНАЯ НА ПЕРЕМЕЩЕНИЕ/);
});

test('ведомость остатков по группам и разбор полей фильтра', () => {
  const groups: ItemGroup[] = [{ id: 1, name: 'Техника', parent_id: null, items: 0 }, { id: 2, name: 'Бытовая', parent_id: 1, items: 0 }];
  const rows = [{ id: 1, item_id: 7, sku: 'KOMB', item_name: 'Комбайн', unit: 'шт', qty: 2, first_in_at: '', received_at: '2026-10-01',
    is_buffer: 0, cell_id: 1, box_id: null, box_code: null, address: 'СК1 / A / A1', group_id: 2, warehouse_id: 1, barcode: null }] as StockReportRow[];
  const lines = flattenTree(stockTree(rows, groups));
  assert.deepEqual(lines.map((l) => (l.kind === 'group' ? `g:${l.node.name}` : `i:${l.node.sku}`)), ['g:Техника', 'g:Бытовая', 'i:KOMB']);
  const f = stockReportForm(lines, { withLots: true, filters: ['остаток от 1'] });
  assert.match(f.html, /ВЕДОМОСТЬ ОСТАТКОВ/);
  assert.match(f.html, /Бытовая/);
  assert.match(f.html, /СК1 \/ A \/ A1 — 2/);

  assert.equal(parseDateInput('5.10.26'), '2026-10-05');
  assert.equal(parseDateInput('2026-10-05'), '2026-10-05');
  assert.equal(parseDateInput('31.02.2026'), undefined);
  assert.equal(parseDateInput(''), null);
  assert.equal(parseQtyInput('1,5'), 1.5);
  assert.equal(parseQtyInput('abc'), undefined);
});

test('приходный ордер по заданию: план, принято, отклонение', () => {
  const plan = [{ item_id: 1, sku: 'KOMB', item_name: 'Комбайн', unit: 'шт', barcode: null, qty: 3 }];
  const f = documentForm(doc({ mode: 'plan', plan_count: 1 }), [line({ qty: 2, address: null })], {}, { plan });
  assert.match(f.html, /по заданию на приёмку/);
  assert.match(f.html, /отклонение/);
  assert.match(f.html, /недостача/);
  assert.match(f.html, />-1</);
});
