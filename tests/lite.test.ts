import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import type { DB } from '../src/core/db';
import { exportBackup, importBackup, parseBackup } from '../src/lite/core/backup';
import { orderHtml } from '../src/lite/core/forms';
import { migrateLite } from '../src/lite/core/schema';
import { cellQr, cells, groups, history, items, moveMany, moveStock, orders, racks, summary, warehouse } from '../src/lite/core/service';
import { openTestDb } from './helpers/fakeDb';

let db: DB;
let main: number;
let a1: number;
let bolt: number;

beforeEach(async () => {
  db = openTestDb();
  await migrateLite(db);
  await migrateLite(db); // повторный запуск безопасен
  main = await cells.main(db);
  a1 = await cells.save(db, { code: 'a-01' });
  bolt = await items.save(db, { article: 'B-10', name: 'Болт М10', spp: 'SPP-1001', barcode: '4600000000017' });
});

async function receive(lines: { itemId: number; qty: number; cellId?: number }[]) {
  const id = await orders.create(db, 'receipt');
  for (const l of lines) await orders.addLine(db, id, l);
  await orders.post(db, id);
  return id;
}

test('номенклатура: обязательные поля, без повторов, поиск по коду', async () => {
  await assert.rejects(items.save(db, { article: '', name: 'X' }), /артикул/);
  await assert.rejects(items.save(db, { article: 'B-10', name: 'Другой' }), /Артикул «B-10» уже есть/);
  await assert.rejects(items.save(db, { article: 'N-1', name: 'Другой', spp: 'SPP-1001' }), /SPP номер/);
  assert.equal((await items.findByCode(db, '4600000000017'))?.id, bolt);
  assert.equal((await items.findByCode(db, 'SPP-1001'))?.id, bolt);
  assert.equal((await items.findByCode(db, 'b-10'))?.id, bolt);
  assert.equal(await items.findByCode(db, 'нет такого'), null);
  assert.equal((await items.list(db, { search: 'болт' })).length, 1);
  assert.equal((await items.list(db, { search: 'spp-1001' })).length, 1);
});

test('приход и расход меняют остаток; расход сверх остатка не проводится', async () => {
  await receive([{ itemId: bolt, qty: 10, cellId: a1 }, { itemId: bolt, qty: 2 }]);
  let it = (await items.get(db, bolt))!;
  assert.equal(it.qty, 12);
  assert.deepEqual((await items.places(db, bolt)).map((p) => [p.code, p.qty]), [['ОСН', 2], ['A-01', 10]]);

  const out = await orders.create(db, 'issue');
  const line = await orders.addLine(db, out, { itemId: bolt, qty: 11 }); // ячейка с наибольшим остатком
  assert.equal(line.cell_id, a1);
  await assert.rejects(orders.post(db, out), /Не хватает «Болт М10» в ячейке A-01: есть 10, нужно 11/);
  await orders.setLineQty(db, line.id, 4);
  await orders.addLine(db, out, { itemId: bolt, qty: 1, cellId: main });
  await orders.post(db, out);
  it = (await items.get(db, bolt))!;
  assert.equal(it.qty, 7);
  await assert.rejects(orders.addLine(db, out, { itemId: bolt, qty: 1 }), /проведён/);
  assert.equal((await orders.get(db, out))?.number, 'Р-000001');
  assert.equal((await summary(db)).total, 7);
});

test('повторный скан того же товара увеличивает строку; отмена проведения возвращает остаток', async () => {
  const id = await orders.create(db, 'receipt');
  await orders.addLine(db, id, { itemId: bolt, qty: 1 });
  await orders.addLine(db, id, { itemId: bolt, qty: 1 });
  const lines = await orders.lines(db, id);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].qty, 2);
  await orders.post(db, id);
  assert.equal((await items.get(db, bolt))!.qty, 2);
  await orders.unpost(db, id);
  assert.equal((await items.get(db, bolt))!.qty, 0);
  assert.equal((await history(db)).length, 0);
  await orders.remove(db, id);
  assert.equal(await orders.get(db, id), null);
});

