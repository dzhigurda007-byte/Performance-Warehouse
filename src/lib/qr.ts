import qrcode from 'qrcode-generator';

/** SVG-разметка QR-кода (используется и на экране, и при печати этикеток). */
export function qrSvg(text: string, cellSize = 4, margin = 2): string {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize, margin, scalable: true });
}
