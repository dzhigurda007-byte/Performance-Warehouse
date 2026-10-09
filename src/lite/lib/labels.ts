import type { Label } from '../../lib/labelsHtml';
import { cellQr } from '../core/service';

/** QR-этикетка ячейки: внутренний код PWL:C:<код> + крупная подпись (A-1-1) и расшифровка. */
export const cellLabel = (c: { code: string; name: string | null; shelf?: number | null; pos?: number | null }): Label => {
  const m = /^(.+)-(\d+)-(\d+)$/.exec(c.code);
  const sub = c.shelf && m ? `Ряд ${m[1]} · полка ${c.shelf} · ячейка ${c.pos}` : c.name ?? 'Ячейка';
  return { qr: cellQr(c.code), title: c.code, subtitle: c.name && c.shelf ? `${sub} · ${c.name}` : sub };
};
