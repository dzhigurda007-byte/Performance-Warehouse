/**
 * Печатные формы документов (A4, по образцу форм 1С: М-4 «Приходный ордер»,
 * М-11 «Требование-накладная»). Чистые функции: данные → самостоятельный HTML-документ,
 * который печатается отдельно от окна программы или сохраняется в PDF.
 */
import { formatQty } from '../core/codes';
import { STOCK_SORT_LABEL, type StockLine, type StockSort } from '../core/stockTree';
import { CONDITION_LABEL, CUSTODY_STATUS_LABEL, type CustodyRow, type DocLine, type DocumentRow } from '../core/types';
import { esc } from './labelsHtml';
import { CHECK_LABEL, receiptCheck, type PlanRow } from '../core/receiptCheck';

export interface FormContext {
  /** Название организации из настроек. */
  org?: string;
  /** Кто печатает. */
  printedBy?: string;
  /** Дата и время печати; по умолчанию — сейчас. */
  printedAt?: string;
}

export interface AllocationLine {
  user_name: string;
  item_name: string;
  qty: number;
  unit: string;
}

export interface PrintableForm {
  /** Имя файла без расширения, например «Приходный ордер ПО-000012». */
  fileName: string;
  html: string;
}

const q = (n: number) => formatQty(n);
const d = (s: string | null | undefined) => {
  if (!s) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(s);
  return m ? `${m[3]}.${m[2]}.${m[1]}${m[4] ? ` ${m[4]}:${m[5]}` : ''}` : s;
};
const day = (s: string | null | undefined) => d(s).slice(0, 10);

