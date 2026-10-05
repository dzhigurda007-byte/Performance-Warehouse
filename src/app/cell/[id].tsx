import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { ScrollView, View } from 'react-native';
import { QrView } from '../../components/QrView';
import { Badge, Button, Card, Empty, H1, ListRow, Muted, Section, confirm, s, showError, useFocusLoad } from '../../components/ui';
import * as repo from '../../db/repo';
import { cellQr, formatQty } from '../../domain/codes';
import { printLabels } from '../../lib/print';

export default function CellScreen() {
  const db = useSQLiteContext();
  const id = Number(useLocalSearchParams<{ id: string }>().id);
  const [data, reload] = useFocusLoad(async () => ({
    cell: await repo.getCell(db, id),
    loose: await repo.stockLooseInCell(db, id),
    boxes: await repo.listBoxesInCell(db, id),
  }), [db, id]);

  if (!data?.cell) return null;
  const { cell, loose, boxes } = data;
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      <Stack.Screen options={{ title: `Ячейка ${cell.code}` }} />
      <Card>
        <H1>{cell.address}</H1>
        <Muted>{cell.warehouse_name}</Muted>
        <QrView value={cellQr(cell.id)} />
        <View style={s.rowWrap}>
          <Button title="Печать этикетки" icon="⎙" variant="secondary" style={{ flex: 1 }}
            onPress={() => printLabels([{ qr: cellQr(cell.id), title: cell.address, subtitle: cell.warehouse_name }])
              .catch(showError)} />
          <Button title="Удалить" variant="danger"
            onPress={() => confirm('Удалить ячейку?', cell.address, async () => {
              try {
                await repo.deleteCell(db, id);
                router.back();
              } catch (e) {
                showError(e);
              }
            })} />
        </View>
      </Card>

      <Section title={`Короба (${boxes.length})`} action={
        <Button title="+ Короб" variant="secondary" style={{ minHeight: 34, marginVertical: 0 }}
          onPress={async () => {
            try {
              const b = await repo.createBox(db, id);
              reload();
              router.push({ pathname: '/box/[id]', params: { id: String(b.id) } });
            } catch (e) {
              showError(e);
            }
          }} />
      }>
        <View style={{ borderRadius: 12, overflow: 'hidden' }}>
          {boxes.length ? boxes.map((b) => (
            <ListRow key={b.id} title={`Короб ${b.code}`} left={<Badge text="▣" tone="primary" />}
              subtitle={`${b.name ? b.name + ' · ' : ''}позиций: ${b.positions}, ед.: ${formatQty(b.total)}`}
              right="›" onPress={() => router.push({ pathname: '/box/[id]', params: { id: String(b.id) } })} />
          )) : <Empty text="Коробов нет" />}
        </View>
      </Section>

      <Section title={`Товары без короба (${loose.length})`}>
        <View style={{ borderRadius: 12, overflow: 'hidden' }}>
          {loose.length ? loose.map((r) => (
            <ListRow key={r.id} title={r.item_name} subtitle={`${r.sku} · с ${r.first_in_at.slice(0, 10)}`}
              right={`${formatQty(r.qty)} ${r.unit}`}
              onPress={() => router.push({ pathname: '/item/[id]', params: { id: String(r.item_id) } })} />
          )) : <Empty text="Пусто" />}
        </View>
      </Section>
    </ScrollView>
  );
}
