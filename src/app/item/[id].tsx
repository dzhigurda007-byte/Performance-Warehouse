import { useState } from 'react';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useApi, usePerms } from '../../lib/backend';
import { ScrollView, View } from 'react-native';
import { QrView } from '../../components/QrView';
import { Badge, Button, Card, Empty, H1, ListRow, Muted, Section, confirm, notify, s, showError, useFocusLoad } from '../../components/ui';
import { formatQty, itemQr } from '../../core/codes';
import { PrintMenu, type PrintJob } from '../../components/PrintMenu';

export default function ItemScreen() {
  const api = useApi();
  const perms = usePerms();
  const id = Number(useLocalSearchParams<{ id: string }>().id);
  const [printJob, setPrintJob] = useState<PrintJob | null>(null);
  const [data] = useFocusLoad(async () => ({
    item: await api.getItem(id),
    stock: await api.stockByItem(id),
    history: await api.listMoves({ itemId: id }),
  }), [api, id]);

  if (!data?.item) return null;
  const { item, stock, history } = data;
  const total = stock.reduce((a, r) => a + r.qty, 0);
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      <Stack.Screen options={{ title: item.sku }} />
      <Card>
        <H1>{item.name}</H1>
        <Muted>Артикул: {item.sku} · Ед.: {item.unit}{item.barcode ? ` · ШК: ${item.barcode}` : ''}</Muted>
        {item.description ? <Muted>{item.description}</Muted> : null}
        <QrView value={itemQr(item.sku)} caption={item.sku} size={130} />
        <View style={s.rowWrap}>
          {perms.manageItems ? (
            <Button title="Изменить" variant="ghost" style={{ flex: 1 }}
              onPress={() => router.push({ pathname: '/item/edit', params: { id: String(id) } })} />
          ) : null}
          <Button title="Этикетка" icon="⎙" variant="secondary" style={{ flex: 1 }}
            onPress={() => setPrintJob({ title: 'Печать этикеток', variants: [{ label: 'Товар', labels: () => [{ qr: itemQr(item.sku), title: item.sku, subtitle: item.name }] }] })} />
        </View>
        {item.deleted_at ? <Badge text={`Удалён из номенклатуры ${item.deleted_at.slice(0, 10)}`} tone="danger" /> : null}
        {perms.manageItems && !item.deleted_at ? (
          <Button title="Удалить из номенклатуры" variant="danger" onPress={() => confirm('Удалить товар из номенклатуры?',
            history.length
              ? `${item.name}\n\nУ товара есть история — он пропадёт из номенклатуры и поиска, а проведённые документы и история сохранятся.`
              : item.name,
            async () => {
              try {
                const r = await api.deleteItem(id);
                notify('Готово', r === 'deleted' ? 'Товар удалён из базы' : 'Товар убран из номенклатуры, история сохранена');
                router.back();
              } catch (e) {
                showError(e);
              }
            }, 'Удалить')} />
        ) : null}
      </Card>

      <Section title={`Остатки по местам · всего ${formatQty(total)} ${item.unit}`}>
        <View style={{ borderRadius: 12, overflow: 'hidden' }}>
          {stock.length ? stock.map((r) => (
            <ListRow key={r.id}
              title={r.address ?? '—'}
              left={r.box_code ? <Badge text={r.box_code} tone="primary" /> : <Badge text="ячейка" />}
              subtitle={`поступление с ${r.first_in_at.slice(0, 10)}`}
              right={`${formatQty(r.qty)} ${r.unit}`}
              onPress={() => r.box_id
                ? router.push({ pathname: '/box/[id]', params: { id: String(r.box_id) } })
                : router.push({ pathname: '/cell/[id]', params: { id: String(r.cell_id) } })} />
          )) : <Empty text="Нет на складе" />}
        </View>
      </Section>

      <Section title="История движений">
        <View style={{ borderRadius: 12, overflow: 'hidden' }}>
          {history.length ? history.slice(0, 100).map((m) => (
            <ListRow key={m.id}
              title={`${m.qty > 0 ? '+' : ''}${formatQty(m.qty)} ${m.unit} · ${m.address ?? '—'}${m.box_code ? ' · ' + m.box_code : ''}`}
              subtitle={`${m.created_at} · ${m.user_name}${m.recipient ? ' → ' + m.recipient : ''}`}
              right={m.doc_number ?? ''}
              onPress={m.doc_id ? () => router.push({ pathname: '/doc/[id]', params: { id: String(m.doc_id) } }) : undefined} />
          )) : <Empty text="Движений нет" />}
        </View>
      </Section>
      <PrintMenu job={printJob} onClose={() => setPrintJob(null)} />
    </ScrollView>
  );
}
