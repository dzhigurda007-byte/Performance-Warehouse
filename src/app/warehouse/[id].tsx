import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { Button, Card, Empty, H1, ListRow, Muted, Section, confirm, s, showError, useFocusLoad } from '../../components/ui';
import * as repo from '../../db/repo';
import { cellQr } from '../../domain/codes';
import { printLabels } from '../../lib/print';

export default function WarehouseScreen() {
  const db = useSQLiteContext();
  const id = Number(useLocalSearchParams<{ id: string }>().id);
  const [code, setCode] = useState('');
  const [data, reload] = useFocusLoad(async () => ({
    wh: await repo.getWarehouse(db, id),
    racks: await repo.listRacks(db, id),
  }), [db, id]);

  async function addRack() {
    try {
      await repo.addRack(db, id, code);
      setCode('');
      reload();
    } catch (e) {
      showError(e);
    }
  }

  async function printAll() {
    const cells = await repo.listCellsOfWarehouse(db, id);
    if (!cells.length) return showError(new Error('На складе нет ячеек'));
    await printLabels(cells.map((c) => ({ qr: cellQr(c.id), title: c.address, subtitle: c.warehouse_name })));
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
                await repo.deleteWarehouse(db, id);
                router.back();
              } catch (e) {
                showError(e);
              }
            })} />
        </View>
        <Button title="Печать QR всех ячеек склада" icon="⎙" variant="secondary" onPress={() => printAll().catch(showError)} />
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
    </ScrollView>
  );
}
