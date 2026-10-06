import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useApi } from '../../lib/backend';
import { useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { Button, Card, Empty, H1, ListRow, Muted, Section, confirm, s, showError, useFocusLoad } from '../../components/ui';
import { PrintMenu, type PrintJob } from '../../components/PrintMenu';
import { rackLabels } from '../../lib/labels';

export default function WarehouseScreen() {
  const api = useApi();
  const id = Number(useLocalSearchParams<{ id: string }>().id);
  const [code, setCode] = useState('');
  const [job, setJob] = useState<PrintJob | null>(null);
  const [data, reload] = useFocusLoad(async () => ({
    wh: await api.getWarehouse(id),
    racks: await api.listRacks(id),
  }), [api, id]);

  async function addRack() {
    try {
      await api.addRack(id, code);
      setCode('');
      reload();
    } catch (e) {
      showError(e);
    }
  }

  /** Все стеллажи склада: для каждого — лист с QR стеллажа, затем его ячейки. */
  async function allLabels(withCells: boolean) {
    const wh = data!.wh!;
    const out = [];
    for (const r of data!.racks) {
      const cells = withCells ? await api.listCells(r.id) : [];
      out.push(...rackLabels({ ...r, warehouse_code: wh.code, warehouse_name: wh.name }, cells, withCells));
    }
    return out;
  }

  if (!data?.wh) return null;
  const { wh, racks } = data;
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: wh.code }} />
      <Card>
        <H1>{wh.name}</H1>
        <Muted>Код: {wh.code}{wh.address ? ` · ${wh.address}` : ''}</Muted>
        <View style={[s.rowWrap, { marginTop: 8 }]}>
          <Button title="Изменить" variant="ghost" style={{ flex: 1 }}
            onPress={() => router.push({ pathname: '/warehouse/edit', params: { id: String(id) } })} />
          <Button title="Удалить" variant="danger" style={{ flex: 1 }}
            onPress={() => confirm('Удалить склад?', 'Склад, стеллажи и ячейки будут удалены', async () => {
              try {
                await api.deleteWarehouse(id);
                router.back();
              } catch (e) {
                showError(e);
              }
            })} />
        </View>
        <Button title="Печать QR стеллажей и ячеек склада" icon="⎙" variant="secondary" onPress={() => setJob({
            title: `Печать: ${wh.name}`,
            subtitle: 'QR каждого стеллажа печатается на отдельном листе, за ним — его ячейки',
            variants: [
              { label: 'Стеллажи и ячейки', labels: () => allLabels(true) },
              { label: 'Только стеллажи', labels: () => allLabels(false) },
            ],
          })} />
      </Card>

      <Section title="Стеллажи">
        <View style={[s.rowWrap, { marginBottom: 8 }]}>
          <TextInput style={[s.input, { flex: 1 }]} placeholder="Код стеллажа, напр. A" value={code}
            onChangeText={setCode} autoCapitalize="characters" onSubmitEditing={addRack} />
          <Button title="Добавить" onPress={addRack} />
        </View>
        <View style={{ borderRadius: 12, overflow: 'hidden' }}>
          {racks.length ? racks.map((r) => (
            <ListRow key={r.id} title={`Стеллаж ${r.code}`} subtitle={`${r.name ? r.name + ' · ' : ''}ячеек: ${r.cells}`}
              right="›" onPress={() => router.push({ pathname: '/rack/[id]', params: { id: String(r.id) } })} />
          )) : <Empty text="Стеллажей нет" />}
        </View>
      </Section>
      <PrintMenu job={job} onClose={() => setJob(null)} />
    </ScrollView>
  );
}
