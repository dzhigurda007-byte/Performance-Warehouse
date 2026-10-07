import { labelsHtml, type Label, type LabelLayout } from './labelsHtml';
import type { PrintableForm } from './docForms';
import { printHtml, saveHtml } from './printHtml';

export { LAYOUT_LABEL, labelsHtml, type Label, type LabelLayout } from './labelsHtml';

/** Печать этикеток с QR-кодами (системный диалог печати или «Сохранить как PDF»). */
export async function printLabels(labels: Label[], layout: LabelLayout = 'sheet') {
  if (!labels.length) throw new Error('Нечего печатать');
  await printHtml(labelsHtml(labels, layout));
}

/** Напечатать печатную форму (только сам документ, без окна программы). */
export async function printForm(form: PrintableForm) {
  await printHtml(form.html, form.orientation);
}

/** Сохранить печатную форму отдельным файлом (телефон — PDF, ПК — отдельная вкладка → PDF). */
export async function saveForm(form: PrintableForm) {
  await saveHtml(form.html, form.fileName, form.orientation);
}
