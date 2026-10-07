/**
 * Справочники: свои организации, контрагенты (юр. и физ. лица), договоры.
 * Описание полей — одно на сервер (проверка, SQL) и на интерфейс (формы).
 */

export type RefKind = 'org' | 'legal' | 'person' | 'contract';

export interface FieldSpec {
  key: string;
  label: string;
  /** digits — только цифры допустимой длины (len); date — ДД.ММ.ГГГГ; money — сумма. */
  type?: 'text' | 'multiline' | 'digits' | 'date' | 'money' | 'phone' | 'email';
  len?: number[];
  required?: boolean;
  /** Заголовок группы полей в форме. */
  section?: string;
  /** Два поля в строку на широком экране. */
  half?: boolean;
  hint?: string;
}

const BANK: FieldSpec[] = [
  { key: 'bank_name', label: 'Банк', section: 'Банковские реквизиты' },
  { key: 'bik', label: 'БИК', type: 'digits', len: [9], half: true },
  { key: 'bank_account', label: 'Расчётный счёт', type: 'digits', len: [20], half: true },
  { key: 'corr_account', label: 'Корр. счёт', type: 'digits', len: [20] },
];

const CONTACTS: FieldSpec[] = [
  { key: 'phone', label: 'Телефон', type: 'phone', half: true, section: 'Контакты' },
  { key: 'email', label: 'E-mail', type: 'email', half: true },
];

export const ORG_FIELDS: FieldSpec[] = [
  { key: 'name', label: 'Полное наименование', required: true, section: 'Организация', hint: 'Общество с ограниченной ответственностью «…»' },
  { key: 'short_name', label: 'Краткое наименование', hint: 'ООО «…»' },
  { key: 'inn', label: 'ИНН', type: 'digits', len: [10, 12], half: true },
  { key: 'kpp', label: 'КПП', type: 'digits', len: [9], half: true },
  { key: 'ogrn', label: 'ОГРН / ОГРНИП', type: 'digits', len: [13, 15] },
  { key: 'legal_address', label: 'Юридический адрес', type: 'multiline' },
  { key: 'actual_address', label: 'Фактический адрес', type: 'multiline' },
  ...BANK,
  { key: 'director', label: 'Руководитель (ФИО)', section: 'Подписи', half: true },
  { key: 'director_position', label: 'Должность руководителя', half: true, hint: 'Генеральный директор' },
  { key: 'accountant', label: 'Главный бухгалтер (ФИО)' },
  ...CONTACTS,
];

export const LEGAL_FIELDS: FieldSpec[] = [
  { key: 'name', label: 'Полное наименование', required: true, section: 'Юридическое лицо / ИП' },
  { key: 'short_name', label: 'Краткое наименование' },
  { key: 'inn', label: 'ИНН', type: 'digits', len: [10, 12], half: true },
  { key: 'kpp', label: 'КПП', type: 'digits', len: [9], half: true },
  { key: 'ogrn', label: 'ОГРН / ОГРНИП', type: 'digits', len: [13, 15] },
  { key: 'address', label: 'Юридический адрес', type: 'multiline' },
  { key: 'actual_address', label: 'Фактический адрес / адрес доставки', type: 'multiline' },
  ...BANK,
  { key: 'director', label: 'Руководитель (ФИО)', section: 'Представитель', half: true },
  { key: 'director_position', label: 'Должность', half: true },
  ...CONTACTS,
  { key: 'comment', label: 'Примечание', type: 'multiline' },
];

export const PERSON_FIELDS: FieldSpec[] = [
  { key: 'name', label: 'ФИО', required: true, section: 'Физическое лицо' },
  { key: 'birth_date', label: 'Дата рождения', type: 'date', half: true },
  { key: 'inn', label: 'ИНН', type: 'digits', len: [12], half: true },
  { key: 'passport_series', label: 'Паспорт: серия', type: 'digits', len: [4], half: true, section: 'Паспорт' },
  { key: 'passport_number', label: 'Номер', type: 'digits', len: [6], half: true },
  { key: 'passport_issued_by', label: 'Кем выдан', type: 'multiline' },
  { key: 'passport_issued_at', label: 'Дата выдачи', type: 'date', half: true },
  { key: 'passport_code', label: 'Код подразделения', half: true, hint: '000-000' },
  { key: 'address', label: 'Адрес регистрации', type: 'multiline' },
  { key: 'actual_address', label: 'Фактический адрес', type: 'multiline' },
  ...CONTACTS,
  { key: 'comment', label: 'Примечание', type: 'multiline' },
];