test('перемещение между ячейками и история с фильтрами', async () => {
  const nut = await items.save(db, { article: 'N-10', name: 'Гайка М10' });
  await receive([{ itemId: bolt, qty: 5, cellId: a1 }, { itemId: nut, qty: 100 }]);
  await moveStock(db, { itemId: bolt, fromCellId: a1, toCellId: main, qty: 2 });
  await assert.rejects(moveStock(db, { itemId: bolt, fromCellId: a1, toCellId: main, qty: 9 }), /только 3/);

  assert.equal((await history(db)).length, 3);
  assert.equal((await history(db, { itemId: bolt })).length, 2);
  assert.equal((await history(db, { cellId: a1 })).length, 2);
  assert.equal((await history(db, { kind: 'move' }))[0].to_cell_code, 'ОСН');
  assert.equal((await history(db, { minQty: 50 })).length, 1);
  assert.equal((await history(db, { maxQty: 2 })).length, 1);
  assert.equal((await history(db, { from: '2000-01-01', to: '2000-01-02' })).length, 0);
  assert.equal((await history(db, { from: '2000-01-01', to: '2999-01-01' })).length, 3);
});

test('ячейки: скан своего QR и кода, защита от удаления', async () => {
  assert.equal((await cells.findByCode(db, cellQr('A-01')))?.id, a1);
  assert.equal((await cells.findByCode(db, 'a-01'))?.id, a1);
  await assert.rejects(cells.remove(db, main), /Основную/);
  assert.equal(await cells.createRange(db, 'B-', 1, 12), 12);
  assert.ok(await cells.findByCode(db, 'B-07'));
  await receive([{ itemId: bolt, qty: 1, cellId: a1 }]);
  await assert.rejects(cells.remove(db, a1), /есть товар/);
  await assert.rejects(items.remove(db, bolt), /сначала спишите/);
});

test('резервная копия переносит все данные на другой телефон', async () => {
  await warehouse.save(db, { name: 'Склад №1', address: 'ул. Ленина, 1', person: 'Иванов И.И.' });
  await receive([{ itemId: bolt, qty: 3, cellId: a1 }]);
  const json = JSON.stringify(await exportBackup(db));

  const other = openTestDb();
  await migrateLite(other);
  await items.save(other, { article: 'X', name: 'Будет удалён' });
  const res = await importBackup(other, parseBackup(json));
  assert.equal(res.items, 1);
  assert.equal((await items.list(other)).map((i) => i.name).join(), 'Болт М10');
  assert.equal((await items.get(other, bolt))!.qty, 3);
  assert.equal((await warehouse.get(other)).name, 'Склад №1');
  assert.equal((await history(other)).length, 1);
  // нумерация продолжается
  assert.equal((await orders.get(other, await orders.create(other, 'receipt')))?.number, 'П-000002');
  assert.throws(() => parseBackup('{"a":1}'), /не резервная копия/);
  assert.throws(() => parseBackup('мусор'), /повреждён/);
});

test('печатная форма ордера содержит артикул, SPP и подписи', async () => {
  const id = await orders.create(db, 'issue');
  await receive([{ itemId: bolt, qty: 3 }]);
  await orders.addLine(db, id, { itemId: bolt, qty: 2 });
  await orders.updateHeader(db, id, { partner: 'ООО <Ромашка>' });
  const html = orderHtml((await orders.get(db, id))!, await orders.lines(db, id), await warehouse.get(db));
  assert.match(html, /РАСХОДНЫЙ ОРДЕР № Р-000001/);
  assert.match(html, /SPP-1001/);
  assert.match(html, /ООО &lt;Ромашка&gt;/);
  assert.match(html, /Получил/);
});

