import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import type { DB } from '../src/core/db';
import { exportBackup, importBackup, parseBackup } from '../src/lite/core/backup';
import { orderHtml } from '../src/lite/core/forms';
import { migrateLite } from '../src/lite/core/schema';
import { cellQr, cells, history, items, moveStock, orders, summary, warehouse } from '../src/lite/core/service';
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
  assert.deepEqual((await items.places(db, bolt)).map((p) => [p.code, p.qty]), [['A-01', 10], ['ОСН', 2]]);

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
