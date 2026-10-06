import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { api, bindApi, type ClientApi } from '../src/core/api';
import type { Ctx, SessionUser } from '../src/core/ctx';
import type { DB } from '../src/core/db';
import { auth } from '../src/core/services/users';
import { migrate } from '../src/core/schema';
import type { Role } from '../src/core/roles';
import { openTestDb } from './helpers/fakeDb';
import { stockItems, stockTree } from '../src/core/stockTree';
import { receiptCheck } from '../src/core/receiptCheck';

let db: DB;
const people: Record<string, SessionUser> = {};
let whId: number;
let cellA: number;
let cellB: number;
let buffer: number;
let shovel: number;
let gloves: number;

async function addUser(login: string, role: Role, supervisor?: string): Promise<SessionUser> {
  const r = await db.runAsync(
    'INSERT INTO users(login, full_name, pass_hash, salt, role, supervisor_id) VALUES(?, ?, ?, ?, ?, ?)',
    login, `${login} ФИО`, 'x', 'y', role, supervisor ? people[supervisor].id : null);
  const u = { id: r.lastInsertRowId, login, full_name: `${login} ФИО`, role, department_id: null,
    supervisor_id: supervisor ? people[supervisor].id : null };
  people[login] = u;
  return u;
}

const as = (login: string): ClientApi => bindApi((): Ctx => ({ db, user: people[login] }));

beforeEach(async () => {
  db = openTestDb();
  await migrate(db);
  await addUser('admin', 'admin');
  await addUser('boss', 'manager', 'admin');
  await addUser('keeper', 'storekeeper', 'boss');
  await addUser('keeper2', 'storekeeper', 'boss');
  await addUser('emp', 'employee', 'keeper');
  for (let i = 1; i <= 10; i++) await addUser(`w${i}`, 'worker', 'keeper');
  const A = as('admin');
  await A.saveSettings({ custodyEnabled: true });
  whId = await A.saveWarehouse({ code: 'СК1', name: 'Основной' });
  const rack = await A.addRack(whId, 'A');
  await A.addCells(rack, 1, 2);
  const cells = await A.listCells(rack);
  [cellA, cellB] = [cells[0].id, cells[1].id];
  buffer = (await A.bufferCell(whId))!.id;
  shovel = await A.saveItem({ sku: 'SHOVEL', name: 'Лопата', barcode: '4600000000011', track_units: 1 });
  gloves = await A.saveItem({ sku: 'GLOVES', name: 'Перчатки', barcode: '4600000000028' });
});

async function receive(by: string, lines: { itemId: number; qty: number; cellId?: number }[]) {
  const K = as(by);
  const doc = await K.createDocument('receipt', 'fact', { warehouseId: whId });
  for (const l of lines) await K.addLine(doc, l);
  await K.postReceipt(doc);
  return doc;
}

test('приход без места падает в буферную ячейку, по ШК можно принять сразу несколько штук', async () => {
  const K = as('keeper');
  const doc = await K.createDocument('receipt', 'fact', { warehouseId: whId });
  await K.addLineByCode(doc, '4600000000011', 5);
  await K.addLineByCode(doc, '4600000000011', 3);
  assert.equal((await K.listLines(doc))[0].qty, 8);
  await K.postReceipt(doc);
  const stock = await K.stockByItem(shovel);
  assert.equal(stock.length, 1);
  assert.equal(stock[0].cell_id, buffer);
  assert.equal(stock[0].is_buffer, 1);
  assert.match(stock[0].received_at, /^\d{4}-\d{2}-\d{2}$/);
});

