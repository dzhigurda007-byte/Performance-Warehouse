/**
 * Маркировка. Внутренние QR-коды самоописывающие: по префиксу сканер сразу
 * понимает, что отсканировано (ячейка, короб или товар), — как SSCC/LPN в WMS.
 *
 *   PW:R:<id стеллажа> — стеллаж (что хранится на стеллаже в целом)
 *   PW:C:<id ячейки>   — ячейка
 *   PW:B:<код короба>  — короб (BX-000001)
 *   PW:I:<артикул>     — товар
 *   PW:K:<код>         — ТМЦ на руках (инвентарный номер выдачи, INV-000001)
 *   PW:S:<адрес>       — адрес локального сервера (подключение терминала)
 *   http://…/join/<токен> — ссылка-приглашение
 *
 * Всё, что не подходит под формат, считается «чужим» штрихкодом
 * (EAN-13, Code128 производителя и т.п.) и ищется по полям штрихкод/артикул/код короба.
 */
export type ScanTarget =
  | { kind: 'rack'; id: number }
  | { kind: 'cell'; id: number }
  | { kind: 'box'; code: string }
  | { kind: 'item'; sku: string }
  | { kind: 'custody'; code: string }
  | { kind: 'server'; url: string }
  | { kind: 'invite'; server: string; token: string }
  | { kind: 'raw'; value: string };

const PREFIX = 'PW';

export function rackQr(id: number): string {
  return `${PREFIX}:R:${id}`;
}

export function cellQr(id: number): string {
  return `${PREFIX}:C:${id}`;
}

export function boxQr(code: string): string {
  return `${PREFIX}:B:${code}`;
}

export function itemQr(sku: string): string {
  return `${PREFIX}:I:${sku}`;
}

export function custodyQr(code: string): string {
  return `${PREFIX}:K:${code}`;
}

export function serverQr(url: string): string {
  return `${PREFIX}:S:${url}`;
}

export function inviteUrl(server: string, token: string): string {
  return `${server.replace(/\/+$/, '')}/join/${token}`;
}

export function parseScan(raw: string): ScanTarget {
  const value = raw.trim();
  const inv = /^(https?:\/\/[^/\s]+)\/join\/([A-Za-z0-9_-]{6,64})\/?$/i.exec(value);
  if (inv) return { kind: 'invite', server: inv[1], token: inv[2] };
  const srv = /^PW:S:(https?:\/\/\S+)$/i.exec(value);
  if (srv) return { kind: 'server', url: srv[1].replace(/\/+$/, '') };
  const m = /^PW:([RCBIK]):(.+)$/i.exec(value);
  if (!m) return { kind: 'raw', value };
  const tag = m[1].toUpperCase();
  const payload = m[2].trim();
  if (tag === 'R') {
    const id = Number(payload);
    return Number.isInteger(id) && id > 0 ? { kind: 'rack', id } : { kind: 'raw', value };
  }
  if (tag === 'C') {
    const id = Number(payload);
    return Number.isInteger(id) && id > 0 ? { kind: 'cell', id } : { kind: 'raw', value };
  }
  if (tag === 'B') return { kind: 'box', code: payload };
  if (tag === 'K') return { kind: 'custody', code: payload };
  return { kind: 'item', sku: payload };
}

export function formatCustodyCode(n: number): string {
  return `INV-${String(n).padStart(6, '0')}`;
}

export function formatBoxCode(n: number): string {
  return `BX-${String(n).padStart(6, '0')}`;
}

const DOC_PREFIX = { receipt: 'ПО', issue: 'РО', move: 'ПМ' } as const;

/** Номер документа как в 1С: префикс + сквозной номер с ведущими нулями. */
export function formatDocNumber(type: keyof typeof DOC_PREFIX, n: number): string {
  return `${DOC_PREFIX[type]}-${String(n).padStart(6, '0')}`;
}

export function formatAddress(warehouseCode: string, rackCode: string, cellCode: string): string {
  return `${warehouseCode} / ${rackCode} / ${cellCode}`;
}

/** Парсинг количества: допускаем запятую как десятичный разделитель. */
export function parseQty(text: string): number | null {
  const n = Number(text.replace(',', '.').trim());
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) / 1000 : null;
}

export function formatQty(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000);
}
