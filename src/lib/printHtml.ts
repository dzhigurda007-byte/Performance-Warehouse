import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';

/** Напечатать готовую HTML-страницу (телефон: системный диалог печати / «Сохранить как PDF»). */
export async function printHtml(html: string) {
  await Print.printAsync({ html });
}

const safeName = (name: string) => name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'Документ';

/** Сохранить документ отдельным PDF-файлом и предложить, куда его отправить (почта, мессенджер, «Файлы»). */
export async function saveHtml(html: string, fileName: string) {
  const { uri } = await Print.printToFileAsync({ html, width: 595, height: 842 });
  const target = new File(Paths.cache, `${safeName(fileName)}.pdf`);
  if (target.exists) target.delete();
  new File(uri).move(target);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(target.uri, { mimeType: 'application/pdf', dialogTitle: fileName, UTI: 'com.adobe.pdf' });
  } else {
    throw new Error(`PDF сохранён: ${target.uri}`);
  }
}