test('перемещение части количества по одному ШК сохраняет дату приёмки', async () => {
  await receive('keeper', [{ itemId: gloves, qty: 20 }]);
  const K = as('keeper');
  const [lot] = await K.stockByItem(gloves);
  await K.moveStock({ itemId: gloves, from: { cellId: buffer }, to: { cellId: cellA }, qty: 7 });
  const rows = await K.stockByItem(gloves);
  assert.deepEqual(rows.map((r) => [r.cell_id, r.qty]).sort(), [[buffer, 13], [cellA, 7]].sort());
  assert.ok(rows.every((r) => r.received_at === lot.received_at));
  await assert.rejects(K.moveStock({ itemId: gloves, from: { cellId: cellA }, to: { cellId: cellB }, qty: 8 }), /Недостаточно/);
  await assert.rejects(as('emp').moveStock({ itemId: gloves, from: { cellId: cellA }, to: { cellId: cellB }, qty: 1 }), /прав/);
});

test('импорт номенклатуры из Excel и приход из Excel в буфер', async () => {
  const K = as('keeper');
  const B = as('boss'); // номенклатуру ведёт руководитель
  await assert.rejects(K.importItems([{ sku: 'X1', name: 'X' }]), /номенклатура/);
  const res = await B.importItems([
    { sku: 'HAMMER', name: 'Молоток', barcode: '111', group: 'Инструмент / Ручной' },
    { sku: 'SHOVEL', name: 'Лопата штыковая', barcode: null },
    { sku: '', name: 'Без артикула', barcode: '' },
  ]);
  assert.deepEqual([res.created, res.updated, res.skipped], [1, 1, 1]);
  const groups = await K.listGroups();
  const top = groups.find((g) => g.name === 'Инструмент')!;
  assert.equal((await K.listItems('', top.id)).length, 1); // подгруппы учитываются
  // кладовщик не заводит новые товары: строка с неизвестным артикулом — ошибка
  const rk = await K.createReceiptFromRows(whId, [{ sku: 'HAMMER', qty: 1 }, { sku: 'NEW-1', name: 'Новый', qty: 1 }]);
  assert.deepEqual(rk.errors, ['Строка 3: артикула NEW-1 нет в номенклатуре']);
  await K.deleteDocument(rk.docId);
  const r = await B.createReceiptFromRows(whId, [{ sku: 'HAMMER', qty: 4 }, { sku: 'NEW-1', name: 'Новый', barcode: '222', qty: 2 }, { sku: 'X', qty: 0 }]);
  assert.equal(r.errors.length, 1);
  // из Excel создаётся задание на приёмку: план есть, принятого пока нет
  assert.equal((await K.docPlan(r.docId)).length, 2);
  await assert.rejects(K.postReceipt(r.docId), /Ничего не принято/);
  await K.fillFromPlan(r.docId); // ПК: принять всё по заданию
  await K.postReceipt(r.docId);
  const buf = await K.stockLooseInCell(buffer);
  assert.deepEqual(buf.map((s) => [s.sku, s.qty]).sort(), [['HAMMER', 4], ['NEW-1', 2]]);

  // формат прихода из трёх столбцов: Артикул · Наименование · Количество (без ШК)
  const r3 = await B.createReceiptFromRows(whId, [
    { sku: 'hammer', name: 'Молоток', qty: 1 },
    { sku: 'GLOVES', name: 'Перчатки', qty: 10 },
    { sku: '', name: 'Без артикула', qty: 1 },
  ]);
  assert.deepEqual(r3.errors, ['Строка 4: не указан артикул']);
  assert.equal((await K.docPlan(r3.docId)).length, 2);
  await K.fillFromPlan(r3.docId);
  await K.postReceipt(r3.docId);
  const buf2 = await K.stockLooseInCell(buffer);
  const total = (sku: string) => buf2.filter((s) => s.sku === sku).reduce((a, s) => a + s.qty, 0);
  assert.deepEqual([total('HAMMER'), total('GLOVES')], [5, 10]);
});

