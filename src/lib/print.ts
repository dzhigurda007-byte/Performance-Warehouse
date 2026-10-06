import * as Print from 'expo-print';
import { formatQty } from '../core/codes';
import type { DocLine, DocumentRow } from '../core/types';
import { qrSvg } from './qr';

export interface Label {
  qr: string;
  title: string;
  subtitle?: string;
}

function esc(s: string | null | undefined) {
  return (s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/**
 * Этикетки с QR-кодами: сетка на листе A4 (3 колонки). Печать через системный
 * диалог (AirPrint / Android Print) или «Сохранить как PDF» для термопринтера.
 */
export async function printLabels(labels: Label[]) {
  const cells = labels
    .map(
      (l) => `
      <div class="lbl">
        <div class="qr">${qrSvg(l.qr, 4, 1)}</div>
        <div class="t">${esc(l.title)}</div>
        ${l.subtitle ? `<div class="s">${esc(l.subtitle)}</div>` : ''}
      </div>`,
    )
    .join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { margin: 8mm; }
    body { font-family: -apple-system, Roboto, Arial, sans-serif; margin: 0; }
    .grid { display: flex; flex-wrap: wrap; }
    .lbl { width: 31%; margin: 1%; border: 1px dashed #999; padding: 6px; box-sizing: border-box;
           text-align: center; page-break-inside: avoid; }
    .qr svg { width: 42mm; height: 42mm; }
    .t { font-size: 15px; font-weight: 700; margin-top: 2px; }
    .s { font-size: 11px; color: #444; }
  </style></head><body><div class="grid">${cells}</div></body></html>`;
  await Print.printAsync({ html });
}

const TITLES = { receipt: 'Приходный ордер', issue: 'Расходный ордер', move: 'Перемещение' } as const;

/**
 * Печатная форма ордера. Для расходного ордера строки отсортированы по адресу
 * хранения — документ одновременно служит листом подбора (pick list).
 */
export async function printDocument(doc: DocumentRow, lines: DocLine[]) {
  const isIssue = doc.type === 'issue';
  const rows = lines
    .map(
      (l, i) => `<tr>
        <td>${i + 1}</td>
        <td>${esc(l.address ?? '—')}${l.box_code ? `<br><b>Короб ${esc(l.box_code)}</b>` : ''}</td>
        <td>${esc(l.sku)}</td>
        <td>${esc(l.item_name)}</td>
        <td class="n">${formatQty(l.qty)}</td>
        <td>${esc(l.unit)}</td>
        ${isIssue ? '<td class="chk">☐</td>' : ''}
      </tr>`,
    )
    .join('');
  const total = lines.reduce((a, l) => a + l.qty, 0);
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    body { font-family: -apple-system, Roboto, Arial, sans-serif; font-size: 12px; margin: 16px; }
    h1 { font-size: 18px; margin: 0 0 4px; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th, td { border: 1px solid #555; padding: 4px 6px; vertical-align: top; }
    th { background: #eee; }
    .n { text-align: right; } .chk { text-align: center; font-size: 16px; }
    .meta td { border: none; padding: 1px 6px 1px 0; }
    .sign { margin-top: 32px; display: flex; justify-content: space-between; }
    .sign div { width: 45%; border-top: 1px solid #000; padding-top: 2px; font-size: 11px; }
  </style></head><body>
    <h1>${TITLES[doc.type]} № ${esc(doc.number)}</h1>
    <table class="meta">
      <tr><td>Дата:</td><td>${esc(doc.posted_at ?? doc.doc_date)}</td></tr>
      ${doc.type === 'receipt' ? `<tr><td>Поставщик:</td><td>${esc(doc.partner ?? '—')}</td></tr>` : ''}
      ${isIssue ? `<tr><td>Получатель:</td><td>${esc(doc.recipient ?? '—')}</td></tr>` : ''}
      ${isIssue ? `<tr><td>Основание:</td><td>${esc(doc.partner ?? '—')}</td></tr>` : ''}
      <tr><td>Составил:</td><td>${esc(doc.created_by_name)}</td></tr>
      <tr><td>Статус:</td><td>${doc.status === 'posted' ? `Проведён (${esc(doc.posted_by_name)})` : 'Черновик'}</td></tr>
      ${doc.comment ? `<tr><td>Комментарий:</td><td>${esc(doc.comment)}</td></tr>` : ''}
    </table>
    <table>
      <tr><th>№</th><th>Место хранения</th><th>Артикул</th><th>Наименование</th><th>Кол-во</th><th>Ед.</th>${isIssue ? '<th>✓</th>' : ''}</tr>
      ${rows}
      <tr><td colspan="4"><b>Итого позиций: ${lines.length}</b></td><td class="n"><b>${formatQty(total)}</b></td><td></td>${isIssue ? '<td></td>' : ''}</tr>
    </table>
    <div class="sign">
      <div>${isIssue ? 'Отпустил' : 'Принял'} (кладовщик)</div>
      <div>${isIssue ? 'Получил' : 'Сдал'}</div>
    </div>
  </body></html>`;
  await Print.printAsync({ html });
}
