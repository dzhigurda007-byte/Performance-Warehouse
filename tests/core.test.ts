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
import { updTotals } from '../src/core/upd';
import { contractTitle } from '../src/core/refs';
import { boxQr } from '../src/core/codes';

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
  // утеряна именно лопата (порядок выдач с одинаковым временем не определён — выбираем явно)
  const lostId = rest.find((k) => k.item_id === shovel)!.id;
  const res = await K.returnCustody(rest.map((k) => ({ custodyId: k.id, condition: k.id === lostId ? 'lost' as const : undefined })));
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

  // остатки разнорабочий видит (нужно для отбора по заданию), историю движений — нет
  assert.ok((await as('w1').stockReport({})).length > 0);
  await assert.rejects(as('w1').listMoves({}), /прав|доступ/i);
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
  // назначенное задание видят исполнитель, постановщик и руководитель — другой кладовщик нет
  assert.equal((await K2.listDocuments({ status: 'draft', task: true })).length, 0);
  await assert.rejects(K2.getDocument(task), /другому сотруднику/);
  assert.equal((await B.listDocuments({ status: 'draft', task: true }))[0].assignee_name, 'keeper ФИО');

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

  // задание на отбор не проводится — завершается, по нему формируется расходный ордер
  await assert.rejects(K.postIssue(task, 'writeoff'), /завершите его/);
  const { orderId } = await K.completeTask(task);
  const order = await K.getDocument(orderId!);
  assert.deepEqual([order.type, order.source, order.base_doc_id, order.assignee_name], ['issue', 'task', task, 'keeper ФИО']);
  await K.postIssue(orderId!, 'writeoff');
  const done = await B.getDocument(task);
  assert.deepEqual([done.task_status, done.completed_by_name, done.order_id, done.order_status], ['done', 'keeper ФИО', orderId, 'posted']);
  assert.equal((await K.listDocuments({ taskStatus: 'open' })).length, 0);

  // задание никто не брал — исполнителем становится проводящий
  const rt = await B.createDocument('receipt', 'plan', { warehouseId: whId, task: true });
  await B.setPlanQty(rt, gloves, 1);
  await K2.addLine(rt, { itemId: gloves, qty: 1 });
  await K2.postReceipt(rt);
  assert.equal((await K2.getDocument(rt)).assignee_name, 'keeper2 ФИО');
  await assert.rejects(as('keeper').saveItem({ sku: 'NEWX', name: 'Новый' }), /номенклатура/);
});

test('удаление номенклатуры: руководитель и администратор; с историей — убирается из номенклатуры', async () => {
  const B = as('boss');
  const fresh = await B.saveItem({ sku: 'TMP-1', name: 'Временный', barcode: '999' });
  assert.equal(await B.deleteItem(fresh), 'deleted');
  assert.equal(await B.getItem(fresh), null);

  await receive('keeper', [{ itemId: gloves, qty: 2, cellId: cellA }]);
  await assert.rejects(as('keeper').deleteItem(gloves), /номенклатура/);
  await assert.rejects(B.deleteItem(gloves), /на складе числится 2/);
  const K = as('keeper');
  const d = await K.createDocument('issue', 'fact');
  await K.addLine(d, { itemId: gloves, qty: 2, cellId: cellA });
  await K.postIssue(d, 'writeoff');
  const draft = await K.createDocument('receipt', 'plan', { warehouseId: whId });
  await K.setPlanQty(draft, gloves, 5);
  await assert.rejects(B.deleteItem(gloves), /черновиках: ПО-/);
  await K.deleteDocument(draft);

  // остатка нет, есть история — товар убран из номенклатуры, документ и движения на месте
  assert.equal(await as('admin').deleteItem(gloves), 'archived');
  assert.equal((await B.listItems('перчат')).length, 0);
  assert.equal(await B.findItemByCode('4600000000028'), null);
  assert.equal((await K.listLines(d))[0].item_name, 'Перчатки');
  assert.ok((await K.listMoves({ itemId: gloves })).length > 0);
  // артикул и ШК освободились
  await B.saveItem({ sku: 'GLOVES', name: 'Перчатки новые', barcode: '4600000000028' });

  const r = await B.deleteItems([shovel, 999999]);
  assert.deepEqual([r.deleted, r.archived, r.errors.length], [2, 0, 0]);
});

