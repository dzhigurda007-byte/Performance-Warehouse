import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useApi } from '../../lib/backend';
import { useState } from 'react';
import { Alert, ScrollView, TextInput, View } from 'react-native';
import { Button, Card, Empty, H1, ListRow, Muted, Section, confirm, s, showError, useFocusLoad } from '../../components/ui';
import { cellQr, formatAddress } from '../../core/codes';
import { printLabels } from '../../lib/print';

export default function RackScreen() {
  const api = useApi();
  const id = Number(useLocalSearchParams<{ id: string }>().id);
  const [levels, setLevels] = useState('4');
  const [positions, setPositions] = useState('5');
  const [single, setSingle] = useState('');
  const [data, reload] = useFocusLoad(async () => ({
    rack: await api.getRack(id),
    cells: await api.listCells(id),
  }), [api, id]);

  async function bulk() {
    try {
      const n = await api.addCells(id, Number(levels), Number(positions));
      Alert.alert('Готово', `Создано ячеек: ${n}`);
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
  const { rack, cells } = data;
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: `Стеллаж ${rack.code}` }} />
      <Card>
        <H1>Стеллаж {rack.code}</H1>
        <Muted>Склад: {rack.warehouse_code} — {rack.warehouse_name}</Muted>
        <Button title="Печать QR ячеек стеллажа" icon="⎙" variant="secondary" disabled={!cells.length}
          onPress={() => printLabels(cells.map((c) => ({
            qr: cellQr(c.id),
            title: formatAddress(rack.warehouse_code, rack.code, c.code),
          }))).catch(showError)} />
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

      <Section title={`Ячейки (${cells.length})`}>
        <View style={{ borderRadius: 12, overflow: 'hidden' }}>
          {cells.length ? cells.map((c) => (
            <ListRow key={c.id} title={`Ячейка ${c.code}`}
              subtitle={c.positions || c.boxes ? `позиций россыпью: ${c.positions}, коробов: ${c.boxes}` : 'пусто'}
              right="›" onPress={() => router.push({ pathname: '/cell/[id]', params: { id: String(c.id) } })} />
          )) : <Empty text="Ячеек нет" />}
        </View>
      </Section>
    </ScrollView>
  );
}
