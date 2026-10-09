import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Chips } from '../../../components/Chips';
import { Button, Card, Empty, Field, Muted, Section, colors, confirm, notify, s, showError, useFocusLoad } from '../../../components/ui';
import { formatQty } from '../../../core/codes';
import { LAYOUT_LABEL, labelsHtml, type LabelLayout } from '../../../lib/labelsHtml';
import { saveHtml } from '../../../lib/printHtml';
import { cells, racks, type CellRow } from '../../core/service';
import { useDb } from '../../lib/db';
import { cellLabel } from '../../lib/labels';

/** Ряд стеллажей: полки и ячейки, QR-этикетки по полке или на весь ряд, изменение размера. */
export default function RackScreen() {
  const db = useDb();
  const id = Number(useLocalSearchParams<{ id: string }>().id);
  const [shelf, setShelf] = useState(1);
  const [layout, setLayout] = useState<LabelLayout>('sheet');
  const [data, reload] = useFocusLoad(async () => ({ rack: await racks.get(db, id), cells: await cells.list(db, '', { rackId: id }) }), [db, id]);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [shelves, setShelves] = useState('');
  const [perShelf, setPerShelf] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    const r = data?.rack;
    if (r) { setCode(r.code); setName(r.name ?? ''); setShelves(String(r.shelves)); setPerShelf(String(r.cells_per_shelf)); }
  }, [data?.rack]);

  if (data && !data.rack) return <Empty text="Ряд не найден" />;
  const rack = data?.rack;
  if (!rack) return null;
  const all = data.cells;
  const onShelf = all.filter((c) => c.shelf === shelf);

  async function labels(list: CellRow[], what: string) {
    setBusy(what);
    try {
      await saveHtml(labelsHtml(list.map(cellLabel), layout), `Этикетки ${what}`);
    } catch (e) {
      showError(e);
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    try {
      const r = await racks.save(db, { id, code, name, shelves: Number(shelves), cellsPerShelf: Number(perShelf) });
      notify('Сохранено', [r.added ? `добавлено ячеек: ${r.added}` : '', r.removed ? `удалено ячеек: ${r.removed}` : ''].filter(Boolean).join(', '));
      if (shelf > Number(shelves)) setShelf(1);
      reload();
    } catch (e) {
      showError(e);
    }
  }

  function remove() {
    confirm(`Удалить ряд ${rack!.code}?`, `Будут удалены все ${all.length} ячеек ряда. Можно только если ячейки не использовались.`, async () => {
      try {
        await racks.remove(db, id);
        router.back();
      } catch (e) {
        showError(e);
      }
    }, 'Удалить');
  }

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: `Ряд ${rack.code}` }} />
      <Card>
        <Text style={{ fontSize: 18, fontWeight: '800', color: colors.text }}>Ряд {rack.code}{rack.name ? ` — ${rack.name}` : ''}</Text>
        <Muted>{rack.shelves} полок × {rack.cells_per_shelf} ячеек = {all.length} · занято {all.filter((c) => c.positions).length}</Muted>
      </Card>

      <Section title="Полки (1 — нижняя)">
        <Chips value={shelf} onChange={setShelf}
          options={Array.from({ length: rack.shelves }, (_, i) => i + 1).map((n) => ({ value: n, label: `Полка ${n}` }))} />
        <Chips value={layout} onChange={setLayout} options={(Object.keys(LAYOUT_LABEL) as LabelLayout[]).map((v) => ({ value: v, label: LAYOUT_LABEL[v] }))} />
        <View style={s.rowWrap}>
          <Button title={`QR полки ${shelf} (${onShelf.length})`} icon="⇪" style={{ flex: 1 }} busy={busy === 'shelf'}
            onPress={() => labels(onShelf, `ряд ${rack.code} полка ${shelf}`)} />
          <Button title={`Весь ряд (${all.length})`} icon="⇪" variant="secondary" style={{ flex: 1 }} busy={busy === 'rack'}
            onPress={() => labels(all, `ряд ${rack.code}`)} />
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
          {onShelf.map((c) => (
            <ListRowTile key={c.id} c={c} onPress={() => router.push({ pathname: '/cell/[id]', params: { id: String(c.id) } })} />
          ))}
        </View>
        <Muted>Зелёные — в ячейке есть товар. Нажмите на ячейку, чтобы открыть её.</Muted>
      </Section>

      <Section title="Размер ряда">
        <Card>
          <View style={s.rowWrap}>
            <View style={{ width: 80 }}><Field label="Ряд" value={code} onChangeText={setCode} autoCapitalize="characters" /></View>
            <View style={{ flex: 1 }}><Field label="Полок" value={shelves} onChangeText={setShelves} keyboardType="number-pad" /></View>
            <View style={{ flex: 1 }}><Field label="Ячеек на полке" value={perShelf} onChangeText={setPerShelf} keyboardType="number-pad" /></View>
          </View>
          <Field label="Описание" value={name} onChangeText={setName} placeholder="необяз." />
          <Muted>Добавленные полки и ячейки создадутся сами. Уменьшить можно, только если лишние ячейки не использовались.</Muted>
          <Button title="Сохранить" onPress={save} />
        </Card>
        <Button title="Удалить ряд" variant="danger" onPress={remove} />
      </Section>
    </ScrollView>
  );
}

function ListRowTile({ c, onPress }: { c: CellRow; onPress: () => void }) {
  const full = c.positions > 0;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [{
      width: '23.5%', paddingVertical: 8, borderRadius: 8, alignItems: 'center', borderWidth: 1,
      backgroundColor: full ? colors.successSoft : colors.card, borderColor: full ? colors.success : colors.border,
    }, pressed && { opacity: 0.7 }]}>
      <Text style={{ fontWeight: '700', color: colors.text, fontSize: 13 }}>{c.code}</Text>
      <Text style={{ color: colors.muted, fontSize: 11 }}>{full ? `${formatQty(c.qty)} шт.` : 'пусто'}</Text>
    </Pressable>
  );
}
