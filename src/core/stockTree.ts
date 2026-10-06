import type { ItemGroup, StockReportRow } from './types';
import { round3 } from './db';

/** Сортировка товаров в отчёте «Остатки». */
export type StockSort = 'name' | 'name_desc' | 'qty_desc' | 'qty' | 'date_desc' | 'date';

export const STOCK_SORT_LABEL: Record<StockSort, string> = {
  name: 'А → Я',
  name_desc: 'Я → А',
  qty_desc: 'Больше остаток',
  qty: 'Меньше остаток',
  date_desc: 'Новые приёмки',
  date: 'Старые приёмки',
};

export interface StockItemNode {
  kind: 'item';
  key: string;
  item_id: number;
  sku: string;
  name: string;
  unit: string;
  barcode: string | null;
  qty: number;
  /** Самая ранняя и самая поздняя дата приёмки среди партий. */
  first: string;
  last: string;
  lots: StockReportRow[];
  /** Путь групп: «Техника / Бытовая / Кухонные комбайны». */
  path: string;
}

export interface StockGroupNode {
  kind: 'group';
  key: string;
  id: number | null;
  name: string;
  path: string;
  depth: number;
  /** Число товаров (с остатком) в группе вместе с подгруппами. */
  items: number;
  /** Сумма количеств по группе — осмысленна, когда единицы одинаковые. */
  qty: number;
  units: string[];
  groups: StockGroupNode[];
  list: StockItemNode[];
}

export interface StockTreeOptions {
  sort?: StockSort;
  /** Фильтр по общему остатку товара (после фильтра по дате приёмки), включительно. */
  minQty?: number | null;
  maxQty?: number | null;
}

const NO_GROUP = 'Без группы';
const collator = (a: string, b: string) => a.localeCompare(b, 'ru', { numeric: true, sensitivity: 'base' });

/** Партии → товары с суммарным остатком, с учётом фильтра по количеству. */
export function stockItems(rows: StockReportRow[], groups: ItemGroup[], opt: StockTreeOptions = {}): StockItemNode[] {
  const pathOf = groupPaths(groups);
  const byItem = new Map<number, StockItemNode>();
  for (const r of rows) {
    let n = byItem.get(r.item_id);
    if (!n) {
      n = {
        kind: 'item', key: `i${r.item_id}`, item_id: r.item_id, sku: r.sku, name: r.item_name, unit: r.unit,
        barcode: r.barcode, qty: 0, first: r.received_at, last: r.received_at, lots: [],
        path: r.group_id ? pathOf.get(r.group_id) ?? NO_GROUP : NO_GROUP,
      };
      byItem.set(r.item_id, n);
    }
    n.qty = round3(n.qty + r.qty);
    n.lots.push(r);
    if (r.received_at < n.first) n.first = r.received_at;
    if (r.received_at > n.last) n.last = r.received_at;
  }
  const min = opt.minQty ?? null;
  const max = opt.maxQty ?? null;
  const out = [...byItem.values()].filter((n) => (min === null || n.qty >= min) && (max === null || n.qty <= max));
  return sortItems(out, opt.sort ?? 'name');
}

export function sortItems(list: StockItemNode[], sort: StockSort): StockItemNode[] {
  const byName = (a: StockItemNode, b: StockItemNode) => collator(a.name, b.name) || collator(a.sku, b.sku);
  const cmp: Record<StockSort, (a: StockItemNode, b: StockItemNode) => number> = {
    name: byName,
    name_desc: (a, b) => byName(b, a),
    qty_desc: (a, b) => b.qty - a.qty || byName(a, b),
    qty: (a, b) => a.qty - b.qty || byName(a, b),
    date_desc: (a, b) => b.last.localeCompare(a.last) || byName(a, b),
    date: (a, b) => a.first.localeCompare(b.first) || byName(a, b),
  };
  return [...list].sort(cmp[sort]);
}

/** id группы → «Техника / Бытовая / Кухонные комбайны». */
export function groupPaths(groups: ItemGroup[]): Map<number, string> {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const out = new Map<number, string>();
  for (const g of groups) {
    const parts: string[] = [];
    const seen = new Set<number>();
    for (let c: ItemGroup | undefined = g; c && !seen.has(c.id); c = c.parent_id ? byId.get(c.parent_id) : undefined) {
      seen.add(c.id);
      parts.unshift(c.name);
    }
    out.set(g.id, parts.join(' / '));
  }
  return out;
}

/**
 * Дерево «группа → подгруппа → … → товар». Группы без товаров (после фильтров) не попадают.
 * Товары без группы — в отдельном узле «Без группы» в конце.
 */