test('код ячейки, набранный вручную, распознаётся как ячейка', async () => {
  const K = as('keeper');
  const cell = (await K.getCell(cellA))!;
  for (const typed of [cell.code, `A-${cell.code}`, `a ${cell.code.toLowerCase()}`, `СК1/A/${cell.code}`, ` ск1 / a / ${cell.code} `]) {
    const r = await K.resolveScan(typed);
    assert.equal(r.type, 'cell', typed);
    assert.equal(r.type === 'cell' && r.cell.id, cellA, typed);
  }
  assert.equal((await K.resolveScan('Z-9-99')).type, 'none');
  // одинаковый код ячейки на двух стеллажах — по короткому коду не угадываем, по полному находим
  const rackB = await as('admin').addRack(whId, 'B');
  await as('admin').addCells(rackB, 1, 1);
  assert.equal((await K.resolveScan(cell.code)).type, 'none');
  assert.equal((await K.resolveScan(`B-${cell.code}`)).type, 'cell');
});

test('перемещение нескольких товаров из разных мест одним документом; ошибка — ничего не перемещается', async () => {
  await receive('keeper', [{ itemId: gloves, qty: 10, cellId: cellA }, { itemId: shovel, qty: 3, cellId: buffer }]);
  const K = as('keeper');
  const lot = (await K.stockLooseInCell(cellA))[0].received_at;
  const doc = await K.moveMany({
    to: { cellId: cellB },
    lines: [
      { itemId: gloves, from: { cellId: cellA }, qty: 4, receivedAt: lot },
      { itemId: shovel, from: { cellId: buffer }, qty: 3 },
    ],
  });
  const lines = await K.listLines(doc);
  assert.deepEqual(lines.map((l) => [l.sku, l.qty]).sort(), [['GLOVES', 4], ['SHOVEL', 3]]);
  assert.equal((await K.listDocuments({ type: 'move' })).length, 1);
  assert.deepEqual((await K.stockLooseInCell(cellB)).map((x) => [x.sku, x.qty]).sort(), [['GLOVES', 4], ['SHOVEL', 3]]);
  assert.equal((await K.stockLooseInCell(buffer)).length, 0);

  // во второй строке больше, чем есть — откатывается всё
  await assert.rejects(K.moveMany({
    to: { cellId: cellA },
    lines: [{ itemId: shovel, from: { cellId: cellB }, qty: 1 }, { itemId: gloves, from: { cellId: cellB }, qty: 99 }],
  }));
  assert.deepEqual((await K.stockLooseInCell(cellB)).map((x) => [x.sku, x.qty]).sort(), [['GLOVES', 4], ['SHOVEL', 3]]);
  await assert.rejects(K.moveMany({ to: { cellId: cellB }, lines: [{ itemId: gloves, from: { cellId: cellB }, qty: 1 }] }), /месте назначения/);
});

