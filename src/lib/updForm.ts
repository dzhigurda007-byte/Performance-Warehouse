/**
 * Печатная форма УПД (универсальный передаточный документ) — по образцу рекомендованной ФНС формы:
 * шапка счёта-фактуры, табличная часть со стоимостью и НДС, подписи, блок передачи / приёмки.
 */
import { formatQty } from '../core/codes';
import type { DocumentRow } from '../core/types';
import { VAT_LABEL, money, updTotals, type UpdData } from '../core/upd';
import { nowStamp, type FormContext, type PrintableForm } from './docForms';
import { esc } from './labelsHtml';

export interface UpdSeller {
  name: string;
  inn: string;
  kpp: string;
  address: string;
  director: string;
  accountant: string;
}

const ruDate = (s: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s ?? '');
  return m ? `${m[3]}.${m[2]}.${m[1]}` : s ?? '';
};
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const longDate = (s: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s ?? '');
  return m ? `«${m[3]}» ${MONTHS[Number(m[2]) - 1]} ${m[1]} г.` : s ?? '';
};

const CSS = `
  @page { size: A4 landscape; margin: 8mm 8mm 8mm 10mm; }
  /* на экране — всегда ширина альбомного листа: форма не сжимается в узком окне, появляется прокрутка */
  @media screen { body { min-width: 279mm; } }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 7.5pt; color: #000; line-height: 1.2; }
  .top { display: grid; grid-template-columns: 34mm 1fr; border-bottom: 1.5px solid #000; }
  .status { border-right: 1.5px solid #000; padding: 1mm 2mm 1mm 0; }
  .status b { font-size: 9.5pt; display: block; margin-bottom: 1mm; }
  .status .box { display: inline-block; border: 1px solid #000; padding: 0.5mm 2mm; font-weight: 700; font-size: 9pt; }
  .hdr { padding-left: 2mm; }
  .hdr .title { display: flex; justify-content: space-between; align-items: flex-start; }
  .hdr .title b { font-size: 9.5pt; }
  .hdr .note { font-size: 6pt; text-align: right; max-width: 70mm; }
  .req { width: 100%; border-collapse: collapse; margin-top: 0.5mm; }
  .req td { padding: 0.3mm 1mm; vertical-align: bottom; }
  .req td.k { white-space: nowrap; width: 1%; }
  .req td.v { border-bottom: 1px solid #000; }
  .req td.n { width: 6mm; text-align: center; font-size: 6.5pt; }
  table.g { width: 100%; border-collapse: collapse; margin-top: 1.5mm; }
  table.g th, table.g td { border: 1px solid #000; padding: 0.6mm 0.8mm; vertical-align: top; }
  table.g th { font-weight: 400; font-size: 6.3pt; text-align: center; vertical-align: middle; }
  table.g td.num { text-align: right; white-space: nowrap; }
  table.g td.c { text-align: center; }
  table.g tr.idx th { font-size: 6pt; padding: 0.2mm; }
  table.g tr.tot td { font-weight: 700; }
  table.g thead { display: table-header-group; }
  table.g tr { break-inside: avoid; page-break-inside: avoid; }
  .signs { display: grid; grid-template-columns: 1fr 1fr; gap: 0 8mm; margin-top: 1mm; break-inside: avoid; page-break-inside: avoid; }
  .sg { display: grid; grid-template-columns: auto 22mm 1fr; gap: 0 2mm; align-items: end; margin-top: 1mm; }
  .sg .l { font-size: 7pt; }
  .sg .line { border-bottom: 1px solid #000; min-height: 4mm; text-align: center; }
  .sg .cap { grid-column: 2 / span 2; display: grid; grid-template-columns: 22mm 1fr; gap: 0 2mm; font-size: 5.5pt; text-align: center; color: #333; }
  .bottom { display: grid; grid-template-columns: 1fr 1fr; border-top: 1.5px solid #000; margin-top: 1.5mm; padding-top: 0.5mm; break-inside: avoid; page-break-inside: avoid; font-size: 7pt; }
  .bottom > div:first-child { border-right: 1.5px solid #000; padding-right: 3mm; }
  .bottom > div:last-child { padding-left: 3mm; }
  .lb { margin-top: 0.8mm; }
  .fld { display: grid; grid-template-columns: 1fr 6mm; gap: 1mm; align-items: end; margin-top: 0.2mm; }
  .fld .v { border-bottom: 1px solid #000; min-height: 3.6mm; }
  .fld .n { text-align: center; font-size: 6.5pt; }
  .fld .cap { font-size: 5pt; color: #333; text-align: center; line-height: 1; }
  .three { display: grid; grid-template-columns: 1fr 22mm 1fr; gap: 0 2mm; }
`;

function sign(role: string, name?: string) {
  return `<div class="sg"><div class="l">${esc(role)}</div><div class="line"></div><div class="line">${esc(name ?? '')}</div>
    <div></div><div class="cap"><div>подпись</div><div>ф.и.о.</div></div></div>`;
}