test('расходный ордер «Списать»: товар уходит из базы, в истории — кто и откуда', async () => {
  await receive('keeper', [{ itemId: gloves, qty: 10, cellId: cellA }]);
  const K = as('keeper');
  const doc = await K.createDocument('issue', 'plan');
  await K.addIssueLineAuto(doc, gloves, 4);
  await K.postIssue(doc, 'writeoff');
  assert.equal((await K.stockByItem(gloves))[0].qty, 6);
  const d = await K.getDocument(doc);
  assert.equal(d.post_mode, 'writeoff');
  const out = (await K.listMoves({ docId: doc }))[0];
  assert.equal(out.kind, 'writeoff');
  assert.equal(out.address, 'СК1 / A / 1-01');
  assert.equal(out.user_name, 'keeper ФИО');
});

test('выдача 10 лопат и 10 пар перчаток десяти разнорабочим, возврат с отметками и приход', async () => {
  await receive('keeper', [{ itemId: shovel, qty: 12, cellId: cellA }, { itemId: gloves, qty: 30, cellId: cellB }]);
  const K = as('keeper');
  const doc = await K.createDocument('issue', 'fact');
  await K.addLine(doc, { itemId: shovel, qty: 10, cellId: cellA });
  await K.addLine(doc, { itemId: gloves, qty: 10, cellId: cellB });
  await assert.rejects(K.postIssue(doc, 'custody'), /кому/);

  const workers = Array.from({ length: 10 }, (_, i) => people[`w${i + 1}`].id);
  const recipients = (await K.recipients()).map((u) => u.id);
  assert.ok(workers.every((w) => recipients.includes(w)));
  assert.ok(!recipients.includes(people.boss.id)); // руководителю кладовщик не выдаёт
  await K.setAllocations(doc, workers.flatMap((w) => [
    { item_id: shovel, user_id: w, qty: 1 }, { item_id: gloves, user_id: w, qty: 1 },
  ]));
  await K.postIssue(doc, 'custody');

  assert.equal((await K.stockByItem(shovel))[0].qty, 2);
  const issued = await K.issuedCustody({ scope: 'mine', active: true });
  assert.equal(issued.length, 20);
  assert.equal(new Set(issued.map((k) => k.code)).size, 20); // у каждой выдачи свой инвентарный QR
  const w1 = await as('w1').myCustody();
  assert.equal(w1.length, 2);

  // руководитель видит выдачи своего кладовщика
  assert.equal((await as('boss').issuedCustody({ scope: 'team', active: true })).length, 20);

  // разнорабочий возвращает своё: лопата — требует ремонта, перчатки — по умолчанию «без повреждений»
  const w1Shovel = w1.find((k) => k.item_id === shovel)!;
  const w1Gloves = w1.find((k) => k.item_id === gloves)!;
  await as('w1').returnCustody([{ custodyId: w1Shovel.id, condition: 'repair', comment: 'погнут черенок' }, { custodyId: w1Gloves.id }]);
  assert.equal((await as('w1').getCustody(w1Gloves.id)).return_condition, 'ok');
  // чужое вернуть нельзя
  const w2Item = (await as('w2').myCustody())[0];
  await assert.rejects(as('w1').returnCustody([{ custodyId: w2Item.id }]), /прав/);

  // остальное возвращает кладовщик за них; одна лопата утеряна
  const rest = (await K.issuedCustody({ scope: 'mine', active: true })).filter((k) => k.status === 'held');
  assert.equal(rest.length, 18);
  const res = await K.returnCustody(rest.map((k, i) => ({ custodyId: k.id, condition: i === 0 ? 'lost' as const : undefined })));
  assert.equal(res.receipts.length, 1); // всё вернули → сформирован приходный ордер

  const receipt = res.receipts[0];
  const lines = await K.listLines(receipt);
  assert.equal(lines.length, 20);
  assert.equal(lines.filter((l) => l.condition === 'lost').length, 1);
  assert.equal(lines.find((l) => l.custody_id === w1Shovel.id)!.note, 'погнут черенок');

  // провести может выдавший или его руководитель, но не другой кладовщик
  await assert.rejects(as('keeper2').postReceipt(receipt), /прав|выдавший/);
  assert.equal((await as('boss').pendingReturnReceipts()).length, 1);
  await as('boss').postReceipt(receipt);

  const buf = await K.stockLooseInCell(buffer);
  assert.equal(buf.find((s) => s.item_id === shovel)!.qty, 9); // 10 вернули, 1 утеряна
  assert.equal(buf.find((s) => s.item_id === gloves)!.qty, 10);
  const all = await K.issuedCustody({ scope: 'mine' });
  assert.equal(all.filter((k) => k.status === 'lost').length, 1);
  assert.equal(all.filter((k) => k.status === 'closed').length, 19);
});

