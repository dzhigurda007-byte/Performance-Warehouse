import { round3 } from './db';

/** Сверка задания на приёмку: сколько ожидалось и сколько отсканировано. */
export type CheckStatus = 'short' | 'ok' | 'over' | 'extra';

export const CHECK_LABEL: Record<CheckStatus, string> = {
  short: 'Недостача',
  ok: 'Сошлось',
  over: 'Излишек',
  extra: 'Нет в задании',
};

export interface PlanRow {
  item_id: number;
  sku: string;
  item_name: string;
  unit: string;
  barcode: string | null;
  qty: number;
}

export interface CheckRow {
  item_id: number;
  sku: string;
  item_name: string;
  unit: string;
  barcode: string | null;
  plan: number;
  fact: number;
  /** fact − plan: < 0 недостача, > 0 излишек. */
  diff: number;
  status: CheckStatus;
}

export interface CheckSummary {
  rows: CheckRow[];
  ok: number;
  short: number;
  over: number;
  extra: number;
  plan: number;
  fact: number;
  /** Всё сошлось: нет недостач и излишков. */
  matched: boolean;
}

export function statusOf(plan: number, fact: number): CheckStatus {
  if (plan <= 0) return 'extra';
  if (fact < plan) return 'short';
  if (fact > plan) return 'over';
  return 'ok';
}

/** Сводка по заданию: строки плана в его порядке, затем товары сверх задания. */
export function receiptCheck(
  plan: PlanRow[],
  lines: { item_id: number; sku: string; item_name: string; unit: string; barcode: string | null; qty: number }[],
): CheckSummary {
  const fact = new Map<number, number>();
  for (const l of lines) fact.set(l.item_id, round3((fact.get(l.item_id) ?? 0) + l.qty));
  const rows: CheckRow[] = plan.map((p) => {
    const f = fact.get(p.item_id) ?? 0;
    return { item_id: p.item_id, sku: p.sku, item_name: p.item_name, unit: p.unit, barcode: p.barcode,
      plan: p.qty, fact: f, diff: round3(f - p.qty), status: statusOf(p.qty, f) };
  });
  const inPlan = new Set(plan.map((p) => p.item_id));
  const seen = new Set<number>();
  for (const l of lines) {
    if (inPlan.has(l.item_id) || seen.has(l.item_id)) continue;
    seen.add(l.item_id);
    const f = fact.get(l.item_id)!;
    rows.push({ item_id: l.item_id, sku: l.sku, item_name: l.item_name, unit: l.unit, barcode: l.barcode,
      plan: 0, fact: f, diff: f, status: 'extra' });
  }
  const count = (st: CheckStatus) => rows.filter((r) => r.status === st).length;
  const sum = { ok: count('ok'), short: count('short'), over: count('over'), extra: count('extra') };
  return {
    rows, ...sum,
    plan: round3(rows.reduce((a, r) => a + r.plan, 0)),
    fact: round3(rows.reduce((a, r) => a + r.fact, 0)),
    matched: sum.short === 0 && sum.over === 0 && sum.extra === 0,
  };
}