function fld(label: string, value: string, n: string, cap?: string) {
  return `<div class="lb">${esc(label)}</div>
    <div class="fld"><div class="v">${esc(value)}</div><div class="n">[${n}]</div></div>
    ${cap ? `<div class="fld"><div class="cap">${esc(cap)}</div><div></div></div>` : ''}`;
}

function signLine(name: string, n: string) {
  return `<div class="fld"><div class="three"><div class="v"></div><div class="v"></div><div class="v">${esc(name)}</div></div><div class="n">[${n}]</div></div>
    <div class="fld"><div class="three cap"><div>должность</div><div>подпись</div><div>ф.и.о.</div></div><div></div></div>`;
}

export function updForm(doc: DocumentRow, d: UpdData, seller: UpdSeller, ctx: FormContext = {}): PrintableForm {
  const t = updTotals(d);
  const vatText = VAT_LABEL[String(d.vat)];
  const sellerInn = [seller.inn, seller.kpp].filter(Boolean).join('/');
  const buyerInn = [d.buyer.inn, d.buyer.kpp].filter(Boolean).join('/');
  const consignee = d.consigneeSame ? [d.buyer.name, d.buyer.address].filter(Boolean).join(', ')
    : [d.consignee.name, d.consignee.address].filter(Boolean).join(', ');
  const rows = t.rows.map((r, i) => `<tr>
      <td class="c">${i + 1}</td>
      <td class="c">${esc(r.sku)}</td>
      <td>${esc(r.name)}</td>
      <td class="c">—</td>
      <td class="c">${esc(r.okei || '—')}</td>
      <td class="c">${esc(r.unit)}</td>
      <td class="num">${formatQty(r.qty)}</td>
      <td class="num">${money(r.priceNet)}</td>
      <td class="num">${money(r.sumNet)}</td>
      <td class="c">без акциза</td>
      <td class="c">${esc(vatText)}</td>
      <td class="num">${d.vat === 'none' ? 'без НДС' : money(r.vatSum)}</td>
      <td class="num">${money(r.sumGross)}</td>
      <td class="c">—</td><td class="c">—</td><td class="c">—</td>
    </tr>`).join('');

  const body = `
  <div class="top">
    <div class="status">
      <b>Универсальный передаточный документ</b>
      Статус: <span class="box">${d.status}</span>
      <div style="font-size:6pt;margin-top:2mm">1 — счёт-фактура и передаточный документ (акт)<br>2 — передаточный документ (акт)</div>
    </div>
    <div class="hdr">
      <div class="title">
        <div><b>Счёт-фактура № ${esc(d.number)} от ${esc(longDate(d.date))}</b> <span style="font-size:6.5pt">(1)</span><br>
          Исправление № — от — <span style="font-size:6.5pt">(1а)</span></div>
        <div class="note">Приложение № 1 к постановлению Правительства Российской Федерации от 26 декабря 2011 г. № 1137</div>
      </div>
      <table class="req">
        <tr><td class="k">Продавец:</td><td class="v">${esc(seller.name)}</td><td class="n">(2)</td></tr>
        <tr><td class="k">Адрес:</td><td class="v">${esc(seller.address)}</td><td class="n">(2а)</td></tr>
        <tr><td class="k">ИНН/КПП продавца:</td><td class="v">${esc(sellerInn)}</td><td class="n">(2б)</td></tr>
        <tr><td class="k">Грузоотправитель и его адрес:</td><td class="v">он же</td><td class="n">(3)</td></tr>
        <tr><td class="k">Грузополучатель и его адрес:</td><td class="v">${esc(consignee)}</td><td class="n">(4)</td></tr>
        <tr><td class="k">К платёжно-расчётному документу №:</td><td class="v">${esc(d.paymentDoc || '—')}</td><td class="n">(5)</td></tr>
        <tr><td class="k">Документ об отгрузке:</td><td class="v">№ п/п 1–${t.rows.length} № ${esc(d.number)} от ${esc(ruDate(d.shipDate))}</td><td class="n">(5а)</td></tr>
        <tr><td class="k">Покупатель:</td><td class="v">${esc(d.buyer.name)}</td><td class="n">(6)</td></tr>
        <tr><td class="k">Адрес:</td><td class="v">${esc(d.buyer.address)}</td><td class="n">(6а)</td></tr>
        <tr><td class="k">ИНН/КПП покупателя:</td><td class="v">${esc(buyerInn)}</td><td class="n">(6б)</td></tr>
        <tr><td class="k">Валюта: наименование, код:</td><td class="v">Российский рубль, 643</td><td class="n">(7)</td></tr>
        <tr><td class="k">Идентификатор государственного контракта, договора (соглашения) (при наличии):</td><td class="v"></td><td class="n">(8)</td></tr>
      </table>
    </div>
  </div>

  <table class="g">
    <thead>
      <tr>
        <th rowspan="2" style="width:7mm">№ п/п</th>
        <th rowspan="2" style="width:17mm">Код товара/ работ, услуг</th>
        <th rowspan="2">Наименование товара (описание выполненных работ, оказанных услуг), имущественного права</th>
        <th rowspan="2" style="width:11mm">Код вида товара</th>
        <th colspan="2">Единица измерения</th>
        <th rowspan="2" style="width:14mm">Коли-чество (объём)</th>
        <th rowspan="2" style="width:17mm">Цена (тариф) за единицу измерения</th>
        <th rowspan="2" style="width:20mm">Стоимость товаров (работ, услуг), имущественных прав без налога — всего</th>
        <th rowspan="2" style="width:12mm">В том числе сумма акциза</th>
        <th rowspan="2" style="width:12mm">Нало-говая ставка</th>
        <th rowspan="2" style="width:18mm">Сумма налога, предъявляемая покупателю</th>
        <th rowspan="2" style="width:20mm">Стоимость товаров (работ, услуг), имущественных прав с налогом — всего</th>
        <th colspan="2">Страна происхождения товара</th>
        <th rowspan="2" style="width:20mm">Регистрационный номер декларации на товары или регистрационный номер партии товара, подлежащего прослеживаемости</th>
      </tr>
      <tr><th style="width:9mm">код</th><th style="width:13mm">условное обозначение (национальное)</th><th style="width:10mm">цифровой код</th><th style="width:15mm">краткое наименование</th></tr>
      <tr class="idx"><th>А</th><th>Б</th><th>1</th><th>1а</th><th>2</th><th>2а</th><th>3</th><th>4</th><th>5</th><th>6</th><th>7</th><th>8</th><th>9</th><th>10</th><th>10а</th><th>11</th></tr>
    </thead>
    <tbody>${rows}</tbody>
    <tbody><tr class="tot">
      <td colspan="8">Всего к оплате</td>
      <td class="num">${money(t.sumNet)}</td>
      <td class="c" colspan="2">X</td>
      <td class="num">${d.vat === 'none' ? 'без НДС' : money(t.vatSum)}</td>
      <td class="num">${money(t.sumGross)}</td>
      <td colspan="3"></td>
    </tr></tbody>
  </table>

  <div class="signs">
    <div>
      ${sign('Руководитель организации или иное уполномоченное лицо', seller.director)}
      ${sign('Индивидуальный предприниматель или иное уполномоченное лицо', '')}
    </div>
    <div>
      ${sign('Главный бухгалтер или иное уполномоченное лицо', seller.accountant)}
      <div class="sg"><div class="l" style="font-size:6pt">реквизиты свидетельства о государственной регистрации индивидуального предпринимателя</div><div></div><div class="line"></div></div>
    </div>
  </div>

  <div class="bottom">
    <div>
      ${fld('Основание передачи (сдачи) / получения (приёмки)', d.basis || `Расходный ордер № ${doc.number} от ${ruDate((doc.posted_at ?? doc.doc_date).slice(0, 10))}`, '8', 'договор; доверенность и др.')}
      ${fld('Данные о транспортировке и грузе', '', '9', 'транспортная накладная, поручение экспедитору, экспедиторская / складская расписка и др. / масса нетто/брутто груза')}
      <div class="lb">Товар (груз) передал / услуги, результаты работ, права сдал</div>
      ${signLine(d.passedBy, '10')}
      ${fld('Дата отгрузки, передачи (сдачи)', longDate(d.shipDate), '11')}
      ${fld('Иные сведения об отгрузке, передаче', `Расходный ордер № ${doc.number}`, '12', 'ссылки на неотъемлемые приложения, сопутствующие документы, иные документы и т.п.')}
      <div class="lb">Ответственный за правильность оформления факта хозяйственной жизни</div>
      ${signLine(seller.director, '13')}
      ${fld('Наименование экономического субъекта — составителя документа (в т.ч. комиссионера / агента)', [seller.name, sellerInn ? `ИНН/КПП ${sellerInn}` : ''].filter(Boolean).join(', '), '14', 'может не заполняться при проставлении печати в М.П., может быть указан ИНН/КПП')}
      <div class="lb">М.П.</div>
    </div>
    <div>
      <div class="lb">Товар (груз) получил / услуги, результаты работ, права принял</div>
      ${signLine(d.receivedBy, '15')}
      ${fld('Дата получения (приёмки)', '«___» ____________ 20__ г.', '16')}
      ${fld('Иные сведения о получении, приёмке', '', '17', 'информация о наличии / отсутствии претензии; ссылки на неотъемлемые приложения и другие документы и т.п.')}
      <div class="lb">Ответственный за правильность оформления факта хозяйственной жизни</div>
      ${signLine('', '18')}
      ${fld('Наименование экономического субъекта — составителя документа', [d.buyer.name, buyerInn ? `ИНН/КПП ${buyerInn}` : ''].filter(Boolean).join(', '), '19', 'может не заполняться при проставлении печати в М.П., может быть указан ИНН/КПП')}
      <div class="lb">М.П.</div>
    </div>
  </div>
  <div style="font-size:6pt;color:#555;margin-top:1mm">Сформировано: ${esc(ruDate(ctx.printedAt ?? nowStamp()))}${esc((ctx.printedAt ?? nowStamp()).slice(10))} ${esc(ctx.printedBy ?? '')} · Performance Warehouse</div>`;

  const title = `УПД ${d.number}`;
  return {
    fileName: title,
    orientation: 'landscape',
    html: `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}</style></head><body>${body}</body></html>`,
  };
}
