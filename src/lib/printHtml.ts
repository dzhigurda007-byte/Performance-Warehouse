import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';

export type PageOrientation = 'portrait' | 'landscape';

/** Размер листа A4 в точках PDF. */
const A4 = { portrait: { width: 595, height: 842 }, landscape: { width: 842, height: 595 } };

/**
 * Напечатать готовую HTML-страницу (телефон: системный диалог печати / «Сохранить как PDF»).
 * Альбомные формы (УПД) сначала собираются в PDF с альбомным листом — Android печатает его
 * как есть, ориентация не сбивается настройками диалога печати.
 */
export async function printHtml(html: string, orientation: PageOrientation = 'portrait') {
  if (orientation === 'landscape') {
    const { uri } = await Print.printToFileAsync({ html, ...A4.landscape });
    await Print.printAsync({ uri, orientation: Print.Orientation.landscape });
    return;
  }
  await Print.printAsync({ html });
}

const safeName = (name: string) => name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'Документ';

/** Сохранить документ отдельным PDF-файлом и предложить, куда его отправить (почта, мессенджер, «Файлы»). */
export async function saveHtml(html: string, fileName: string, orientation: PageOrientation = 'portrait') {
  const { uri } = await Print.printToFileAsync({ html, ...A4[orientation] });
  const target = new File(Paths.cache, `${safeName(fileName)}.pdf`);
  if (target.exists) target.delete();
  new File(uri).move(target);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(target.uri, { mimeType: 'application/pdf', dialogTitle: fileName, UTI: 'com.adobe.pdf' });
  } else {
    throw new Error(`PDF сохранён: ${target.uri}`);
  }
}