export function nowStamp() {
  const t = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}`;
}

const CSS = `
  @page { size: A4 portrait; margin: 12mm 10mm 14mm 14mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 10pt; color: #000; line-height: 1.25; }
  .topline { display: flex; justify-content: space-between; font-size: 8pt; color: #333; }
  .org { font-size: 11pt; font-weight: 700; margin-top: 2mm; border-bottom: 1px solid #000; padding-bottom: 1mm; }
  .org small { font-weight: 400; font-size: 8pt; color: #333; display: block; }
  h1 { font-size: 14pt; text-align: center; margin: 5mm 0 1mm; letter-spacing: 0.3px; }
  .sub { text-align: center; font-size: 9pt; margin-bottom: 3mm; }
  table { width: 100%; border-collapse: collapse; }
  .head td, .head th { border: 1px solid #000; padding: 1.2mm 2mm; text-align: center; font-size: 9pt; }
  .head th { font-weight: 400; background: #f2f2f2; }
  .meta { margin: 3mm 0; }
  .meta td { padding: 0.6mm 2mm 0.6mm 0; vertical-align: top; }
  .meta td:first-child { width: 38mm; color: #333; white-space: nowrap; }
  .meta td.v { border-bottom: 1px solid #999; }
  .grid { margin-top: 2mm; }
  .grid th, .grid td { border: 1px solid #000; padding: 1mm 1.5mm; vertical-align: top; }
  .grid thead th { background: #f2f2f2; font-weight: 700; font-size: 8.5pt; text-align: center; vertical-align: middle; }
  .grid thead { display: table-header-group; }
  .grid tr { break-inside: avoid; page-break-inside: avoid; }
  .grid .num { text-align: right; white-space: nowrap; }
  .grid .c { text-align: center; }
  .grid .muted { color: #444; font-size: 8.5pt; }
  .grid tfoot td { font-weight: 700; background: #fafafa; }
  .grid .g0 td { background: #e6e6e6; font-weight: 700; }
  .grid .g1 td { background: #efefef; font-weight: 700; }
  .grid .g2 td { background: #f6f6f6; font-weight: 700; }
  .sec { font-weight: 700; margin: 5mm 0 1mm; font-size: 10.5pt; }
  .signs { margin-top: 8mm; display: grid; grid-template-columns: 1fr 1fr; gap: 6mm 12mm; break-inside: avoid; page-break-inside: avoid; }
  .sign .role { font-weight: 700; margin-bottom: 5mm; }
  .sign .line { display: grid; grid-template-columns: 1fr 1fr 1.4fr; gap: 3mm; }
  .sign .line div { border-top: 1px solid #000; font-size: 7pt; text-align: center; color: #333; padding-top: 0.5mm; }
  .sign .name { font-size: 9pt; text-align: right; min-height: 4mm; }
  .footer { margin-top: 6mm; font-size: 7.5pt; color: #555; border-top: 1px solid #ccc; padding-top: 1mm; display: flex; justify-content: space-between; }
`;

function page(title: string, body: string) {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${esc(title)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1"><style>${CSS}</style></head>
<body>${body}</body></html>`;
}

function orgBlock(ctx: FormContext, formNote: string, sub?: string | null) {
  return `<div class="topline"><span>${esc(formNote)}</span><span>Performance Warehouse</span></div>
    <div class="org">${esc(ctx.org || 'Организация')}${sub ? `<small>${esc(sub)}</small>` : ''}</div>`;
}

function footer(ctx: FormContext, extra = '') {
  return `<div class="footer"><span>Напечатано: ${esc(d(ctx.printedAt ?? nowStamp()))}${ctx.printedBy ? ` · ${esc(ctx.printedBy)}` : ''}</span><span>${esc(extra)}</span></div>`;
}

function sign(role: string, name?: string | null) {
  return `<div class="sign"><div class="role">${esc(role)}</div>
    <div class="name">${esc(name ?? '')}</div>
    <div class="line"><div>должность</div><div>подпись</div><div>расшифровка подписи</div></div></div>`;
}

function statusText(doc: DocumentRow) {
  return doc.status === 'posted'
    ? `проведён ${d(doc.posted_at)}${doc.posted_by_name ? `, ${doc.posted_by_name}` : ''}`
    : 'черновик (не проведён)';
}

function metaRows(rows: [string, string | null | undefined][]) {
  return `<table class="meta">${rows
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `<tr><td>${esc(k)}</td><td class="v">${esc(v)}</td></tr>`)
    .join('')}</table>`;
}

const docDate = (doc: DocumentRow) => day(doc.posted_at ?? doc.doc_date);
const totalQty = (lines: { qty: number }[]) => lines.reduce((a, l) => a + l.qty, 0);
const unitsNote = (lines: { unit: string }[]) => {
  const u = [...new Set(lines.map((l) => l.unit))];
  return u.length === 1 ? u[0] : '';
};

// ------------------------------------------------------------------ приходный ордер (М-4)

export function receiptForm(doc: DocumentRow, lines: DocLine[], ctx: FormContext = {}, plan: PlanRow[] = []): PrintableForm {
  if (plan.length) return receiptTaskForm(doc, lines, plan, ctx);
  const isReturn = doc.source === 'return';
  const title = isReturn ? 'Приходный ордер (возврат ТМЦ)' : 'Приходный ордер';
  const rows = lines.map((l, i) => `<tr>
      <td class="c">${i + 1}</td>
      <td>${esc(l.item_name)}${l.barcode ? `<div class="muted">ШК ${esc(l.barcode)}</div>` : ''}</td>
      <td class="c">${esc(l.sku)}</td>
      <td class="c">${esc(l.unit)}</td>
      <td class="num">${q(l.qty)}</td>
      <td class="num">${doc.status === 'posted' && (!isReturn || l.accept) ? q(l.qty) : ''}</td>
      ${isReturn
        ? `<td>${esc(l.custody_code ?? '')}</td><td>${esc(l.condition ? CONDITION_LABEL[l.condition] : '')}${l.note ? `<div class="muted">«${esc(l.note)}»</div>` : ''}${!l.accept ? '<div class="muted">не принимается на склад</div>' : ''}</td>`
        : `<td>${esc(l.address ?? (l.box_code ? '' : 'буферная ячейка'))}${l.box_code ? `<div class="muted">короб ${esc(l.box_code)}</div>` : ''}</td>`}
    </tr>`).join('');
  const body = `
    ${orgBlock(ctx, 'Форма по образцу М-4', doc.warehouse_name ? `Склад: ${doc.warehouse_name}` : null)}
    <h1>${esc(title.toUpperCase())} № ${esc(doc.number)}</h1>
    <table class="head"><tr><th>Дата составления</th><th>Вид операции</th><th>Склад</th><th>${isReturn ? 'Основание' : 'Поставщик'}</th></tr>
      <tr><td>${esc(docDate(doc))}</td><td>${isReturn ? 'Возврат от сотрудника' : doc.source === 'excel' ? 'Поступление (Excel)' : 'Поступление'}</td>
      <td>${esc(doc.warehouse_name ?? '—')}</td><td>${esc(isReturn ? (doc.base_doc_number ? `Расходный ордер № ${doc.base_doc_number}` : '—') : (doc.partner ?? '—'))}</td></tr></table>
    ${metaRows([['Составил', doc.created_by_name], ['Статус', statusText(doc)], ['Комментарий', doc.comment]])}
    <table class="grid"><thead>
      <tr><th rowspan="2" style="width:7mm">№</th><th colspan="2">Материальные ценности</th><th rowspan="2" style="width:13mm">Ед. изм.</th>
        <th colspan="2">Количество</th>${isReturn ? '<th rowspan="2">Инв. номер</th><th rowspan="2">Состояние / отметки</th>' : '<th rowspan="2">Место хранения</th>'}</tr>
      <tr><th>наименование</th><th style="width:26mm">артикул</th><th style="width:17mm">по документу</th><th style="width:17mm">принято</th></tr>
    </thead><tbody>${rows}</tbody>
    <tfoot><tr><td colspan="4">Итого: ${lines.length} поз.</td><td class="num">${q(totalQty(lines))} ${esc(unitsNote(lines))}</td><td class="num">${doc.status === 'posted' ? `${q(totalQty(lines.filter((l) => !isReturn || l.accept)))} ${esc(unitsNote(lines))}` : ''}</td><td${isReturn ? ' colspan="2"' : ''}></td></tr></tfoot></table>
    <div class="signs">${sign('Принял (кладовщик)', doc.posted_by_name)}${sign(isReturn ? 'Сдал (сотрудник)' : 'Сдал (поставщик / экспедитор)')}</div>
    ${footer(ctx, `${title} № ${doc.number}`)}`;
  return { fileName: `${title} ${doc.number}`, html: page(`${title} № ${doc.number}`, body) };
}

/** Приходный ордер по заданию на приёмку: по документу — план, принято — факт, отклонение. */
function receiptTaskForm(doc: DocumentRow, lines: DocLine[], plan: PlanRow[], ctx: FormContext): PrintableForm {
  const title = 'Приходный ордер';
  const chk = receiptCheck(plan, lines);
  const rows = chk.rows.map((x, i) => `<tr>
      <td class="c">${i + 1}</td>
      <td>${esc(x.item_name)}${x.barcode ? `<div class="muted">ШК ${esc(x.barcode)}</div>` : ''}</td>
      <td class="c">${esc(x.sku)}</td>
      <td class="c">${esc(x.unit)}</td>
      <td class="num">${x.plan ? q(x.plan) : '—'}</td>
      <td class="num">${q(x.fact)}</td>
      <td class="num">${x.diff ? (x.diff > 0 ? '+' : '') + q(x.diff) : ''}</td>
      <td>${x.status === 'ok' ? 'сошлось' : esc(CHECK_LABEL[x.status].toLowerCase())}</td>
    </tr>`).join('');
  const body = `
    ${orgBlock(ctx, 'Форма по образцу М-4', doc.warehouse_name ? `Склад: ${doc.warehouse_name}` : null)}
    <h1>${esc(title.toUpperCase())} № ${esc(doc.number)}</h1>
    <div class="sub">по заданию на приёмку · товар размещён в буферной ячейке склада</div>
    <table class="head"><tr><th>Дата составления</th><th>Вид операции</th><th>Склад</th><th>Поставщик</th></tr>
      <tr><td>${esc(docDate(doc))}</td><td>Поступление по заданию</td><td>${esc(doc.warehouse_name ?? '—')}</td><td>${esc(doc.partner ?? '—')}</td></tr></table>
    ${metaRows([['Составил', doc.created_by_name], ['Статус', statusText(doc)],
      ['Итог сверки', `сошлось ${chk.ok}, недостача ${chk.short}, излишек ${chk.over}, нет в задании ${chk.extra}`], ['Комментарий', doc.comment]])}
    <table class="grid"><thead>
      <tr><th rowspan="2" style="width:7mm">№</th><th colspan="2">Материальные ценности</th><th rowspan="2" style="width:12mm">Ед. изм.</th>
        <th colspan="3">Количество</th><th rowspan="2" style="width:24mm">Результат</th></tr>
      <tr><th>наименование</th><th style="width:24mm">артикул</th><th style="width:16mm">по документу</th><th style="width:16mm">принято</th><th style="width:16mm">отклонение</th></tr>
    </thead><tbody>${rows}</tbody>
    <tfoot><tr><td colspan="4">Итого: ${chk.rows.length} поз.</td><td class="num">${q(chk.plan)}</td><td class="num">${q(chk.fact)}</td>
      <td class="num">${chk.fact !== chk.plan ? (chk.fact > chk.plan ? '+' : '') + q(chk.fact - chk.plan) : ''}</td><td></td></tr></tfoot></table>
    <div class="signs">${sign('Принял (кладовщик)', doc.posted_by_name)}${sign('Сдал (поставщик / экспедитор)')}</div>
    ${footer(ctx, `${title} № ${doc.number}`)}`;
  return { fileName: `${title} ${doc.number}`, html: page(`${title} № ${doc.number}`, body) };
}

// ------------------------------------------------------------------ расходный ордер / требование-накладная (М-11)

export function issueForm(
  doc: DocumentRow, lines: DocLine[], ctx: FormContext = {},
  extra: { allocations?: AllocationLine[]; custody?: CustodyRow[] } = {},
): PrintableForm {
  const mode = doc.post_mode === 'writeoff' ? 'Отпуск со склада' : doc.post_mode === 'custody' ? 'Выдача под ответственность' : doc.status === 'draft' ? 'Заявка / лист подбора' : 'Отпуск';
  const title = 'Расходный ордер';
  const pick = doc.status === 'draft';
  const rows = lines.map((l, i) => `<tr>
      <td class="c">${i + 1}</td>
      <td>${esc(l.item_name)}${l.custody_code ? `<div class="muted">инв. № ${esc(l.custody_code)}</div>` : ''}</td>
      <td class="c">${esc(l.sku)}</td>
      <td class="c">${esc(l.unit)}</td>
      <td class="num">${q(l.qty)}</td>
      <td class="num">${doc.status === 'posted' ? q(l.qty) : ''}</td>
      <td>${esc(l.address ?? '—')}${l.box_code ? `<div class="muted">короб ${esc(l.box_code)}</div>` : ''}${l.received_at ? `<div class="muted">приёмка ${esc(day(l.received_at))}</div>` : ''}</td>
      ${pick ? '<td class="c" style="font-size:12pt">☐</td>' : ''}
    </tr>`).join('');

  let recipients = '';
  if (extra.custody?.length) {
    const byHolder = new Map<string, CustodyRow[]>();
    for (const k of extra.custody) byHolder.set(k.holder_name, [...(byHolder.get(k.holder_name) ?? []), k]);
    recipients = `<div class="sec">Выдано под ответственность (${byHolder.size} чел.)</div>
      <table class="grid"><thead><tr><th style="width:7mm">№</th><th>Получатель</th><th>ТМЦ</th><th style="width:28mm">Инв. номер</th><th style="width:18mm">Кол-во</th><th style="width:30mm">Подпись получателя</th></tr></thead><tbody>
      ${[...byHolder.entries()].map(([holder, list], i) => list.map((k, j) => `<tr>
        ${j === 0 ? `<td class="c" rowspan="${list.length}">${i + 1}</td><td rowspan="${list.length}">${esc(holder)}</td>` : ''}
        <td>${esc(k.item_name)}</td><td class="c">${esc(k.code)}</td><td class="num">${q(k.qty)} ${esc(k.unit)}</td>
        ${j === 0 ? `<td rowspan="${list.length}"></td>` : ''}</tr>`).join('')).join('')}
      </tbody></table>`;
  } else if (extra.allocations?.length) {
    recipients = `<div class="sec">Распределение по получателям</div>
      <table class="grid"><thead><tr><th style="width:7mm">№</th><th>Получатель</th><th>ТМЦ</th><th style="width:22mm">Кол-во</th><th style="width:30mm">Подпись</th></tr></thead><tbody>
      ${extra.allocations.map((a, i) => `<tr><td class="c">${i + 1}</td><td>${esc(a.user_name)}</td><td>${esc(a.item_name)}</td><td class="num">${q(a.qty)} ${esc(a.unit)}</td><td></td></tr>`).join('')}
      </tbody></table>`;
  }

  const body = `
    ${orgBlock(ctx, 'Форма по образцу М-11 (требование-накладная)', null)}
    <h1>${esc(title.toUpperCase())} № ${esc(doc.number)}</h1>
    <div class="sub">${esc(mode)}</div>
    <table class="head"><tr><th>Дата составления</th><th>Вид операции</th><th>Отправитель</th><th>Получатель</th></tr>
      <tr><td>${esc(docDate(doc))}</td><td>${esc(mode)}</td><td>Склад${doc.warehouse_name ? ` «${esc(doc.warehouse_name)}»` : ''}</td>
      <td>${esc(doc.recipient || (extra.custody?.length ? 'см. список ниже' : '—'))}</td></tr></table>
    ${metaRows([['Основание', doc.partner], ['Затребовал', doc.created_by_name], ['Статус', statusText(doc)], ['Комментарий', doc.comment]])}
    <table class="grid"><thead>
      <tr><th rowspan="2" style="width:7mm">№</th><th colspan="2">Материальные ценности</th><th rowspan="2" style="width:13mm">Ед. изм.</th>
        <th colspan="2">Количество</th><th rowspan="2" style="width:42mm">Место хранения</th>${pick ? '<th rowspan="2" style="width:8mm">✓</th>' : ''}</tr>
      <tr><th>наименование</th><th style="width:26mm">артикул</th><th style="width:17mm">затребовано</th><th style="width:17mm">отпущено</th></tr>
    </thead><tbody>${rows}</tbody>
    <tfoot><tr><td colspan="4">Итого: ${lines.length} поз.</td><td class="num">${q(totalQty(lines))} ${esc(unitsNote(lines))}</td><td class="num">${doc.status === 'posted' ? `${q(totalQty(lines))} ${esc(unitsNote(lines))}` : ''}</td><td${pick ? ' colspan="2"' : ''}></td></tr></tfoot></table>
    ${recipients}
    <div class="signs">${sign('Отпустил (кладовщик)', doc.posted_by_name)}${sign('Получил', extra.custody?.length ? '' : doc.recipient)}
      ${sign('Затребовал', doc.created_by_name)}${sign('Разрешил (руководитель)')}</div>
    ${footer(ctx, `${title} № ${doc.number}`)}`;
  return { fileName: `${title} ${doc.number}`, html: page(`${title} № ${doc.number}`, body) };
}

// ------------------------------------------------------------------ перемещение

export function moveForm(doc: DocumentRow, lines: DocLine[], ctx: FormContext = {}): PrintableForm {
  const title = 'Накладная на перемещение';
  const rows = lines.map((l, i) => `<tr>
      <td class="c">${i + 1}</td><td>${esc(l.item_name)}</td><td class="c">${esc(l.sku)}</td><td class="c">${esc(l.unit)}</td>
      <td class="num">${q(l.qty)}</td>
      <td>${esc(l.address ?? '—')}${l.box_code ? `<div class="muted">короб ${esc(l.box_code)}</div>` : ''}</td>
      <td>${esc(l.to_address ?? '—')}</td>
      <td class="c">${esc(day(l.received_at))}</td></tr>`).join('');
  const body = `
    ${orgBlock(ctx, 'Внутреннее перемещение', doc.warehouse_name ? `Склад: ${doc.warehouse_name}` : null)}
    <h1>${esc(title.toUpperCase())} № ${esc(doc.number)}</h1>
    ${metaRows([['Дата', d(doc.posted_at ?? doc.doc_date)], ['Выполнил', doc.posted_by_name ?? doc.created_by_name], ['Комментарий', doc.comment]])}
    <table class="grid"><thead><tr><th style="width:7mm">№</th><th>Наименование</th><th style="width:24mm">Артикул</th><th style="width:12mm">Ед.</th>
      <th style="width:16mm">Кол-во</th><th>Откуда</th><th>Куда</th><th style="width:20mm">Приёмка</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td colspan="4">Итого: ${lines.length} поз.</td><td class="num">${q(totalQty(lines))}</td><td colspan="3"></td></tr></tfoot></table>
    <div class="signs">${sign('Переместил', doc.posted_by_name ?? doc.created_by_name)}${sign('Проверил')}</div>
    ${footer(ctx, `${title} № ${doc.number}`)}`;
  return { fileName: `${title} ${doc.number}`, html: page(`${title} № ${doc.number}`, body) };
}

export function documentForm(
  doc: DocumentRow, lines: DocLine[], ctx: FormContext = {},
  extra: { allocations?: AllocationLine[]; custody?: CustodyRow[]; plan?: PlanRow[] } = {},
): PrintableForm {
  if (doc.type === 'issue') return issueForm(doc, lines, ctx, extra);
  if (doc.type === 'move') return moveForm(doc, lines, ctx);
  return receiptForm(doc, lines, ctx, extra.plan);
}

// ------------------------------------------------------------------ ведомость остатков

export function stockReportForm(
  lines: StockLine[],
  ctx: FormContext & { warehouse?: string | null; filters?: string[]; sort?: StockSort; withLots?: boolean } = {},
): PrintableForm {
  const title = 'Ведомость остатков ТМЦ';
  const items = lines.filter((l) => l.kind === 'item');
  let n = 0;
  const rows = lines.map((l) => {
    if (l.kind === 'group') {
      const g = l.node;
      const pad = 2 + g.depth * 4;
      return `<tr class="g${Math.min(g.depth, 2)}"><td colspan="3" style="padding-left:${pad}mm">${esc(g.name)}</td>
        <td class="num">${g.units.length === 1 ? `${q(g.qty)} ${esc(g.units[0])}` : ''}</td><td class="c">${g.items} поз.</td><td></td></tr>`;
    }
    const it = l.node;
    n++;
    const lots = ctx.withLots
      ? it.lots.map((s) => `<div class="muted">${esc(s.address ?? '—')}${s.box_code ? `, короб ${esc(s.box_code)}` : ''} — ${q(s.qty)} (${esc(day(s.received_at))})</div>`).join('')
      : '';
    return `<tr><td class="c">${n}</td>
      <td style="padding-left:${2 + l.depth * 4}mm">${esc(it.name)}${lots}</td>
      <td class="c">${esc(it.sku)}</td>
      <td class="num">${q(it.qty)} ${esc(it.unit)}</td>
      <td class="c">${esc(day(it.first))}${it.last !== it.first ? `<br>— ${esc(day(it.last))}` : ''}</td>
      <td class="c">${it.lots.length}</td></tr>`;
  }).join('');
  const body = `
    ${orgBlock(ctx, 'Отчёт', ctx.warehouse ? `Склад: ${ctx.warehouse}` : 'Все склады')}
    <h1>${esc(title.toUpperCase())}</h1>
    <div class="sub">на ${esc(d(ctx.printedAt ?? nowStamp()))}</div>
    ${metaRows([
      ['Отбор', ctx.filters?.length ? ctx.filters.join('; ') : 'без отбора'],
      ['Сортировка', ctx.sort ? STOCK_SORT_LABEL[ctx.sort] : undefined],
    ])}
    <table class="grid"><thead><tr><th style="width:9mm">№</th><th>Группа / наименование</th><th style="width:26mm">Артикул</th>
      <th style="width:24mm">Остаток</th><th style="width:24mm">Дата приёмки</th><th style="width:14mm">Партий</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="6" class="c">Нет остатков по заданному отбору</td></tr>'}</tbody>
    <tfoot><tr><td colspan="3">Итого наименований: ${items.length}</td><td class="num">${(() => {
      const u = [...new Set(items.map((i) => (i.kind === 'item' ? i.node.unit : '')))];
      return u.length === 1 ? `${q(items.reduce((a, i) => a + (i.kind === 'item' ? i.node.qty : 0), 0))} ${esc(u[0])}` : '';
    })()}</td><td colspan="2"></td></tr></tfoot></table>
    <div class="signs">${sign('Ответственное лицо (кладовщик)', ctx.printedBy)}${sign('Проверил')}</div>
    ${footer(ctx, title)}`;
  return { fileName: `${title} ${day(ctx.printedAt ?? nowStamp())}`, html: page(title, body) };
}

// ------------------------------------------------------------------ произвольный табличный отчёт (выдачи, история)

export interface TableColumn<T> {
  title: string;
  width?: string;
  align?: 'left' | 'right' | 'center';
  value: (row: T) => string;
}

export function tableReport<T>(
  title: string, columns: TableColumn<T>[], rows: T[],
  ctx: FormContext & { subtitle?: string; meta?: [string, string | null | undefined][]; signs?: string[] } = {},
): PrintableForm {
  const cls = (c: TableColumn<T>) => (c.align === 'right' ? 'num' : c.align === 'center' ? 'c' : '');
  const body = `
    ${orgBlock(ctx, 'Отчёт', ctx.subtitle)}
    <h1>${esc(title.toUpperCase())}</h1>
    <div class="sub">на ${esc(d(ctx.printedAt ?? nowStamp()))}</div>
    ${ctx.meta ? metaRows(ctx.meta) : ''}
    <table class="grid"><thead><tr><th style="width:8mm">№</th>${columns.map((c) => `<th${c.width ? ` style="width:${c.width}"` : ''}>${esc(c.title)}</th>`).join('')}</tr></thead>
    <tbody>${rows.length
      ? rows.map((r, i) => `<tr><td class="c">${i + 1}</td>${columns.map((c) => `<td class="${cls(c)}">${esc(c.value(r))}</td>`).join('')}</tr>`).join('')
      : `<tr><td colspan="${columns.length + 1}" class="c">Нет данных</td></tr>`}</tbody>
    <tfoot><tr><td colspan="${columns.length + 1}">Всего строк: ${rows.length}</td></tr></tfoot></table>
    ${ctx.signs?.length ? `<div class="signs">${ctx.signs.map((s) => sign(s)).join('')}</div>` : ''}
    ${footer(ctx, title)}`;
  return { fileName: `${title} ${day(ctx.printedAt ?? nowStamp())}`, html: page(title, body) };
}

/** Список ТМЦ на руках (вкладка «Выдачи»). */
export function custodyListForm(list: CustodyRow[], title: string, ctx: FormContext & { subtitle?: string } = {}): PrintableForm {
  return tableReport(title, [
    { title: 'Инв. номер', width: '26mm', value: (k) => k.code },
    { title: 'ТМЦ', value: (k) => `${k.item_name} (${k.sku})` },
    { title: 'Кол-во', width: '18mm', align: 'right', value: (k) => `${q(k.qty)} ${k.unit}` },
    { title: 'У кого', value: (k) => k.holder_name },
    { title: 'Выдал', value: (k) => k.issued_by_name },
    { title: 'Дата выдачи', width: '22mm', align: 'center', value: (k) => day(k.issued_at) },
    { title: 'Состояние', width: '26mm', value: (k) => (k.status === 'held' ? 'на руках'
      : `${CUSTODY_STATUS_LABEL[k.status].toLowerCase()} ${day(k.returned_at)}${k.return_condition ? `, ${CONDITION_LABEL[k.return_condition].toLowerCase()}` : ''}`) },
  ], list, { ...ctx, signs: ['Ответственное лицо'] });
}
