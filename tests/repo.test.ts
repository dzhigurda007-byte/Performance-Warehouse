import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import type { SQLiteDatabase } from 'expo-sqlite';
import * as repo from '../src/db/repo';
import { migrate } from '../src/db/schema';
import { boxQr, cellQr, parseScan } from '../src/domain/codes';
import { openTestDb } from './helpers/fakeDb';

let db: SQLiteDatabase;
let userId: number;
let cellA: number;
let cellB: number;
let itemId: number;

beforeEach(async () => {
  db = openTestDb();
  await migrate(db);
  const u = await db.runAsync("INSERT INTO users(login, full_name, pass_hash, salt) VALUES('ivan', 'Иванов И.', 'x', 'y')");
  userId = u.lastInsertRowId;
  const wh = await repo.saveWarehouse(db, { code: 'СК1', name: 'Основной' });
  const rack = await repo.addRack(db, wh, 'A');
  assert.equal(await repo.addCells(db, rack, 2, 3), 6);
  const cells = await repo.listCells(db, rack);
  cellA = cells[0].id;
  cellB = cells[1].id;
  itemId = await repo.saveItem(db, { sku: 'BOLT-8', name: 'Болт М8', unit: 'шт', barcode: '4600000000001' });
});

async function receive(lines: { qty: number; cellId?: number; boxId?: number }[]) {
  const doc = await repo.createDocument(db, 'receipt', 'plan', userId);
  for (const l of lines) await repo.addLine(db, doc, { itemId, ...l });
  await repo.postDocument(db, doc, userId);
  return doc;
}

const total = async () => (await repo.stockByItem(db, itemId)).reduce((a, r) => a + r.qty, 0);

test('адрес ячейки и распознавание QR / штрихкодов', async () => {
  const cell = await repo.getCell(db, cellA);
  assert.equal(cell?.address, 'СК1 / A / 1-01');
  const box = await repo.createBox(db, cellA);
  assert.equal(box.code, 'BX-000001');
  assert.equal((await repo.resolveScan(db, parseScan(cellQr(cellA)))).type, 'cell');
  assert.equal((await repo.resolveScan(db, parseScan(boxQr(box.code)))).type, 'box');
  const byEan = await repo.resolveScan(db, parseScan('4600000000001'));
  assert.equal(byEan.type === 'item' && byEan.item.id, itemId);
  assert.equal((await repo.resolveScan(db, parseScan('???'))).type, 'none');
});

test('приход в ячейку и в короб; в одной ячейке несколько товаров и коробов', async () => {
  const box1 = await repo.createBox(db, cellA);
  const box2 = await repo.createBox(db, cellA);
  const nut = await repo.saveItem(db, { sku: 'NUT-8', name: 'Гайка М8' });
  const doc = await repo.createDocument(db, 'receipt', 'plan', userId);
  await repo.addLine(db, doc, { itemId, qty: 5, cellId: cellA });
  await repo.addLine(db, doc, { itemId: nut, qty: 7, cellId: cellA });
  await repo.addLine(db, doc, { itemId, qty: 10, boxId: box1.id });
  await repo.addLine(db, doc, { itemId, qty: 2, boxId: box2.id });
  await repo.addLine(db, doc, { itemId, qty: 1, boxId: box2.id }); // свернётся с предыдущей
  assert.equal((await repo.listLines(db, doc)).length, 4);
  await repo.postDocument(db, doc, userId);

  assert.equal((await repo.stockLooseInCell(db, cellA)).length, 2);
  assert.equal((await repo.listBoxesInCell(db, cellA)).length, 2);
  assert.equal((await repo.stockAllInCell(db, cellA)).length, 4);
  assert.equal(await total(), 18);
  const inBox = await repo.stockInBox(db, box2.id);
  assert.equal(inBox[0].qty, 3);
  assert.equal(inBox[0].address, 'СК1 / A / 1-01');
});

test('расход по заявке: FIFO-подбор мест и запись истории с получателем', async () => {
  await receive([{ qty: 4, cellId: cellA }]);
  await new Promise((r) => setTimeout(r, 1100)); // вторая партия позже
  const box = await repo.createBox(db, cellB);
  await receive([{ qty: 10, boxId: box.id }]);

  const doc = await repo.createDocument(db, 'issue', 'plan', userId);
  const res = await repo.addIssueLineAuto(db, doc, itemId, 6);
  assert.equal(res.shortage, 0);
  const lines = await repo.listLines(db, doc);
  assert.deepEqual(lines.map((l) => [l.cell_id, l.box_id, l.qty]), [[cellA, null, 4], [null, box.id, 2]]);
  assert.equal(lines[1].address, 'СК1 / A / 1-02'); // документ показывает, где лежит

  await assert.rejects(repo.postDocument(db, doc, userId), /Получатель/);
  await repo.updateDocumentHeader(db, doc, { recipient: 'Петров П.' });
  await repo.postDocument(db, doc, userId);
  assert.equal(await total(), 8);

  const hist = await repo.listMoves(db, { direction: 'out' });
  assert.equal(hist.length, 2);
  assert.ok(hist.every((m) => m.recipient === 'Петров П.' && m.user_name === 'Иванов И.'));
  assert.equal((await repo.listMoves(db, { search: 'Петров' })).length, 2);
});

test('нельзя выдать больше остатка; проведение атомарно', async () => {
  await receive([{ qty: 3, cellId: cellA }]);
  const doc = await repo.createDocument(db, 'issue', 'fact', userId);
  await repo.updateDocumentHeader(db, doc, { recipient: 'Склад 2' });
  await repo.addLine(db, doc, { itemId, qty: 2, cellId: cellA });
  await repo.addLine(db, doc, { itemId, qty: 5, cellId: cellB });
  await assert.rejects(repo.postDocument(db, doc, userId), /Недостаточно/);
  assert.equal(await total(), 3); // первая строка откатилась
  assert.equal((await repo.getDocument(db, doc))?.status, 'draft');
});

test('расход по факту из короба, перемещение короба и отмена проведения', async () => {
  const box = await repo.createBox(db, cellA);
  await receive([{ qty: 10, boxId: box.id }]);

  // изъятие из короба без сканирования короба — по строке остатка товара
  const doc = await repo.createDocument(db, 'issue', 'fact', userId);
  await repo.updateDocumentHeader(db, doc, { recipient: 'Сидоров' });
  const [row] = await repo.stockByItem(db, itemId);
  await repo.addLine(db, doc, { itemId, qty: 3, cellId: row.cell_id, boxId: row.box_id });
  await repo.postDocument(db, doc, userId);
  assert.equal((await repo.stockInBox(db, box.id))[0].qty, 7);

  // перемещение короба — остатки едут вместе с коробом
  await repo.moveBox(db, box.id, cellB, userId);
  const after = await repo.stockByItem(db, itemId);
  assert.equal(after[0].cell_id, cellB);
  assert.equal(after[0].address, 'СК1 / A / 1-02');
  assert.equal((await repo.listDocuments(db, 'move')).length, 1);

  // отмена проведения расхода возвращает товар в короб (уже в новой ячейке)
  await repo.unpostDocument(db, doc);
  assert.equal((await repo.stockInBox(db, box.id))[0].qty, 10);
  assert.equal((await repo.listMoves(db, { docId: doc })).length, 0);
});

test('нельзя удалить ячейку с товаром или историей', async () => {
  await receive([{ qty: 1, cellId: cellA }]);
  await assert.rejects(repo.deleteCell(db, cellA), /не пуст/);
  await assert.rejects(repo.deleteItem(db, itemId), /используется/);
  await repo.deleteCell(db, cellB + 1); // пустая и без истории
});
