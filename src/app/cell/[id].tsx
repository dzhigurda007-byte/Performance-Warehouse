import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useApi } from '../../lib/backend';
import { ScrollView, View } from 'react-native';
import { QrView } from '../../components/QrView';
import { Badge, Button, Card, Empty, H1, ListRow, Muted, Section, confirm, s, showError, useFocusLoad } from '../../components/ui';
import { useState } from 'react';
import { PrintMenu, type PrintJob } from '../../components/PrintMenu';
import { cellQr, formatQty } from '../../core/codes';
import { cellTitle } from '../../lib/labels';

export default function CellScreen() {
  const api = useApi();
  const id = Number(useLocalSearchParams<{ id: string }>().id);
  const [job, setJob] = useState<PrintJob | null>(null);
  const [data, reload] = useFocusLoad(async () => ({
    cell: await api.getCell(id),
    loose: await api.stockLooseInCell(id),
    boxes: await api.listBoxesInCell(id),
  }), [api, id]);

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
            onPress={() => setJob({ title: `Этикетка ячейки ${cell.code}`, variants: [{
              label: 'Ячейка',
              labels: () => [{ qr: cellQr(cell.id), title: cellTitle(cell.rack_code, cell.code), subtitle: `${cell.address} · ${cell.warehouse_name}` }],
            }] })} />
          <Button title="Удалить" variant="danger"
            onPress={() => confirm('Удалить ячейку?', cell.address, async () => {
              try {
                await api.deleteCell(id);
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
              const b = await api.createBox(id);
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

      {cell.is_buffer ? <Muted>Буферная ячейка: сюда попадает приход с ПК / из Excel и возвраты. Нажмите на товар, чтобы переместить его в ячейку хранения.</Muted> : null}
      <Section title={`Товары без короба (${loose.length})`}>
        <View style={{ borderRadius: 12, overflow: 'hidden' }}>
          {loose.length ? loose.map((r) => (
            <ListRow key={r.id} title={r.item_name} subtitle={`${r.sku} · приёмка ${r.received_at}`}
              right={`${formatQty(r.qty)} ${r.unit}`}
              onPress={() => router.push({ pathname: '/move', params: { cellId: String(id), itemId: String(r.item_id), lot: r.received_at } })}
              onLongPress={() => router.push({ pathname: '/item/[id]', params: { id: String(r.item_id) } })} />
          )) : <Empty text="Пусто" />}
        </View>
      </Section>
      <PrintMenu job={job} onClose={() => setJob(null)} />
    </ScrollView>
  );
}
