import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allocate } from '../src/core/allocation';
import { boxQr, cellQr, rackQr, formatBoxCode, formatDocNumber, itemQr, parseQty, parseScan } from '../src/core/codes';

test('QR-коды разбираются обратно в сущности', () => {
  assert.deepEqual(parseScan(cellQr(15)), { kind: 'cell', id: 15 });
  assert.deepEqual(parseScan(rackQr(4)), { kind: 'rack', id: 4 });
  assert.deepEqual(parseScan(boxQr('BX-000007')), { kind: 'box', code: 'BX-000007' });
  assert.deepEqual(parseScan(itemQr('TM-00001')), { kind: 'item', sku: 'TM-00001' });
  assert.deepEqual(parseScan(' pw:c:3 '), { kind: 'cell', id: 3 });
  assert.deepEqual(parseScan('4601234567893'), { kind: 'raw', value: '4601234567893' });
  assert.deepEqual(parseScan('PW:C:abc'), { kind: 'raw', value: 'PW:C:abc' });
});

test('форматирование номеров', () => {
  assert.equal(formatBoxCode(12), 'BX-000012');
  assert.equal(formatDocNumber('issue', 5), 'РО-000005');
  assert.equal(formatDocNumber('receipt', 123), 'ПО-000123');
});

test('ввод количества', () => {
  assert.equal(parseQty('2,5'), 2.5);
  assert.equal(parseQty('0'), null);
  assert.equal(parseQty('abc'), null);
  assert.equal(parseQty('-1'), null);
});

test('FIFO-подбор: сначала старые партии, при равной дате — россыпь раньше коробов', () => {
  const sources = [
    { item_id: 1, cell_id: null, box_id: 7, qty: 10, first_in_at: '2026-01-01 10:00:00' },
    { item_id: 1, cell_id: 3, box_id: null, qty: 4, first_in_at: '2026-01-01 10:00:00' },
    { item_id: 1, cell_id: 9, box_id: null, qty: 5, first_in_at: '2025-12-01 10:00:00' },
  ];
  const r = allocate(sources, 12);
  assert.equal(r.shortage, 0);
  assert.deepEqual(r.picks, [
    { cell_id: 9, box_id: null, qty: 5 },
    { cell_id: 3, box_id: null, qty: 4 },
    { cell_id: null, box_id: 7, qty: 3 },
  ]);
});

test('подбор учитывает уже зарезервированное и считает нехватку', () => {
  const sources = [{ item_id: 1, cell_id: 3, box_id: null, qty: 4, first_in_at: '2026-01-01' }];
  const r = allocate(sources, 5, new Map([['c3', 3]]));
  assert.deepEqual(r.picks, [{ cell_id: 3, box_id: null, qty: 1 }]);
  assert.equal(r.shortage, 4);
});

test('адрес сервера: локальная сеть — http и порт 8080, домен — https', async () => {
  const { normalizeServerUrl } = await import('../src/lib/remote');
  assert.equal(normalizeServerUrl('192.168.1.10'), 'http://192.168.1.10:8080');
  assert.equal(normalizeServerUrl('192.168.1.10:9000'), 'http://192.168.1.10:9000');
  assert.equal(normalizeServerUrl('localhost'), 'http://localhost:8080');
  assert.equal(normalizeServerUrl('sklad.example.ru'), 'https://sklad.example.ru');
  assert.equal(normalizeServerUrl('https://sklad.example.ru/'), 'https://sklad.example.ru');
  assert.equal(normalizeServerUrl('http://sklad.example.ru:8080'), 'http://sklad.example.ru:8080');
  assert.equal(normalizeServerUrl('sklad.example.ru:8443'), 'https://sklad.example.ru:8443');
});
