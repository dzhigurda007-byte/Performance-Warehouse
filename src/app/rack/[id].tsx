import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useApi } from '../../lib/backend';
import { useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { PrintMenu, type PrintJob } from '../../components/PrintMenu';
import { QrView } from '../../components/QrView';
import { Button, Card, Empty, H1, ListRow, Muted, Section, confirm, notify, s, showError, useFocusLoad } from '../../components/ui';
import { formatQty, rackQr } from '../../core/codes';
import { cellLabel, rackLabel, rackLabels } from '../../lib/labels';

export default function RackScreen() {
  const api = useApi();
  const id = Number(useLocalSearchParams<{ id: string }>().id);
  const [levels, setLevels] = useState('4');
  const [positions, setPositions] = useState('5');
  const [single, setSingle] = useState('');
  const [job, setJob] = useState<PrintJob | null>(null);
  const [data, reload] = useFocusLoad(async () => ({
    rack: await api.getRack(id),
    cells: await api.listCells(id),
    stock: await api.stockInRack(id),
  }), [api, id]);

  async function bulk() {
    try {
      const n = await api.addCells(id, Number(levels), Number(positions));
      notify('Готово', `Создано ячеек: ${n}`);
      reload();
    } catch (e) {
      showError(e);
    }
  }

  async function addOne() {
    try {
      await api.addCell(id, single);
      setSingle('');
      reload();
    } catch (e) {
      showError(e);
    }
  }

  if (!data?.rack) return null;
  const { rack, cells, stock } = data;
  // Что хранится на стеллаже в целом: сводка по товарам
  const summary = new Map<number, { name: string; sku: string; unit: string; qty: number; places: Set<string> }>();
  for (const r of stock) {
    const cur = summary.get(r.item_id) ?? { name: r.item_name, sku: r.sku, unit: r.unit, qty: 0, places: new Set<string>() };
    cur.qty += r.qty;
    cur.places.add(r.box_code ? `${r.address?.split(' / ').pop()} · ${r.box_code}` : r.address?.split(' / ').pop() ?? '');
    summary.set(r.item_id, cur);
  }
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: `Стеллаж ${rack.code}` }} />
      <Card>
        <H1>Стеллаж {rack.code}</H1>
        <Muted>Склад: {rack.warehouse_code} — {rack.warehouse_name}</Muted>
        <QrView value={rackQr(rack.id)} size={150} caption={`Стеллаж ${rack.code} — отсканируйте, чтобы увидеть, что на нём хранится`} />
        <Button title="Печать QR стеллажа и ячеек" icon="⎙" variant="secondary"
          onPress={() => setJob({
            title: `Печать: стеллаж ${rack.code}`,
            subtitle: 'QR стеллажа всегда печатается на отдельном листе',
            variants: [
              ...(cells.length ? [{ label: 'Стеллаж и все ячейки', labels: () => rackLabels(rack, cells) }] : []),
              ...(cells.length ? [{ label: 'Только ячейки', labels: () => cells.map((c) => cellLabel(rack, c)) }] : []),
              { label: 'Только стеллаж', labels: () => [rackLabel(rack)] },
            ],
          })} />
        <Button title="Удалить стеллаж" variant="danger"
          onPress={() => confirm('Удалить стеллаж?', 'Будут удалены и все его ячейки', async () => {
            try {
              await api.deleteRack(id);
              router.back();
            } catch (e) {
              showError(e);
            }
          })} />
      </Card>

      <Section title="Создать ячейки сеткой (ярус × место)">
        <Card>
          <View style={s.rowWrap}>
            <TextInput style={[s.input, { flex: 1 }]} keyboardType="number-pad" value={levels} onChangeText={setLevels}
              placeholder="Ярусов" />
            <TextInput style={[s.input, { flex: 1 }]} keyboardType="number-pad" value={positions}
              onChangeText={setPositions} placeholder="Мест на ярусе" />
          </View>
          <Muted>Коды ячеек: 1-01, 1-02 … (ярус-место). Существующие не дублируются.</Muted>
          <Button title="Создать" onPress={bulk} />
          <View style={[s.rowWrap, { marginTop: 8 }]}>
            <TextInput style={[s.input, { flex: 1 }]} placeholder="или одна ячейка с кодом…" value={single}
              onChangeText={setSingle} autoCapitalize="characters" onSubmitEditing={addOne} />
            <Button title="+" onPress={addOne} />
          </View>
        </Card>
      </Section>

      <Section title={`Что хранится на стеллаже · ${summary.size} наим.`}>
        <View style={{ borderRadius: 12, overflow: 'hidden' }}>
          {summary.size ? [...summary.entries()].map(([itemId, v]) => (
            <ListRow key={itemId} title={v.name} subtitle={`${v.sku} · ${[...v.places].join(', ')}`}
              right={`${formatQty(v.qty)} ${v.unit}`}
              onPress={() => router.push({ pathname: '/item/[id]', params: { id: String(itemId) } })} />
          )) : <Empty text="Стеллаж пуст" />}
        </View>
      </Section>

      <Section title={`Ячейки (${cells.length})`}>
        <View style={{ borderRadius: 12, overflow: 'hidden' }}>
          {cells.length ? cells.map((c) => (
            <ListRow key={c.id} title={`Ячейка ${c.code}`}
              subtitle={c.positions || c.boxes ? `позиций россыпью: ${c.positions}, коробов: ${c.boxes}` : 'пусто'}
              right="›" onPress={() => router.push({ pathname: '/cell/[id]', params: { id: String(c.id) } })} />
          )) : <Empty text="Ячеек нет" />}
        </View>
      </Section>
      <PrintMenu job={job} onClose={() => setJob(null)} />
    </ScrollView>
  );
}
