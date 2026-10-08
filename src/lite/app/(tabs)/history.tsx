import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { Chips } from '../../../components/Chips';
import { Badge, Button, Card, Empty, Field, Muted, colors, s, useFocusLoad } from '../../../components/ui';
import { formatQty } from '../../../core/codes';
import { CellPicker, ItemPicker } from '../../components/pickers';
import { ruDate } from '../../core/forms';
import { MOVE_TITLE, cells, history, items, type CellRow, type MoveKind } from '../../core/service';
import { useDb } from '../../lib/db';

type KindF = 'all' | MoveKind;
type Period = 'all' | 'today' | '7' | '30' | 'custom';

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** ДД.ММ.ГГГГ → ГГГГ-ММ-ДД (или null, если дата не введена / неверная). */
function ruToIso(s: string): string | null {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s.trim());
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
}
const num = (s: string) => {
  const n = Number(s.replace(',', '.').trim());
  return s.trim() && Number.isFinite(n) ? n : null;
};

const TONE: Record<MoveKind, 'success' | 'danger' | 'primary'> = { receipt: 'success', issue: 'danger', move: 'primary' };

/** История движений с фильтрами по номенклатуре, ячейке, дате и количеству. */
export default function HistoryTab() {
  const db = useDb();
  const params = useLocalSearchParams<{ itemId?: string; cellId?: string }>();
  const [item, setItem] = useState<{ id: number; name: string } | null>(null);
  const [cell, setCell] = useState<CellRow | null>(null);
  const [kind, setKind] = useState<KindF>('all');
  const [period, setPeriod] = useState<Period>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [minQty, setMinQty] = useState('');
  const [maxQty, setMaxQty] = useState('');
  const [pickItem, setPickItem] = useState(false);
  const [pickCell, setPickCell] = useState(false);
  const [open, setOpen] = useState(false);

  // переход из карточки товара: сразу фильтр по товару
  useEffect(() => {
    const idp = Number(params.itemId);
    if (idp) items.get(db, idp).then((i) => i && setItem({ id: i.id, name: i.name })).catch(() => undefined);
  }, [db, params.itemId]);
  useEffect(() => {
    const idp = Number(params.cellId);
    if (idp) cells.list(db).then((l) => setCell(l.find((c) => c.id === idp) ?? null)).catch(() => undefined);
  }, [db, params.cellId]);

  let dFrom: string | null = null;
  let dTo: string | null = null;
  const now = new Date();
  if (period === 'today') dFrom = iso(now);
  if (period === '7' || period === '30') dFrom = iso(new Date(now.getTime() - (Number(period) - 1) * 86400000));
  if (period === 'custom') {
    dFrom = ruToIso(from);
    dTo = ruToIso(to);
  }

  const [list] = useFocusLoad(() => history(db, {
    itemId: item?.id, cellId: cell?.id, kind: kind === 'all' ? null : kind,
    from: dFrom, to: dTo, minQty: num(minQty), maxQty: num(maxQty),
  }), [db, item?.id, cell?.id, kind, dFrom, dTo, minQty, maxQty]);

  const active = [item, cell, kind !== 'all', period !== 'all', num(minQty) !== null, num(maxQty) !== null].filter(Boolean).length;
  const reset = () => {
    setItem(null); setCell(null); setKind('all'); setPeriod('all'); setFrom(''); setTo(''); setMinQty(''); setMaxQty('');
    router.setParams({ itemId: undefined, cellId: undefined });
  };

  return (
    <View style={s.screen}>
      <FlatList
        contentContainerStyle={s.content}
        data={list ?? []}
        keyExtractor={(m) => String(m.id)}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View>
            <Chips value={kind} onChange={setKind} options={[
              { value: 'all' as KindF, label: 'Все' },
              { value: 'receipt' as KindF, label: '↓ Приход' },
              { value: 'issue' as KindF, label: '↑ Расход' },
              { value: 'move' as KindF, label: '⇄ Перемещение' },
            ]} />
            <Chips value={period} onChange={setPeriod} options={[
              { value: 'all' as Period, label: 'За всё время' },
              { value: 'today' as Period, label: 'Сегодня' },
              { value: '7' as Period, label: '7 дней' },
              { value: '30' as Period, label: '30 дней' },
              { value: 'custom' as Period, label: 'Период…' },
            ]} />
            {period === 'custom' ? (
              <View style={s.rowWrap}>
                <View style={{ flex: 1 }}><Field label="С даты" value={from} onChangeText={setFrom} placeholder="ДД.ММ.ГГГГ" keyboardType="numbers-and-punctuation" /></View>
                <View style={{ flex: 1 }}><Field label="По дату" value={to} onChangeText={setTo} placeholder="ДД.ММ.ГГГГ" keyboardType="numbers-and-punctuation" /></View>
              </View>
            ) : null}
            <View style={s.rowWrap}>
              <Button title={item ? `Товар: ${item.name}` : 'Номенклатура: все'} variant={item ? 'secondary' : 'ghost'} style={{ flex: 1 }}
                onPress={() => setPickItem(true)} />
              {item ? <Button title="✕" variant="ghost" onPress={() => { setItem(null); router.setParams({ itemId: undefined }); }} /> : null}
            </View>
            <View style={s.rowWrap}>
              <Button title={cell ? `Ячейка: ${cell.code}` : 'Ячейки: все'} variant={cell ? 'secondary' : 'ghost'} style={{ flex: 1 }}
                onPress={() => setPickCell(true)} />
              {cell ? <Button title="✕" variant="ghost" onPress={() => { setCell(null); router.setParams({ cellId: undefined }); }} /> : null}
            </View>
            <Pressable onPress={() => setOpen((v) => !v)} style={{ paddingVertical: 8 }}>
              <Text style={{ color: colors.primary }}>{open ? '▾' : '▸'} Количество от / до</Text>
            </Pressable>
            {open || minQty || maxQty ? (
              <View style={s.rowWrap}>
                <View style={{ flex: 1 }}><Field label="Количество от" value={minQty} onChangeText={setMinQty} keyboardType="decimal-pad" /></View>
                <View style={{ flex: 1 }}><Field label="до" value={maxQty} onChangeText={setMaxQty} keyboardType="decimal-pad" /></View>
              </View>
            ) : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <Text style={s.section}>Движений: {list?.length ?? 0}</Text>
              {active ? <Pressable onPress={reset}><Text style={{ color: colors.primary }}>Сбросить фильтры ({active})</Text></Pressable> : null}
            </View>
          </View>
        }
        ListEmptyComponent={list ? <Empty text="Движений нет" /> : null}
        renderItem={({ item: m }) => (
          <Pressable disabled={!m.order_id} onPress={() => router.push({ pathname: '/order/[id]', params: { id: String(m.order_id) } })}>
            <Card style={{ marginBottom: 6, padding: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Badge text={MOVE_TITLE[m.kind]} tone={TONE[m.kind]} />
                <Muted>{ruDate(m.at, true)}{m.order_number ? ` · ${m.order_number}` : ''}</Muted>
                <View style={{ flex: 1 }} />
                <Text style={{ fontSize: 17, fontWeight: '800', color: m.kind === 'receipt' ? colors.success : m.kind === 'issue' ? colors.danger : colors.text }}>
                  {m.kind === 'receipt' ? '+' : m.kind === 'issue' ? '−' : ''}{formatQty(m.qty)} {m.unit}
                </Text>
              </View>
              <Text style={{ fontSize: 15, fontWeight: '600', color: colors.text, marginTop: 6 }}>{m.name}</Text>
              <Muted>
                {[`Арт. ${m.article}`, m.spp ? `SPP ${m.spp}` : null,
                  m.kind === 'move' ? `${m.cell_code} → ${m.to_cell_code}` : `ячейка ${m.cell_code}`].filter(Boolean).join(' · ')}
              </Muted>
            </Card>
          </Pressable>
        )}
      />
      <ItemPicker visible={pickItem} title="Фильтр по товару" onClose={() => setPickItem(false)}
        onPick={(i) => { setPickItem(false); setItem({ id: i.id, name: i.name }); }} />
      <CellPicker visible={pickCell} title="Фильтр по ячейке" onClose={() => setPickCell(false)}
        onPick={(c) => { setPickCell(false); setCell(c); }} />
    </View>
  );
}
