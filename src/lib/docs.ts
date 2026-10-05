import type { DocType, DocumentRow } from '../domain/types';

export const DOC_TITLES: Record<DocType, string> = {
  receipt: 'Приходный ордер',
  issue: 'Расходный ордер',
  move: 'Перемещение',
};

export function docSubtitle(d: DocumentRow) {
  const who = d.type === 'issue' ? d.recipient : d.type === 'receipt' ? d.partner : d.comment;
  return `${d.doc_date.slice(0, 16)} · ${d.created_by_name}${who ? ' · ' + who : ''} · строк: ${d.lines_count}`;
}