test('права: разнорабочий не берёт ТМЦ, сотрудник берёт только себе, кладовщик не приглашает', async () => {
  await receive('keeper', [{ itemId: gloves, qty: 5, cellId: cellA }]);
  await assert.rejects(as('w1').createDocument('issue', 'fact'), /прав/);

  const E = as('emp');
  const doc = await E.createDocument('issue', 'fact');
  await E.addLine(doc, { itemId: gloves, qty: 2, cellId: cellA });
  await assert.rejects(E.postIssue(doc, 'writeoff'), /прав/);
  await E.setAllocations(doc, [{ item_id: gloves, user_id: people.w1.id, qty: 2 }]);
  await assert.rejects(E.postIssue(doc, 'custody'), /Нельзя выдать/);
  await E.setAllocations(doc, []);
  await E.postIssue(doc, 'custody'); // без получателей — на себя
  assert.equal((await E.myCustody()).length, 1);

  await assert.rejects(as('keeper').createInvite({ role: 'worker' }), /прав/);
  await assert.rejects(as('boss').createInvite({ role: 'manager' }), /прав/);
  const inv = await as('boss').createInvite({ role: 'worker', maxUses: 1 });
  const uid = await auth.joinByInvite(db, inv.token, { login: 'newbie', fullName: 'Новичок', passHash: 'h', salt: 's' });
  const me = await api.me({ db, user: { ...people.w1, id: uid } });
  assert.equal(me?.role, 'worker');
  assert.equal(me?.supervisor_name, 'boss ФИО');
  await assert.rejects(auth.joinByInvite(db, inv.token, { login: 'other', fullName: 'Ещё', passHash: 'h', salt: 's' }), /использовано/);
});

test('выдача выключена в настройках — «Выдать» недоступно', async () => {
  await as('admin').saveSettings({ custodyEnabled: false });
  await receive('keeper', [{ itemId: gloves, qty: 5, cellId: cellA }]);
  const K = as('keeper');
  const doc = await K.createDocument('issue', 'fact');
  await K.addLine(doc, { itemId: gloves, qty: 1, cellId: cellA });
  await assert.rejects(K.postIssue(doc, 'custody'), /выключена/);
  await assert.rejects(K.saveSettings({ custodyEnabled: true }), /прав/);
});

test('иерархия: руководитель видит подчинённых по цепочке, отдел с главой', async () => {
  const A = as('admin');
  const dep = await A.saveDepartment({ name: 'Монтаж', head_id: people.boss.id });
  await A.updateUser(people.keeper2.id, { department_id: dep, supervisor_id: null });
  await A.updateUser(people.w10.id, { department_id: dep, supervisor_id: null });
  // boss — глава отдела, значит может провести возврат за keeper2
  await receive('keeper2', [{ itemId: gloves, qty: 2, cellId: cellA }]);
  const K2 = as('keeper2');
  const doc = await K2.createDocument('issue', 'fact');
  await K2.addLine(doc, { itemId: gloves, qty: 1, cellId: cellA });
  await K2.setAllocations(doc, [{ item_id: gloves, user_id: people.w10.id, qty: 1 }]);
  await K2.postIssue(doc, 'custody');
  const [k] = await as('w10').myCustody();
  const { receipts } = await as('w10').returnCustody([{ custodyId: k.id }]);
  await as('boss').postReceipt(receipts[0]);
  await assert.rejects(A.updateUser(people.boss.id, { supervisor_id: people.w1.id }), /замкнутая/);
});

