import { formatQty } from '../../core/codes';
import { round3 } from '../../core/db';
import { ORDER_TITLE, type Order, type OrderLine, type WarehouseInfo } from './service';

/**
 * Печатная форма приходного / расходного ордера (A4, книжная) — из неё делается PDF,
 * который отправляется кнопкой «Поделиться» в мессенджер или на почту.
 */
export function esc(s: string | null | undefined) {
  return (s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

export function ruDate(s: string | null | undefined, withTime = false) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(s ?? '');
  if (!m) return s ?? '';
  return `${m[3]}.${m[2]}.${m[1]}${withTime && m[4] ? ` ${m[4]}:${m[5]}` : ''}`;
}

export function orderFileName(o: Pick<Order, 'type' | 'number' | 'doc_date'>) {
  return `${ORDER_TITLE[o.type]} ${o.number} от ${ruDate(o.doc_date)}`;
}

export function orderHtml(o: Order, lines: OrderLine[], wh: WarehouseInfo): string {
  const isReceipt = o.type === 'receipt';
  const total = round3(lines.reduce((s, l) => s + l.qty, 0));
  const rows = lines.map((l, i) => `
    <tr>
      <td class="c">${i + 1}</td>
      <td>${esc(l.article)}</td>
      <td>${esc(l.name)}</td>
      <td>${esc(l.spp)}</td>
      <td class="c">${esc(l.cell_code)}</td>
      <td class="r">${formatQty(l.qty)}</td>
      <td class="c">${esc(l.unit)}</td>
    </tr>`).join('');
  const sign = (label: string, name = '') => `
    <div class="sig"><span class="sl">${label}</span><span class="line"></span><span class="nm">${esc(name)}</span></div>`;
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<title>${esc(orderFileName(o))}</title>
<style>
  @page { size: A4 portrait; margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 11pt; color: #000; margin: 0; }
  h1 { font-size: 16pt; text-align: center; margin: 0 0 4px; }
  .sub { text-align: center; margin-bottom: 14px; }
  .draft { text-align: center; color: #B42318; font-size: 10pt; margin-top: -8px; margin-bottom: 10px; }
  table.head { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  table.head td { padding: 3px 0; vertical-align: top; }
  table.head td.k { width: 32%; color: #333; }
  table.lines { width: 100%; border-collapse: collapse; }
  table.lines th, table.lines td { border: 1px solid #000; padding: 4px 5px; font-size: 10pt; }
  table.lines th { background: #EEE; font-weight: bold; text-align: center; }
  td.c { text-align: center; } td.r { text-align: right; white-space: nowrap; }
  tr.tot td { font-weight: bold; }
  thead { display: table-header-group; } tr { page-break-inside: avoid; }
  .sigs { margin-top: 28px; display: flex; gap: 24px; }
  .sig { flex: 1; display: flex; align-items: flex-end; gap: 6px; }
  .sl { white-space: nowrap; } .line { flex: 1; border-bottom: 1px solid #000; height: 18px; }
  .nm { white-space: nowrap; font-size: 10pt; }
  .foot { margin-top: 18px; font-size: 8pt; color: #666; }
</style></head><body>
  <h1>${isReceipt ? 'ПРИХОДНЫЙ ОРДЕР' : 'РАСХОДНЫЙ ОРДЕР'} № ${esc(o.number)}</h1>
  <div class="sub">от ${ruDate(o.doc_date, true)}</div>
  ${o.status === 'posted' ? '' : '<div class="draft">не проведён</div>'}
  <table class="head">
    <tr><td class="k">Склад</td><td><b>${esc(wh.name)}</b>${wh.address ? `, ${esc(wh.address)}` : ''}</td></tr>
    <tr><td class="k">${isReceipt ? 'Поставщик (от кого)' : 'Получатель (кому)'}</td><td>${esc(o.partner) || '—'}</td></tr>
    ${o.comment ? `<tr><td class="k">Комментарий</td><td>${esc(o.comment)}</td></tr>` : ''}
  </table>
  <table class="lines">
    <thead><tr><th style="width:6%">№</th><th style="width:16%">Артикул</th><th>Наименование</th>
      <th style="width:14%">SPP номер</th><th style="width:11%">Ячейка</th><th style="width:10%">Кол-во</th><th style="width:7%">Ед.</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="7" class="c">Нет товаров</td></tr>'}
      <tr class="tot"><td colspan="5" class="r">Итого: ${lines.length} поз.</td><td class="r">${formatQty(total)}</td><td></td></tr>
    </tbody>
  </table>
  <div class="sigs">
    ${isReceipt ? sign('Сдал') + sign('Принял', wh.person) : sign('Отпустил', wh.person) + sign('Получил')}
  </div>
  <div class="foot">Сформировано в PerformanceWarehouseLite${o.posted_at ? ` · проведён ${ruDate(o.posted_at, true)}` : ''}</div>
</body></html>`;
}
