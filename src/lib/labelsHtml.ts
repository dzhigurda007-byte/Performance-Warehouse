import { qrSvg } from './qr';

export interface Label {
  qr: string;
  /** Крупная подпись под QR — название ячейки / код. */
  title: string;
  /** Мелкая подпись: полный адрес, склад и т.п. */
  subtitle?: string;
  /** Всегда на отдельном листе (например, QR стеллажа). */
  ownPage?: boolean;
}

/** «sheet» — много этикеток на листе A4, «single» — одна этикетка на лист. */
export type LabelLayout = 'sheet' | 'single';

export const LAYOUT_LABEL: Record<LabelLayout, string> = {
  sheet: 'Много на листе (A4, 3×5)',
  single: 'Одна на листе (крупно)',
};

export function esc(s: string | null | undefined) {
  return (s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function bigPage(l: Label) {
  return `<section class="page big">
    <div class="qr">${qrSvg(l.qr, 8, 2)}</div>
    <div class="t">${esc(l.title)}</div>
    ${l.subtitle ? `<div class="s">${esc(l.subtitle)}</div>` : ''}
  </section>`;
}

function small(l: Label) {
  return `<div class="lbl">
    <div class="qr">${qrSvg(l.qr, 4, 1)}</div>
    <div class="t">${esc(l.title)}</div>
    ${l.subtitle ? `<div class="s">${esc(l.subtitle)}</div>` : ''}
  </div>`;
}

/** HTML листов с этикетками: QR и подпись под ним. */
export function labelsHtml(labels: Label[], layout: LabelLayout = 'sheet'): string {
  const pages: string[] = [];
  let grid: string[] = [];
  const flush = () => {
    if (grid.length) pages.push(`<section class="page"><div class="grid">${grid.join('')}</div></section>`);
    grid = [];
  };
  for (const l of labels) {
    if (l.ownPage || layout === 'single') {
      flush();
      pages.push(bigPage(l));
    } else {
      grid.push(small(l));
      if (grid.length === 15) flush();
    }
  }
  flush();
  return `<!doctype html><html><head><meta charset="utf-8"><title>Этикетки</title><style>
    @page { size: A4; margin: 10mm; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; color: #000; }
    .page { page-break-after: always; break-after: page; }
    .page:last-child { page-break-after: auto; break-after: auto; }
    .grid { display: grid; grid-template-columns: repeat(3, 1fr); grid-auto-rows: 52mm; gap: 2mm; }
    .lbl { border: 1px dashed #999; padding: 2mm; text-align: center; overflow: hidden;
           display: flex; flex-direction: column; align-items: center; justify-content: center; break-inside: avoid; }
    .lbl .qr svg { width: 34mm; height: 34mm; display: block; }
    .lbl .t { font-size: 16pt; font-weight: 700; margin-top: 1mm; line-height: 1.1; word-break: break-word; }
    .lbl .s { font-size: 8pt; color: #333; margin-top: 0.5mm; }
    .big { height: 270mm; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
    .big .qr svg { width: 150mm; height: 150mm; display: block; }
    .big .t { font-size: 48pt; font-weight: 700; margin-top: 8mm; line-height: 1.1; word-break: break-word; }
    .big .s { font-size: 16pt; color: #333; margin-top: 4mm; }
  </style></head><body>${pages.join('')}</body></html>`;
}