test('отчёт «Остатки»: группы и подгруппы, отбор по дате приёмки и количеству, права', async () => {
  const K = as('keeper');
  await as('boss').importItems([
    { sku: 'KOMB', name: 'Кухонный комбайн', group: 'Техника / Бытовая / Кухонные комбайны' },
    { sku: 'DRILL', name: 'Дрель', group: 'Техника / Строительная' },
  ]);
  const komb = (await K.findItemByCode('KOMB'))!.id;
  const drill = (await K.findItemByCode('DRILL'))!.id;
  await receive('keeper', [{ itemId: komb, qty: 3, cellId: cellA }, { itemId: drill, qty: 1, cellId: cellB }, { itemId: gloves, qty: 50, cellId: cellA }]);
  // старая партия комбайнов
  await db.runAsync("UPDATE stock SET received_at = '2026-01-15' WHERE item_id = ?", komb);
  await receive('keeper', [{ itemId: komb, qty: 2, cellId: cellB }]);

  const rows = await K.stockReport({});
  const tree = stockTree(rows, await K.listGroups());
  assert.deepEqual(tree.map((g) => g.name), ['Техника', 'Без группы']);
  const tech = tree[0];
  assert.equal(tech.items, 2);
  assert.deepEqual(tech.groups.map((g) => g.name), ['Бытовая', 'Строительная']);
  const kitchen = tech.groups[0].groups[0];
  assert.equal(kitchen.name, 'Кухонные комбайны');
  assert.equal(kitchen.path, 'Техника / Бытовая / Кухонные комбайны');
  assert.deepEqual(kitchen.list.map((i) => [i.sku, i.qty, i.lots.length, i.first]), [['KOMB', 5, 2, '2026-01-15']]);

  const recent = await K.stockReport({ dateFrom: '2026-02-01' });
  assert.equal(recent.filter((r) => r.sku === 'KOMB').reduce((a, r) => a + r.qty, 0), 2);
  assert.equal((await K.stockReport({ dateTo: '2026-01-31' })).length, 1);
  assert.deepEqual(stockItems(rows, [], { minQty: 2, maxQty: 10 }).map((i) => i.sku), ['KOMB']);
  assert.deepEqual(stockItems(rows, [], { sort: 'qty_desc' }).map((i) => i.sku), ['GLOVES', 'KOMB', 'DRILL']);
  assert.deepEqual(stockItems(rows, [], { sort: 'date' }).map((i) => i.sku)[0], 'KOMB');
  assert.equal((await K.stockReport({ search: 'дрел' })).length, 1);

  await assert.rejects(as('w1').stockReport({}), /прав|доступ/i);
});

test('задание на приёмку: сканирование по ШК, сверка красный / зелёный / жёлтый, всё в буфер', async () => {
  const K = as('keeper');
  const doc = await K.createDocument('receipt', 'plan', { warehouseId: whId });
  await K.setPlanQty(doc, shovel, 3);
  await K.setPlanQty(doc, gloves, 10);
  const hammer = await as('boss').saveItem({ sku: 'HAMMER', name: 'Молоток', barcode: '4600000000035' });

  // быстрый режим: 1 скан = +1 шт; ШК перчаток — коробка по 1 шт, количеством 4
  for (let i = 0; i < 3; i++) await K.addLineByCode(doc, '4600000000011', 1);
  await K.addLineByCode(doc, '4600000000028', 4);
  await K.addLineByCode(doc, '4600000000035', 1); // нет в задании
  let chk = receiptCheck(await K.docPlan(doc), await K.listLines(doc));
  const st = () => Object.fromEntries(chk.rows.map((x) => [x.sku, `${x.status}:${x.fact}/${x.plan}`]));
  assert.deepEqual(st(), { SHOVEL: 'ok:3/3', GLOVES: 'short:4/10', HAMMER: 'extra:1/0' });
  assert.equal(chk.matched, false);

  await K.addLineByCode(doc, '4600000000011', 1); // лишняя лопата
  await K.setFactQty(doc, gloves, 10);
  await K.setFactQty(doc, hammer, 0);
  chk = receiptCheck(await K.docPlan(doc), await K.listLines(doc));
  assert.deepEqual(st(), { SHOVEL: 'over:4/3', GLOVES: 'ok:10/10' });

  // строки без места — после проведения всё в буферной ячейке
  assert.ok((await K.listLines(doc)).every((l) => l.cell_id === null && l.box_id === null));
  await K.postReceipt(doc);
  const buf = await K.stockLooseInCell(buffer);
  assert.deepEqual(buf.map((x) => [x.sku, x.qty]).sort(), [['GLOVES', 10], ['SHOVEL', 4]]);
  await assert.rejects(K.setPlanQty(doc, shovel, 1), /проведён/);
  await assert.rejects(as('emp').setPlanQty(await K.createDocument('receipt', 'plan', { warehouseId: whId }), shovel, 1), /прав|доступ|запрещ/i);
});

