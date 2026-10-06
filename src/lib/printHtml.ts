import * as Print from 'expo-print';

/** Напечатать готовую HTML-страницу (телефон: системный диалог печати / «Сохранить как PDF»). */
export async function printHtml(html: string) {
  await Print.printAsync({ html });
}