test('УПД по расходному ордеру: строки по товарам, цены с НДС / без, сохранение и последняя цена', async () => {
  await receive('keeper', [{ itemId: gloves, qty: 10, cellId: cellA }, { itemId: gloves, qty: 5, cellId: cellB }, { itemId: shovel, qty: 2, cellId: cellA }]);
  const K = as('keeper');
  const d = await K.createDocument('issue', 'fact');
  await K.updateDocumentHeader(d, { recipient: 'ООО Ромашка', partner: 'Договор № 7', comment: '' });
  await K.addLine(d, { itemId: gloves, qty: 10, cellId: cellA });
  await K.addLine(d, { itemId: gloves, qty: 2, cellId: cellB });
  await K.addLine(d, { itemId: shovel, qty: 1, cellId: cellA });
  await K.postIssue(d, 'writeoff');

  const u = await K.getUpd(d);
  assert.equal(u.saved, false);
  assert.equal(u.data.buyer.name, 'ООО Ромашка');
  assert.equal(u.data.basis, 'Договор № 7');
  assert.deepEqual(u.data.lines.map((l) => [l.sku, l.qty]), [['GLOVES', 12], ['SHOVEL', 1]]); // отбор из двух ячеек — одна строка

  const data = { ...u.data, vat: 22 as const, priceWithVat: true, lines: u.data.lines.map((l) => ({ ...l, price: l.sku === 'GLOVES' ? 122 : 610 })) };
  const t = await K.saveUpd(d, data);
  assert.deepEqual([t.sumGross, t.vatSum, t.sumNet], [2074, 374, 1700]); // 12×122 + 610 = 2074; НДС 22/122
  assert.equal(t.rows[0].priceNet, 100);
  assert.equal(t.rows[0].okei, '796');

  // повторно — сохранённые данные; новый УПД по тому же товару подставит последнюю цену
  assert.equal((await K.getUpd(d)).saved, true);
  const d2 = await K.createDocument('issue', 'fact');
  await K.addLine(d2, { itemId: gloves, qty: 1, cellId: cellB });
  const u2 = await K.getUpd(d2);
  assert.equal(u2.data.lines[0].price, 122); // 100 без НДС → 122 с НДС 22%
  assert.deepEqual((await K.updBuyers()).map((b) => b.name), ['ООО Ромашка']);

  // без НДС, цены без налога
  const t2 = updTotals({ vat: 'none', priceWithVat: false, lines: [{ item_id: 1, sku: 'A', name: 'A', unit: 'кг', qty: 1.5, price: 99.99 }] });
  assert.deepEqual([t2.sumNet, t2.vatSum, t2.sumGross, t2.rows[0].okei], [149.99, 0, 149.99, '166']);
  await assert.rejects(as('emp').getUpd(d), /прав|доступ/i);
  await assert.rejects(K.getUpd(await K.createDocument('receipt', 'fact', { warehouseId: whId })), /расходному/);

  // реквизиты продавца
  await assert.rejects(as('admin').saveSettings({ orgInn: '123' }), /ИНН/);
  await as('admin').saveSettings({ orgName: 'ООО Склад', orgInn: '7701234567', orgKpp: '770101001' });
  const st = await K.settings();
  assert.deepEqual([st.orgInn, st.orgKpp], ['7701234567', '770101001']);
});