export function stockTree(rows: StockReportRow[], groups: ItemGroup[], opt: StockTreeOptions = {}): StockGroupNode[] {
  const items = stockItems(rows, groups, opt);
  const groupOf = new Map<number, number | null>(); // item_id → group_id
  for (const r of rows) groupOf.set(r.item_id, r.group_id);
  const pathOf = groupPaths(groups);
  const byId = new Map(groups.map((g) => [g.id, g]));

  const nodes = new Map<number, StockGroupNode>();
  const node = (g: ItemGroup, depth: number): StockGroupNode => {
    let n = nodes.get(g.id);
    if (!n) {
      n = { kind: 'group', key: `g${g.id}`, id: g.id, name: g.name, path: pathOf.get(g.id) ?? g.name, depth, items: 0, qty: 0, units: [], groups: [], list: [] };
      nodes.set(g.id, n);
    }
    return n;
  };
  const depthOf = (g: ItemGroup) => {
    let d = 0;
    const seen = new Set<number>([g.id]);
    for (let p = g.parent_id ? byId.get(g.parent_id) : undefined; p && !seen.has(p.id); p = p.parent_id ? byId.get(p.parent_id) : undefined) {
      seen.add(p.id);
      d++;
    }
    return d;
  };

  const roots: StockGroupNode[] = [];
  const noGroup: StockGroupNode = { kind: 'group', key: 'g0', id: null, name: NO_GROUP, path: NO_GROUP, depth: 0, items: 0, qty: 0, units: [], groups: [], list: [] };

  for (const it of items) {
    const gid = groupOf.get(it.item_id);
    const g = gid ? byId.get(gid) : undefined;
    if (!g) {
      addTo(noGroup, it);
      continue;
    }
    // цепочка от группы товара до корня; каждая получает товар в итоги
    let child: StockGroupNode | null = null;
    const seen = new Set<number>();
    for (let c: ItemGroup | undefined = g; c && !seen.has(c.id); c = c.parent_id ? byId.get(c.parent_id) : undefined) {
      seen.add(c.id);
      const n = node(c, depthOf(c));
      if (c === g) n.list.push(it);
      addTotals(n, it);
      if (child && !n.groups.includes(child)) n.groups.push(child);
      child = n;
      const parent = c.parent_id ? byId.get(c.parent_id) : undefined;
      if ((!parent || seen.has(parent.id)) && !roots.includes(n)) roots.push(n);
    }
  }

  const sortGroups = (list: StockGroupNode[]) => {
    list.sort((a, b) => collator(a.name, b.name));
    for (const n of list) sortGroups(n.groups);
  };
  sortGroups(roots);
  if (noGroup.items) roots.push(noGroup);
  return roots;
}

function addTotals(n: StockGroupNode, it: StockItemNode) {
  n.items++;
  n.qty = round3(n.qty + it.qty);
  if (!n.units.includes(it.unit)) n.units.push(it.unit);
}

function addTo(n: StockGroupNode, it: StockItemNode) {
  n.list.push(it);
  addTotals(n, it);
}

export type StockLine =
  | { kind: 'group'; node: StockGroupNode; open: boolean }
  | { kind: 'item'; node: StockItemNode; depth: number };

/** Развернуть дерево в плоский список строк для отображения/печати. collapsed — ключи свёрнутых групп. */
export function flattenTree(roots: StockGroupNode[], collapsed: ReadonlySet<string> = new Set()): StockLine[] {
  const out: StockLine[] = [];
  const walk = (n: StockGroupNode) => {
    const open = !collapsed.has(n.key);
    out.push({ kind: 'group', node: n, open });
    if (!open) return;
    for (const g of n.groups) walk(g);
    for (const it of n.list) out.push({ kind: 'item', node: it, depth: n.depth + 1 });
  };
  roots.forEach(walk);
  return out;
}

/** Ключи всех групп (чтобы свернуть всё). */
export function allGroupKeys(roots: StockGroupNode[]): string[] {
  const out: string[] = [];
  const walk = (n: StockGroupNode) => { out.push(n.key); n.groups.forEach(walk); };
  roots.forEach(walk);
  return out;
}

/** «05.10.2026», «5.10.26», «2026-10-05» → «2026-10-05»; пусто → null; ошибка → undefined. */
export function parseDateInput(s: string): string | null | undefined {
  const t = s.trim();
  if (!t) return null;
  let y: number, m: number, dd: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  const ru = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/.exec(t);
  if (iso) [y, m, dd] = [+iso[1], +iso[2], +iso[3]];
  else if (ru) [dd, m, y] = [+ru[1], +ru[2], ru[3].length === 2 ? 2000 + +ru[3] : +ru[3]];
  else return undefined;
  const dt = new Date(Date.UTC(y, m - 1, dd));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== dd) return undefined;
  return `${y}-${String(m).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

/** Число из поля ввода («1,5» → 1.5); пусто → null; ошибка → undefined. */
export function parseQtyInput(s: string): number | null | undefined {
  const t = s.trim().replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}