test('задания: общий пул, кладовщик берёт задание — его ФИО в ордере; задание на отбор со сверкой', async () => {
  await receive('keeper', [{ itemId: gloves, qty: 6, cellId: cellA }, { itemId: gloves, qty: 10, cellId: cellB }, { itemId: shovel, qty: 2, cellId: cellA }]);
  const B = as('boss');
  const K = as('keeper');
  const K2 = as('keeper2');

  const task = await B.createDocument('issue', 'plan');
  await B.setPlanQty(task, gloves, 8);
  await B.setPlanQty(task, shovel, 3);
  let pool = await K.listDocuments({ status: 'draft', task: true });
  assert.deepEqual(pool.map((d) => [d.id, d.assignee_id, d.plan_qty, d.lines_qty]), [[task, null, 11, 0]]);

  await K.takeTask(task);
  await assert.rejects(K2.takeTask(task), /в работе у keeper ФИО/);
  pool = await K2.listDocuments({ status: 'draft', task: true });
  assert.equal(pool[0].assignee_name, 'keeper ФИО');

  // отбор по факту: 6 из ячейки A + 3 из B, лопат на складе только 2
  await K.addLine(task, { itemId: gloves, qty: 6, cellId: cellA });
  await K.addLine(task, { itemId: gloves, qty: 3, cellId: cellB });
  await K.addLine(task, { itemId: shovel, qty: 2, cellId: cellA });
  let chk = receiptCheck(await K.docPlan(task), await K.listLines(task));
  assert.deepEqual(chk.rows.map((x) => [x.sku, x.status]), [['GLOVES', 'over'], ['SHOVEL', 'short']]);
  await K.setFactQty(task, gloves, 0); // сбросить отобранное
  await assert.rejects(K.setFactQty(task, gloves, 5), /конкретного места/);
  const res = await K.fillFromPlan(task); // ПК: подобрать по FIFO
  assert.equal(res.shortage, 1);
  chk = receiptCheck(await K.docPlan(task), await K.listLines(task));
  assert.deepEqual(chk.rows.map((x) => [x.sku, x.fact, x.status]), [['GLOVES', 8, 'ok'], ['SHOVEL', 2, 'short']]);

  await K.postIssue(task, 'writeoff');
  const posted = await K.getDocument(task);
  assert.equal(posted.assignee_name, 'keeper ФИО');
  assert.equal((await K.listDocuments({ status: 'draft', task: true })).length, 0);

  // задание никто не брал — исполнителем становится проводящий
  const rt = await B.createDocument('receipt', 'plan', { warehouseId: whId });
  await B.setPlanQty(rt, gloves, 1);
  await K2.addLine(rt, { itemId: gloves, qty: 1 });
  await K2.postReceipt(rt);
  assert.equal((await K2.getDocument(rt)).assignee_name, 'keeper2 ФИО');
  await assert.rejects(as('keeper').saveItem({ sku: 'NEWX', name: 'Новый' }), /номенклатура/);
});
