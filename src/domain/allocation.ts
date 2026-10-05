/**
 * Подбор мест хранения для расходного ордера (стратегия отбора, как в WMS).
 *
 * Стратегия FIFO: в первую очередь отбираем из партий, которые поступили раньше.
 * При равной дате — сначала из ячеек «россыпью», потом из коробов
 * (чтобы не вскрывать лишние короба), затем из мест с меньшим остатком
 * (освобождаем ячейки).
 */
export interface AllocSource {
  item_id: number;
  cell_id: number | null;
  box_id: number | null;
  qty: number;
  first_in_at: string;
}

export interface AllocPick {
  cell_id: number | null;
  box_id: number | null;
  qty: number;
}

export interface AllocResult {
  picks: AllocPick[];
  shortage: number; // сколько не хватило
}

export function sortFifo<T extends AllocSource>(sources: T[]): T[] {
  return [...sources].sort((a, b) => {
    if (a.first_in_at !== b.first_in_at) return a.first_in_at < b.first_in_at ? -1 : 1;
    const aBox = a.box_id ? 1 : 0;
    const bBox = b.box_id ? 1 : 0;
    if (aBox !== bBox) return aBox - bBox;
    return a.qty - b.qty;
  });
}

/**
 * @param reserved — сколько уже зарезервировано строками этого же документа
 *                   по ключу placeKey(), чтобы не отобрать одно и то же дважды.
 */
export function allocate(
  sources: AllocSource[],
  qty: number,
  reserved: Map<string, number> = new Map(),
): AllocResult {
  let left = qty;
  const picks: AllocPick[] = [];
  for (const s of sortFifo(sources)) {
    if (left <= 0) break;
    const free = s.qty - (reserved.get(placeKey(s.cell_id, s.box_id)) ?? 0);
    if (free <= 0) continue;
    const take = Math.min(free, left);
    picks.push({ cell_id: s.box_id ? null : s.cell_id, box_id: s.box_id, qty: round(take) });
    left = round(left - take);
  }
  return { picks, shortage: Math.max(0, round(left)) };
}

export function placeKey(cellId: number | null, boxId: number | null): string {
  return boxId ? `b${boxId}` : `c${cellId}`;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
