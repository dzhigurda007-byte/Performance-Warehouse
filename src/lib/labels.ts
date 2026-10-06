import { cellQr, rackQr } from '../core/codes';
import type { Label } from './labelsHtml';

interface RackLike {
  id: number;
  code: string;
  name?: string | null;
  warehouse_code: string;
  warehouse_name: string;
}

interface CellLike {
  id: number;
  code: string;
}

/** Подпись ячейки: её название; если код не содержит код стеллажа — добавляем его. */
export function cellTitle(rackCode: string, cellCode: string) {
  return cellCode.toUpperCase().startsWith(rackCode.toUpperCase()) ? cellCode : `${rackCode}-${cellCode}`;
}

export function rackLabel(rack: RackLike): Label {
  return {
    qr: rackQr(rack.id),
    title: `Стеллаж ${rack.code}`,
    subtitle: `${rack.warehouse_code} — ${rack.warehouse_name}${rack.name ? ` · ${rack.name}` : ''}`,
    ownPage: true, // QR стеллажа всегда на отдельном листе
  };
}

export function cellLabel(rack: RackLike, cell: CellLike): Label {
  return {
    qr: cellQr(cell.id),
    title: cellTitle(rack.code, cell.code),
    subtitle: `${rack.warehouse_code} / ${rack.code} / ${cell.code}`,
  };
}

/** Комплект для стеллажа: сначала лист с QR стеллажа, затем ячейки. */
export function rackLabels(rack: RackLike, cells: CellLike[], withCells = true): Label[] {
  return [rackLabel(rack), ...(withCells ? cells.map((c) => cellLabel(rack, c)) : [])];
}
