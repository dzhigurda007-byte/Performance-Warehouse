import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { Chips } from '../../components/Chips';
import { FormMenu, type FormJob } from '../../components/FormMenu';
import { Button, Empty, Muted, SearchBox, colors, s, useFocusLoad } from '../../components/ui';
import { formatQty } from '../../core/codes';
import {
  STOCK_SORT_LABEL, allGroupKeys, flattenTree, parseDateInput, parseQtyInput, stockItems, stockTree,
  type StockItemNode, type StockLine, type StockSort,
} from '../../core/stockTree';
import { useApi } from '../../lib/backend';
import { stockReportForm } from '../../lib/docForms';

type View_ = 'tree' | 'list';
type Period = 'all' | 'today' | 'week' | 'month' | 'custom';

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const ru = (s: string) => (s ? `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}` : '');
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return ymd(d); };

/**
 * Остатки: товар, сгруппированный по группам и подгруппам номенклатуры
 * («Техника → Бытовая → Кухонные комбайны → товар»), с отбором по количеству,
 * дате приёмки и сортировкой по алфавиту / количеству / дате.
 */
export default function StockScreen() {
  const api = useApi();
  const [q, setQ] = useState('');
  const [warehouseId, setWarehouseId] = useState(0);
  const [view, setView] = useState<View_>('tree');
  const [sort, setSort] = useState<StockSort>('name');
  const [showFilters, setShowFilters] = useState(false);
  const [minQ, setMinQ] = useState('');
  const [maxQ, setMaxQ] = useState('');
  const [period, setPeriod] = useState<Period>('all');
  const [fromS, setFromS] = useState('');
  const [toS, setToS] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [openItems, setOpenItems] = useState<Set<number>>(new Set());
  const [formJob, setFormJob] = useState<FormJob | null>(null);

  // период приёмки
  const dates = useMemo(() => {
    if (period === 'today') return { from: ymd(new Date()), to: null, ok: true };
    if (period === 'week') return { from: daysAgo(6), to: null, ok: true };
    if (period === 'month') return { from: daysAgo(29), to: null, ok: true };
    if (period === 'custom') {
      const from = parseDateInput(fromS);
      const to = parseDateInput(toS);
      return { from: from ?? null, to: to ?? null, ok: from !== undefined && to !== undefined };
    }
    return { from: null, to: null, ok: true };
  }, [period, fromS, toS]);
  const min = parseQtyInput(minQ);
  const max = parseQtyInput(maxQ);

  const [whs] = useFocusLoad(() => api.listWarehouses(), [api]);
  const [groups] = useFocusLoad(() => api.listGroups(), [api]);
  const [rows] = useFocusLoad(
    () => api.stockReport({ search: q, warehouseId: warehouseId || null, dateFrom: dates.from, dateTo: dates.to }),
    [api, q, warehouseId, dates.from, dates.to],
  );

  const opt = { sort, minQty: min ?? null, maxQty: max ?? null };
  const tree = useMemo(() => stockTree(rows ?? [], groups ?? [], opt), [rows, groups, sort, min, max]); // eslint-disable-line react-hooks/exhaustive-deps
  const flat = useMemo(() => stockItems(rows ?? [], groups ?? [], opt), [rows, groups, sort, min, max]); // eslint-disable-line react-hooks/exhaustive-deps
  const lines: StockLine[] = useMemo(
    () => (view === 'tree' ? flattenTree(tree, collapsed) : flat.map((node) => ({ kind: 'item' as const, node, depth: 0 }))),
    [view, tree, flat, collapsed],
  );

  const filterNotes = useMemo(() => {
    const out: string[] = [];
    if (q.trim()) out.push(`поиск «${q.trim()}»`);
    if (min != null) out.push(`остаток от ${formatQty(min)}`);
    if (max != null) out.push(`остаток до ${formatQty(max)}`);
    if (dates.from) out.push(`приёмка с ${ru(dates.from)}`);
    if (dates.to) out.push(`приёмка по ${ru(dates.to)}`);
    return out;
  }, [q, min, max, dates.from, dates.to]);
  const activeFilters = (min != null ? 1 : 0) + (max != null ? 1 : 0) + (period !== 'all' ? 1 : 0);
  const whName = whs?.find((w) => w.id === warehouseId)?.name ?? null;

  const toggleGroup = (key: string) => setCollapsed((c) => { const n = new Set(c); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const toggleItem = (id: number) => setOpenItems((c) => { const n = new Set(c); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  function print() {
    const printLines = view === 'tree' ? flattenTree(tree) : lines;
    const base = { warehouse: whName, filters: filterNotes, sort };
    setFormJob({
      title: 'Ведомость остатков',
      subtitle: `${flat.length} наименований${filterNotes.length ? ' · ' + filterNotes.join(', ') : ''}`,
      variants: [
        { label: 'Кратко', build: (ctx) => stockReportForm(printLines, { ...ctx, ...base }) },
        { label: 'С местами хранения', build: (ctx) => stockReportForm(printLines, { ...ctx, ...base, withLots: true }) },
      ],
    });
  }

  const header = (
    <View>
      <SearchBox value={q} onChangeText={setQ} placeholder="Название, артикул, штрихкод" />
      {whs && whs.length > 1 ? (
        <Chips value={warehouseId} onChange={setWarehouseId} options={[{ value: 0, label: 'Все склады' }, ...whs.map((w) => ({ value: w.id, label: w.name }))]} />
      ) : null}
      <Chips value={view} onChange={setView} options={[{ value: 'tree' as View_, label: '▸ По группам' }, { value: 'list' as View_, label: '≣ Списком' }]} />
      <Chips value={sort} onChange={setSort} options={(Object.keys(STOCK_SORT_LABEL) as StockSort[]).map((k) => ({ value: k, label: STOCK_SORT_LABEL[k] }))} />

      <View style={s.rowWrap}>
        <Button title={`Фильтры${activeFilters ? ` (${activeFilters})` : ''}`} icon="⚲" variant={activeFilters ? 'secondary' : 'ghost'}
          style={{ flex: 1 }} onPress={() => setShowFilters((v) => !v)} />
        <Button title="Печать" icon="⎙" variant="ghost" style={{ flex: 1 }} disabled={!flat.length} onPress={print} />
      </View>

      {showFilters ? (
        <View style={[s.card, { marginTop: 8 }]}>
          <Text style={s.label}>Остаток (общий по товару)</Text>
          <View style={s.rowWrap}>
            <TextInput style={[s.input, { flex: 1 }, min === undefined && { borderColor: colors.danger }]} value={minQ} onChangeText={setMinQ}
              placeholder="от" placeholderTextColor={colors.muted} keyboardType="decimal-pad" />
            <TextInput style={[s.input, { flex: 1 }, max === undefined && { borderColor: colors.danger }]} value={maxQ} onChangeText={setMaxQ}
              placeholder="до" placeholderTextColor={colors.muted} keyboardType="decimal-pad" />
          </View>
          <Text style={[s.label, { marginTop: 10 }]}>Дата приёмки</Text>
          <Chips value={period} onChange={setPeriod} options={[
            { value: 'all' as Period, label: 'Любая' },
            { value: 'today' as Period, label: 'Сегодня' },
            { value: 'week' as Period, label: '7 дней' },
            { value: 'month' as Period, label: '30 дней' },
            { value: 'custom' as Period, label: 'Период…' },
          ]} />
          {period === 'custom' ? (
            <View style={s.rowWrap}>
              <TextInput style={[s.input, { flex: 1 }, parseDateInput(fromS) === undefined && { borderColor: colors.danger }]} value={fromS}
                onChangeText={setFromS} placeholder="с ДД.ММ.ГГГГ" placeholderTextColor={colors.muted} />
              <TextInput style={[s.input, { flex: 1 }, parseDateInput(toS) === undefined && { borderColor: colors.danger }]} value={toS}
                onChangeText={setToS} placeholder="по ДД.ММ.ГГГГ" placeholderTextColor={colors.muted} />
            </View>
          ) : null}
          {!dates.ok ? <Text style={{ color: colors.danger, marginTop: 4 }}>Дата в формате ДД.ММ.ГГГГ</Text> : null}
          <Muted>При отборе по дате приёмки учитываются только партии, принятые в этот период.</Muted>
          {activeFilters ? (
            <Button title="Сбросить фильтры" variant="ghost" onPress={() => { setMinQ(''); setMaxQ(''); setPeriod('all'); setFromS(''); setToS(''); }} />
          ) : null}
        </View>
      ) : null}

      <View style={[s.rowWrap, { alignItems: 'center', marginTop: 8, marginBottom: 6 }]}>
        <View style={{ flex: 1 }}>
          <Muted>{rows ? `Наименований: ${flat.length}${filterNotes.length ? ` · ${filterNotes.join(', ')}` : ''}` : 'Загрузка…'}</Muted>
        </View>
        {view === 'tree' && tree.length ? (
          <Pressable onPress={() => setCollapsed(collapsed.size ? new Set() : new Set(allGroupKeys(tree)))} style={{ padding: 6 }}>
            <Text style={{ color: colors.primary, fontWeight: '600' }}>{collapsed.size ? 'Развернуть всё' : 'Свернуть всё'}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );

  return (
    <View style={s.screen}>
      <FlatList
        contentContainerStyle={s.content}
        data={lines}
        keyExtractor={(l) => l.node.key}
        ListHeaderComponent={header}
        ListEmptyComponent={rows ? <Empty text={filterNotes.length ? 'Ничего не найдено по заданному отбору' : 'Склад пуст'} /> : null}
        renderItem={({ item: l }) =>
          l.kind === 'group' ? (
            <Pressable onPress={() => toggleGroup(l.node.key)}
              style={({ pressed }) => [{
                flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingRight: 12,
                paddingLeft: 12 + l.node.depth * 16, marginTop: l.node.depth ? 0 : 6,
                backgroundColor: l.node.depth ? colors.bg : colors.primarySoft, borderBottomWidth: 1, borderBottomColor: colors.border,
                borderRadius: l.node.depth ? 0 : 8,
              }, pressed && { opacity: 0.8 }]}>
              <Text style={{ width: 18, color: colors.primary, fontWeight: '700' }}>{l.open ? '▾' : '▸'}</Text>
              <Text style={{ flex: 1, fontWeight: '700', color: colors.text, fontSize: l.node.depth ? 15 : 16 }}>{l.node.name}</Text>
              <Text style={{ color: colors.muted, fontSize: 13 }}>
                {l.node.items} поз.{l.node.units.length === 1 ? ` · ${formatQty(l.node.qty)} ${l.node.units[0]}` : ''}
              </Text>
            </Pressable>
          ) : (
            <ItemRow node={l.node} depth={l.depth} showPath={view === 'list'} open={openItems.has(l.node.item_id)}
              onToggle={() => toggleItem(l.node.item_id)} />
          )
        }
      />
      <FormMenu job={formJob} onClose={() => setFormJob(null)} />
    </View>
  );
}

function ItemRow({ node, depth, showPath, open, onToggle }: {
  node: StockItemNode; depth: number; showPath: boolean; open: boolean; onToggle: () => void;
}) {
  const dates = node.first === node.last ? ru(node.first) : `${ru(node.first)} — ${ru(node.last)}`;
  return (
    <View style={{ backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <Pressable onPress={onToggle} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', padding: 12, paddingLeft: 12 + depth * 16 }, pressed && { opacity: 0.7 }]}>
        <View style={{ flex: 1 }}>
          <Text style={s.rowTitle}>{node.name}</Text>
          <Text style={s.rowSub}>{node.sku} · приёмка {dates}{node.lots.length > 1 ? ` · партий: ${node.lots.length}` : ''}{showPath ? `\n${node.path}` : ''}</Text>
        </View>
        <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text }}>{formatQty(node.qty)} {node.unit}</Text>
      </Pressable>
      {open ? (
        <View style={{ paddingLeft: 24 + depth * 16, paddingRight: 12, paddingBottom: 10 }}>
          {node.lots.map((lot) => (
            <View key={lot.id} style={{ flexDirection: 'row', paddingVertical: 4, borderTopWidth: 1, borderTopColor: colors.border }}>
              <Text style={{ flex: 1, color: colors.text, fontSize: 13 }}>
                {lot.is_buffer ? '⚑ ' : ''}{lot.address ?? '—'}{lot.box_code ? ` · короб ${lot.box_code}` : ''}{'\n'}
                <Text style={{ color: colors.muted }}>приёмка {ru(lot.received_at)}</Text>
              </Text>
              <Text style={{ color: colors.text, fontWeight: '600' }}>{formatQty(lot.qty)}</Text>
            </View>
          ))}
          <Pressable onPress={() => router.push({ pathname: '/item/[id]', params: { id: String(node.item_id) } })} style={{ paddingTop: 6 }}>
            <Text style={{ color: colors.primary, fontWeight: '600' }}>Карточка товара ›</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
