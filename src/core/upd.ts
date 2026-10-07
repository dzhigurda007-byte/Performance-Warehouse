/**
 * УПД — универсальный передаточный документ (форма по письму ФНС; статус 1 — счёт-фактура
 * и передаточный документ, статус 2 — только передаточный документ). Здесь — данные и расчёт сумм.
 */

export type VatRate = 'none' | 0 | 5 | 7 | 10 | 20 | 22;

export const VAT_LABEL: Record<string, string> = {
  none: 'Без НДС', 0: '0%', 5: '5%', 7: '7%', 10: '10%', 20: '20%', 22: '22%',
};
export const VAT_RATES: VatRate[] = [22, 10, 0, 5, 7, 20, 'none'];

export interface UpdParty {
  name: string;
  inn: string;
  kpp: string;
  address: string;
}

export interface UpdLine {
  item_id: number;
  sku: string;
  name: string;
  unit: string;
  qty: number;
  /** Цена за единицу: без НДС или с НДС — см. priceWithVat. */
  price: number;
}

export interface UpdData {
  /** 1 — счёт-фактура и передаточный документ; 2 — только передаточный документ. */
  status: 1 | 2;
  number: string;
  date: string; // ГГГГ-ММ-ДД
  buyer: UpdParty;
  /** Грузополучатель совпадает с покупателем. */
  consigneeSame: boolean;
  consignee: { name: string; address: string };
  /** Основание передачи: договор, заказ… */
  basis: string;
  /** К платёжно-расчётному документу № … от … */
  paymentDoc: string;
  shipDate: string; // ГГГГ-ММ-ДД
  vat: VatRate;
  priceWithVat: boolean;
  lines: UpdLine[];
  /** Кто передал товар (кладовщик) и кто получил. */
  passedBy: string;
  receivedBy: string;
  /** Связь со справочниками: наша организация, контрагент-покупатель, договор. */
  sellerOrgId?: number | null;
  buyerPartyId?: number | null;
  contractId?: number | null;
}

export interface UpdRow extends UpdLine {
  okei: string;
  /** Цена без НДС за единицу. */
  priceNet: number;
  sumNet: number;
  vatSum: number;
  sumGross: number;
}

export interface UpdTotals {
  rows: UpdRow[];
  sumNet: number;
  vatSum: number;
  sumGross: number;
  qty: number;
}

/** Коды единиц измерения по ОКЕИ. */
const OKEI: Record<string, string> = {
  шт: '796', 'шт.': '796', штука: '796', кг: '166', г: '163', т: '168', л: '112', мл: '111', м: '006', см: '004',
  мм: '003', 'м2': '055', 'м²': '055', 'кв.м': '055', 'м3': '113', 'м³': '113', 'куб.м': '113', упак: '778', уп: '778',
  'уп.': '778', компл: '839', комплект: '839', пар: '715', пара: '715', рул: '736', рулон: '736', лист: '625',
  набор: '704', ящ: '812', коробка: '812', кор: '812', бут: '868', бутылка: '868', час: '356', ч: '356',
};

export const okei = (unit: string) => OKEI[unit.trim().toLowerCase()] ?? '';

/** Округление до копеек по правилам арифметики (0,5 — вверх) без ошибок двоичных дробей: 149,985 → 149,99. */
const r2 = (n: number) => Math.sign(n) * Math.round(Number((Math.abs(n) * 100).toPrecision(12))) / 100;

/** Расчёт строк и итогов: стоимость без налога, сумма налога, стоимость с налогом. */
export function updTotals(d: Pick<UpdData, 'lines' | 'vat' | 'priceWithVat'>): UpdTotals {
  const rate = d.vat === 'none' ? 0 : d.vat;
  const rows = d.lines.map((l): UpdRow => {
    let sumNet: number;
    let vatSum: number;
    let sumGross: number;
    if (d.priceWithVat) {
      sumGross = r2(l.qty * l.price);
      vatSum = rate ? r2((sumGross * rate) / (100 + rate)) : 0;
      sumNet = r2(sumGross - vatSum);
    } else {
      sumNet = r2(l.qty * l.price);
      vatSum = rate ? r2((sumNet * rate) / 100) : 0;
      sumGross = r2(sumNet + vatSum);
    }
    const priceNet = d.priceWithVat ? (l.qty ? r2(sumNet / l.qty) : 0) : r2(l.price);
    return { ...l, okei: okei(l.unit), priceNet, sumNet, vatSum, sumGross };
  });
  return {
    rows,
    sumNet: r2(rows.reduce((a, x) => a + x.sumNet, 0)),
    vatSum: r2(rows.reduce((a, x) => a + x.vatSum, 0)),
    sumGross: r2(rows.reduce((a, x) => a + x.sumGross, 0)),
    qty: rows.reduce((a, x) => a + x.qty, 0),
  };
}

/** Деньги: «1 234,50». */
export function money(n: number): string {
  const [i, f] = r2(n).toFixed(2).split('.');
  return `${i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${f}`;
}

/** Проверка перед печатью: что не заполнено или заполнено с ошибкой. */
export function updProblems(d: UpdData, seller: { name: string; inn: string }): string[] {
  const p: string[] = [];
  const innOk = (v: string) => /^\d{10}(\d{2})?$/.test(v.trim());
  if (!seller.name.trim()) p.push('Не указано название организации-продавца (Настройки)');
  if (!innOk(seller.inn)) p.push('ИНН продавца: 10 или 12 цифр (Настройки)');
  if (!d.number.trim()) p.push('Не указан номер документа');
  if (!d.buyer.name.trim()) p.push('Не указан покупатель');
  if (d.buyer.inn.trim() && !innOk(d.buyer.inn)) p.push('ИНН покупателя: 10 или 12 цифр');
  if (d.buyer.kpp.trim() && !/^\d{9}$/.test(d.buyer.kpp.trim())) p.push('КПП покупателя: 9 цифр');
  if (!d.lines.length) p.push('Нет строк');
  const noPrice = d.lines.filter((l) => !(l.price > 0));
  if (noPrice.length) p.push(`Не указана цена: ${noPrice.map((l) => l.name).slice(0, 3).join(', ')}${noPrice.length > 3 ? '…' : ''}`);
  return p;
}