test('ряд стеллажей: полки и ячейки A-1-1 … A-5-40, изменение размера', async () => {
  const r = await racks.save(db, { code: 'a', shelves: 5, cellsPerShelf: 40 });
  assert.equal(r.added, 200);
  const list = await cells.list(db, '', { rackId: r.id });
  assert.equal(list.length, 200);
  assert.deepEqual(list.slice(0, 3).map((c) => c.code), ['A-1-1', 'A-1-2', 'A-1-3']);
  assert.equal(list[39].code, 'A-1-40'); // числовой порядок, не A-1-10 после A-1-1
  assert.equal((await cells.list(db, '', { rackId: r.id, shelf: 5 })).length, 40);
  assert.equal((await cells.findByCode(db, cellQr('A-5-40')))?.shelf, 5);
  await assert.rejects(racks.save(db, { code: 'A', shelves: 1, cellsPerShelf: 1 }), /уже есть/);
  await assert.rejects(racks.save(db, { code: 'A-1', shelves: 1, cellsPerShelf: 1 }), /дефиса/);

  // увеличить и уменьшить
  assert.equal((await racks.save(db, { id: r.id, code: 'A', shelves: 6, cellsPerShelf: 40 })).added, 40);
  const a240 = (await cells.findByCode(db, 'A-2-40'))!;
  await receive([{ itemId: bolt, qty: 1, cellId: a240.id }]);
  await assert.rejects(racks.save(db, { id: r.id, code: 'A', shelves: 6, cellsPerShelf: 30 }), /A-2-40 уже использовалась/);
  const res = await racks.save(db, { id: r.id, code: 'A', shelves: 5, cellsPerShelf: 40 });
  assert.equal(res.removed, 40);
  assert.equal((await racks.list(db))[0].busy, 1);
  await assert.rejects(racks.remove(db, r.id), /использовались/);
  const b = await racks.save(db, { code: 'B', shelves: 2, cellsPerShelf: 3 });
  await racks.remove(db, b.id);
  assert.equal(await cells.findByCode(db, 'B-1-1'), null);
});

test('перемещение нескольких товаров одной операцией; где лежит товар', async () => {
  const nut = await items.save(db, { article: 'N-10', name: 'Гайка М10' });
  await receive([{ itemId: bolt, qty: 5, cellId: a1 }, { itemId: nut, qty: 10, cellId: a1 }]);
  await assert.rejects(moveMany(db, { fromCellId: a1, toCellId: main, lines: [{ itemId: bolt, qty: 2 }, { itemId: nut, qty: 11 }] }), /только 10/);
  assert.equal((await items.get(db, nut))!.places, 'A-01: 10'); // откат: ничего не переместилось
  await moveMany(db, { fromCellId: a1, toCellId: main, lines: [{ itemId: bolt, qty: 2 }, { itemId: nut, qty: 10 }, { itemId: bolt, qty: 1 }] });
  const b = (await items.get(db, bolt))!;
  assert.equal(b.places, 'ОСН: 3, A-01: 2');
  assert.equal((await history(db, { kind: 'move' })).length, 2);
});

test('папки товаров: вложенность, количество с подпапками, сортировка и поиск по всей базе', async () => {
  const tech = await groups.save(db, { name: 'Техника' });
  const home = await groups.save(db, { name: 'Бытовая', parent_id: tech });
  const kitchen = await groups.save(db, { name: 'Кухонные комбайны', parent_id: home });
  await assert.rejects(groups.save(db, { name: 'бытовая', parent_id: tech }), /уже есть/);
  await assert.rejects(groups.save(db, { id: tech, name: 'Техника', parent_id: kitchen }), /саму в себя/);
  const k1 = await items.save(db, { article: 'K-1', name: 'Комбайн Bosch', group_id: kitchen });
  await items.save(db, { article: 'K-2', name: 'Комбайн Philips', group_id: kitchen });
  await items.setGroup(db, [bolt], home);
  const root = await groups.children(db, null);
  assert.deepEqual(root.map((g) => [g.name, g.items, g.subgroups]), [['Техника', 3, 1]]);
  assert.deepEqual((await groups.path(db, kitchen)).map((g) => g.name), ['Техника', 'Бытовая', 'Кухонные комбайны']);
  assert.deepEqual((await items.list(db, { groupId: kitchen, sort: 'name_desc' })).map((i) => i.article), ['K-2', 'K-1']);
  assert.equal((await items.list(db, { groupId: null })).length, 0);
  assert.equal((await items.list(db, { groupId: null, search: 'bosch' }))[0].id, k1); // поиск — по всей базе
  await groups.remove(db, home);
  assert.equal((await groups.children(db, tech))[0].name, 'Кухонные комбайны');
  assert.equal((await items.get(db, bolt))!.group_id, tech);

  // копия переносит папки и стеллажи
  await racks.save(db, { code: 'C', shelves: 1, cellsPerShelf: 2 });
  const other = openTestDb();
  await migrateLite(other);
  await importBackup(other, parseBackup(JSON.stringify(await exportBackup(db))));
  assert.equal((await groups.children(other, tech))[0].items, 2);
  assert.equal((await racks.list(other))[0].cells, 2);
});
