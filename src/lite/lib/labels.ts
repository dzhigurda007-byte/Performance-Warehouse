import type { Label } from '../../lib/labelsHtml';
import { cellQr } from '../core/service';

/** QR-этикетка ячейки: внутренний код PWL:C:<код> + крупная подпись. */
export const cellLabel = (c: { code: string; name: string | null }): Label => ({ qr: cellQr(c.code), title: c.code, subtitle: c.name ?? 'Ячейка' });