test('справочник: организации, контрагенты (юр. / физ. лица), договоры со сторонами из справочника', async () => {
  const B = as('boss');
  const K = as('keeper');
  // реквизиты проверяются
  await assert.rejects(B.saveOrg({ name: 'ООО Склад', inn: '123' }), /ИНН: 10 или 12 цифр/);
  await assert.rejects(B.saveParty('person', { name: 'Петров', passport_issued_at: '31.02.2020' }), /Дата выдачи: дата/);
  await assert.rejects(K.saveOrg({ name: 'ООО Склад' }), /справочник/); // кладовщик только читает

  const org1 = await B.saveOrg({ name: 'ООО «Склад»', inn: '7701234567', kpp: '770101001', bik: '044525225', bank_account: '40702810000000000001' });
  const org2 = await B.saveOrg({ name: 'ИП Иванов', inn: '770123456789' });
  assert.equal((await K.defaultOrg())!.id, org1); // первая — по умолчанию
  await B.saveOrg({ id: org2, name: 'ИП Иванов', inn: '770123456789', is_default: 1 });
  assert.equal((await K.defaultOrg())!.id, org2);
  assert.equal((await K.listOrgs()).filter((o) => o.is_default).length, 1);

  const legal = await B.saveParty('legal', { name: 'ООО «Ромашка»', inn: '7712345678', kpp: '771201001', address: 'Москва' });
  const person = await B.saveParty('person', {
    name: 'Сидоров Сидор Сидорович', passport_series: '45 12', passport_number: '123456', passport_issued_at: '01.02.2015', birth_date: '1990-05-03',
  });
  assert.equal((await K.getParty(person))!.passport_series, '4512');
  assert.equal((await K.getParty(person))!.passport_issued_at, '2015-02-01');
  assert.deepEqual((await K.listParties('legal', 'ромаш')).map((c) => c.id), [legal]);
  assert.deepEqual((await K.listParties('person')).map((c) => c.id), [person]);
  await assert.rejects(B.saveParty('person', { id: legal, name: 'X' }), /вид контрагента/);

  await assert.rejects(B.saveContract({ number: '15', date: '01.09.2026', org_id: org1 }), /контрагента/);
  await assert.rejects(B.saveContract({ number: '15', date: '01.09.2026', valid_until: '01.01.2026', org_id: org1, counterparty_id: legal }), /раньше/);
  const c1 = await B.saveContract({ number: '15', date: '01.09.2026', title: 'Договор поставки', amount: '1 500 000,50', org_id: org1, counterparty_id: legal });
  const c2 = await B.saveContract({ number: 'П-3', date: '2026-10-01', org_id: org2, counterparty_id: person });
  const got = (await K.getContract(c1))!;
  assert.deepEqual([got.org_name, got.party_name, got.party_kind, got.amount, got.date], ['ООО «Склад»', 'ООО «Ромашка»', 'legal', 1500000.5, '2026-09-01']);
  assert.equal(contractTitle(got), 'Договор поставки № 15 от 01.09.2026');
  assert.deepEqual((await K.listContracts({ counterpartyId: person })).map((c) => c.id), [c2]);
  assert.deepEqual((await K.listContracts({ search: 'ромаш' })).map((c) => c.id), [c1]);

  // стороны договора нельзя удалить, пока есть договор
  await assert.rejects(B.deleteParty(legal), /договоров/);
  await assert.rejects(B.deleteOrg(org1), /договорах/);
  await B.deleteContract(c1);
  await B.deleteParty(legal);
  assert.equal(await K.getParty(legal), null);

  // цена товара в номенклатуре
  await B.saveItem({ id: gloves, sku: 'GLOVES', name: 'Перчатки', barcode: '4600000000028', price: 99.5 });
  assert.equal((await K.getItem(gloves))!.price, 99.5);
});

