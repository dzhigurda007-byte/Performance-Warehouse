import type { DocType, DocumentRow } from '../core/types';

export const DOC_TITLES: Record<DocType, string> = {
  receipt: 'Приходный ордер',
  issue: 'Расходный ордер',
  move: 'Перемещение',
};

export function docSubtitle(d: DocumentRow) {
  const who = d.type === 'issue' ? d.recipient : d.type === 'receipt' ? d.partner : d.comment;
  const size = d.plan_count ? `задание: ${d.plan_count} поз., отсканировано строк: ${d.lines_count}` : `строк: ${d.lines_count}`;
  return `${d.doc_date.slice(0, 16)} · ${d.created_by_name}${who ? ' · ' + who : ''} · ${size}`;
}

export const DOC_SOURCE_LABEL: Record<string, string> = {
  manual: '',
  scan: 'по сканированию',
  excel: 'из Excel',
  return: 'возврат',
  task: 'по заданию',
};