export const CONTRACT_FIELDS: FieldSpec[] = [
  { key: 'number', label: 'Номер договора', required: true, half: true, section: 'Договор' },
  { key: 'date', label: 'Дата', type: 'date', required: true, half: true },
  { key: 'title', label: 'Вид / предмет договора', hint: 'Договор поставки' },
  { key: 'valid_until', label: 'Действует до', type: 'date', half: true },
  { key: 'amount', label: 'Сумма договора, ₽', type: 'money', half: true },
  { key: 'comment', label: 'Условия / примечание', type: 'multiline' },
];

export const FIELDS: Record<RefKind, FieldSpec[]> = {
  org: ORG_FIELDS, legal: LEGAL_FIELDS, person: PERSON_FIELDS, contract: CONTRACT_FIELDS,
};

export const KIND_TITLE: Record<RefKind, string> = {
  org: 'Организация', legal: 'Юридическое лицо', person: 'Физическое лицо', contract: 'Договор',
};

export type RefRecord = Record<string, string | number | null | undefined> & { id?: number };

export interface Organization extends RefRecord {
  id: number;
  name: string;
  is_default: number;
}

export interface Counterparty extends RefRecord {
  id: number;
  kind: 'legal' | 'person';
  name: string;
}

export interface Contract extends RefRecord {
  id: number;
  number: string;
  date: string;
  org_id: number | null;
  counterparty_id: number | null;
  org_name: string | null;
  party_name: string | null;
  party_kind: 'legal' | 'person' | null;
}

/** «ДД.ММ.ГГГГ» ⇄ «ГГГГ-ММ-ДД». */
export function dateToIso(v: string): string | null | undefined {
  const t = v.trim();
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(t);
  if (!m) return undefined;
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return undefined;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export const isoToRu = (v: string | null | undefined) =>
  v && /^\d{4}-\d{2}-\d{2}/.test(v) ? `${v.slice(8, 10)}.${v.slice(5, 7)}.${v.slice(0, 4)}` : v ?? '';

/**
 * Проверить и привести запись к виду для базы: пустое → null, даты → ГГГГ-ММ-ДД, суммы → число.
 * Возвращает список ошибок «Поле: что не так».
 */
export function normalizeRecord(kind: RefKind, input: RefRecord): { value: RefRecord; errors: string[] } {
  const errors: string[] = [];
  const value: RefRecord = {};
  for (const f of FIELDS[kind]) {
    const raw = input[f.key];
    const s = raw === null || raw === undefined ? '' : String(raw).trim();
    if (!s) {
      if (f.required) errors.push(`${f.label}: обязательно`);
      value[f.key] = null;
      continue;
    }
    switch (f.type) {
      case 'digits': {
        const d = s.replace(/[\s-]/g, '');
        if (!/^\d+$/.test(d) || (f.len && !f.len.includes(d.length))) {
          errors.push(`${f.label}: ${f.len ? f.len.join(' или ') + ' цифр' : 'только цифры'}`);
        }
        value[f.key] = d;
        break;
      }
      case 'date': {
        const iso = dateToIso(s);
        if (iso === undefined) errors.push(`${f.label}: дата в формате ДД.ММ.ГГГГ`);
        value[f.key] = iso ?? null;
        break;
      }
      case 'money': {
        const n = Number(s.replace(/[\s ₽]/g, '').replace(',', '.'));
        if (!Number.isFinite(n) || n < 0) errors.push(`${f.label}: число`);
        value[f.key] = Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
        break;
      }
      case 'email':
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) errors.push(`${f.label}: адрес вида name@site.ru`);
        value[f.key] = s;
        break;
      default:
        value[f.key] = s;
    }
  }
  return { value, errors };
}

/** Реквизиты одной строкой: «ИНН 7701… / КПП 7701…». */
export function innKpp(r: Record<string, unknown>) {
  return [r.inn, r.kpp].filter(Boolean).join('/');
}

/** Номер и дата договора для документов: «Договор поставки № 15 от 01.09.2026». */
export function contractTitle(c: { title?: unknown; number: string; date: string }) {
  return `${(c.title as string) || 'Договор'} № ${c.number} от ${isoToRu(c.date)}`;
}