test('реквизиты из прежних настроек переносятся в «Организации»', async () => {
  const fresh = openTestDb();
  await migrate(fresh); // пустая база: организаций нет и переносить нечего
  assert.equal((await fresh.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM organizations'))!.n, 0);
  await fresh.runAsync("INSERT OR REPLACE INTO meta(key, value) VALUES ('org_name', 'ООО Старое'), ('org_inn', '7701234567')");
  await migrate(fresh);
  const org = await fresh.getFirstAsync<{ name: string; inn: string; is_default: number }>('SELECT name, inn, is_default FROM organizations');
  assert.deepEqual({ ...org }, { name: 'ООО Старое', inn: '7701234567', is_default: 1 });
});

test('генератор коробов: N коробов со сквозной нумерацией, свободные, потом в ячейку', async () => {
  const K = as('keeper');
  const first = await K.createBox(cellA);
  const list = await K.createBoxes({ count: 3, name: 'Поставка 07.10' });
  const num = (code: string) => Number(code.slice(3));
  assert.deepEqual(list.map((b) => num(b.code) - num(first.code)), [1, 2, 3]);
  assert.match(list[0].code, /^BX-\d{6}$/);
  const free = await K.listBoxes({ unplaced: true });
  assert.deepEqual(free.map((b) => b.code).sort(), list.map((b) => b.code).sort());
  assert.ok(free.every((b) => b.cell_id === null && b.name === 'Поставка 07.10'));
  assert.equal((await K.listBoxes({ search: list[1].code })).length, 1);
  // QR короба распознаётся
  const r = await K.resolveScan(boxQr(list[0].code));
  assert.equal(r.type === 'box' && r.box.id, list[0].id);
  // поставить свободный короб в ячейку
  await K.moveBox(list[0].id, cellB);
  assert.equal((await K.listBoxes({ unplaced: true })).length, 2);
  // в ячейку сразу
  const inCell = await K.createBoxes({ count: 2, cellId: cellA });
  assert.ok((await K.listBoxesInCell(cellA)).some((b) => b.id === inCell[1].id));
  await assert.rejects(K.createBoxes({ count: 0 }), /от 1 до 1000/);
  await assert.rejects(K.createBoxes({ count: 1001 }), /от 1 до 1000/);
  await assert.rejects(as('emp').createBoxes({ count: 1 }), /прав|доступ/i);
});

test('задания: поставить сотруднику, выполнить разнорабочим, отчёт постановщику, проводит кладовщик', async () => {
  await receive('keeper', [{ itemId: gloves, qty: 10, cellId: cellA }]);
  const B = as('boss');
  const K = as('keeper');
  const W = as('w1');
  const W2 = as('w2');

  // приёмка: поставлена конкретному разнорабочему
  const rt = await B.createDocument('receipt', 'plan', { warehouseId: whId, task: true, assigneeId: people.w1.id });
  await B.setPlanQty(rt, shovel, 3);
  await B.setPlanQty(rt, gloves, 2);
  assert.deepEqual((await W.listDocuments({ task: true })).map((d) => d.id), [rt]);
  assert.equal((await W2.listDocuments({ task: true })).length, 0); // чужое назначенное не видно
  assert.equal((await K.listDocuments({ task: true })).length, 0); // и кладовщику (не постановщик)
  await assert.rejects(W2.addLineByCode(rt, '4600000000011', 1), /другому сотруднику/);

  // исполнитель сканирует; шапку, план и удаление не трогает; провести не может
  await W.addLineByCode(rt, '4600000000011', 1);
  await W.addLineByCode(rt, '4600000000011', 1);
  await W.addLineByCode(rt, '4600000000028', 3);
  await assert.rejects(W.updateDocumentHeader(rt, { partner: 'x' }), /исполнитель меняет только строки/);
  await assert.rejects(W.setPlanQty(rt, shovel, 10), /прав|доступ/i);
  await assert.rejects(W.deleteDocument(rt), /удаление задания/);
  await assert.rejects(W.fillFromPlan(rt), /прав|доступ/i);
  await assert.rejects(W.postReceipt(rt), /прав|доступ/i);
  // ШК нет в базе — разнорабочий не заводит, кладовщик заводит на месте
  await assert.rejects(W.createItemFromScan({ barcode: '4609999999999', name: 'Кабель ВВГ 3×2,5', sku: 'VVG-3' }), /кладовщик/);

  // завершение: отчёт постановщику — лопат 2 из 3, перчаток 3 из 2
  assert.deepEqual(await W.completeTask(rt), { orderId: null });
  await assert.rejects(W.addLineByCode(rt, '4600000000011', 1), /Задание выполнено/);
  const rep = await B.getDocument(rt);
  assert.deepEqual([rep.task_status, rep.completed_by_name], ['done', 'w1 ФИО']);
  const chk = receiptCheck(await B.docPlan(rt), await B.listLines(rt));
  assert.deepEqual(chk.rows.map((x) => [x.sku, x.status, x.diff]), [['SHOVEL', 'short', -1], ['GLOVES', 'over', 1]]);
  // выполненное видят кладовщики — проводит кладовщик
  assert.ok((await K.listDocuments({ task: true })).some((d) => d.id === rt));
  await K.postReceipt(rt);
  assert.equal((await K.getDocument(rt)).status, 'posted');

  // отбор: поставлен в пул, взял сотрудник, по завершении — расходный ордер; сотрудник его не проводит
  const pt = await K.createDocument('issue', 'plan', { task: true });
  await K.setPlanQty(pt, gloves, 4);
  const E = as('emp');
  await E.takeTask(pt);
  await E.addLine(pt, { itemId: gloves, qty: 4, cellId: cellA });
  await E.completeTask(pt);
  await assert.rejects(E.completeTask(pt), /уже выполнено/);
  const order = (await K.getDocument(pt)).order_id!;
  await assert.rejects(E.postIssue(order, 'custody'), /прав|доступ/i);
  await assert.rejects(E.postIssue(order, 'writeoff'), /прав|доступ/i);
  // вернуть в работу: непроведённый ордер удаляется
  await K.reopenTask(pt);
  assert.equal((await K.getDocument(pt)).task_status, 'open');
  assert.equal((await K.getDocument(pt)).order_id, null);
  await E.completeTask(pt);
  await K.postIssue((await K.getDocument(pt)).order_id!, 'writeoff');
  assert.equal((await K.stockLooseInCell(cellA)).find((x) => x.sku === 'GLOVES')!.qty, 6);
  await assert.rejects(K.reopenTask(pt), /проведён/);

  // назначение: кладовщик ставит задание сотруднику; руководитель видит всё
  const t3 = await K.createDocument('issue', 'plan', { task: true });
  await K.assignTask(t3, people.w2.id);
  assert.equal((await W2.listDocuments({ task: true, taskStatus: 'open' }))[0].id, t3);
  await assert.rejects(W.assignTask(t3, people.w1.id), /прав|доступ/i);
  assert.ok((await B.listDocuments({ task: true })).length >= 3);
});

test('права: руководитель — полные (настройки, отделы), «Разработчик» — только администратор', async () => {
  const B = as('boss');
  await B.saveSettings({ custodyEnabled: false });
  await B.saveDepartment({ name: 'Склад №2' });
  await assert.rejects(B.devInfo(), /Разработчик/);
  const info = await as('admin').devInfo();
  assert.ok(info.schemaVersion >= 9);
  assert.ok(info.tables.find((t) => t.name === 'documents'));
  // руководитель не назначает роль администратора и не правит администратора
  await assert.rejects(B.updateUser(people.keeper.id, { role: 'admin' }), /роли/);
  await assert.rejects(B.updateUser(people.admin.id, { position: 'x' }), /такой же или более высокой/);
});

test('приёмка: новый ШК — кладовщик заводит товар на месте, штрихкод ставит система', async () => {
  const K = as('keeper');
  await assert.rejects(K.createItemFromScan({ barcode: '4609999999999', name: 'Ка', sku: 'VVG-3' }), /полное наименование/);
  await assert.rejects(K.createItemFromScan({ barcode: '4600000000011', name: 'Дубль лопаты', sku: 'X1' }), /уже есть/);
  const id = await K.createItemFromScan({ barcode: '4609999999999', name: 'Кабель ВВГ 3×2,5 мм², бухта 100 м', sku: 'VVG-3' });
  const item = (await K.getItem(id))!;
  assert.deepEqual([item.barcode, item.sku, item.name], ['4609999999999', 'VVG-3', 'Кабель ВВГ 3×2,5 мм², бухта 100 м']);
  const doc = await K.createDocument('receipt', 'fact', { warehouseId: whId });
  await K.addLineByCode(doc, '4609999999999', 5);
  assert.equal((await K.listLines(doc))[0].sku, 'VVG-3');
  // правка номенклатуры — по-прежнему только руководитель и администратор
  await assert.rejects(K.saveItem({ id, sku: 'VVG-3', name: 'x' }), /номенклатура/);
  // цена сохраняется, если её не передали
  await as('boss').saveItem({ id, sku: 'VVG-3', name: 'Кабель ВВГ', price: 150 });
  await as('boss').saveItem({ id, sku: 'VVG-3', name: 'Кабель ВВГ 3×2,5' });
  assert.equal((await K.getItem(id))!.price, 150);
});
