import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { PlacePicker } from '../../components/pickers';
import { QrView } from '../../components/QrView';
import { Button, Card, Empty, Field, H1, ListRow, Muted, Section, confirm, s, showError, useFocusLoad } from '../../components/ui';
import * as repo from '../../db/repo';
import { boxQr, formatQty } from '../../domain/codes';
import { useUser } from '../../lib/auth-context';
import { printLabels } from '../../lib/print';

export default function BoxScreen() {
  const db = useSQLiteContext();
  const user = useUser();
  const id = Number(useLocalSearchParams<{ id: string }>().id);
  const [moving, setMoving] = useState(false);
  const [name, setName] = useState('');
  const [data, reload] = useFocusLoad(async () => ({
    box: await repo.getBox(db, id),
    content: await repo.stockInBox(db, id),
    history: await repo.listMoves(db, { boxId: id }),
  }), [db, id]);

  useEffect(() => setName(data?.box?.name ?? ''), [data?.box?.name]);

  if (!data?.box) return null;
  const { box, content, history } = data;
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: box.code }} />
      <Card>
        <H1>Короб {box.code}</H1>
        <Muted>Место: {box.address ?? 'не размещён'}</Muted>
        <QrView value={boxQr(box.code)} caption={box.code} />
        <Field label="Описание короба" value={name} onChangeText={setName} placeholder="напр. Крепёж М8"
          onEndEditing={() => repo.renameBox(db, id, name).catch(showError)} />
        <View style={s.rowWrap}>
          <Button title="Печать" icon="⎙" variant="secondary" style={{ flex: 1 }}
            onPress={() => printLabels([{ qr: boxQr(box.code), title: box.code, subtitle: name || box.address || '' }])
              .catch(showError)} />
          <Button title="Переместить" icon="⇄" variant="secondary" style={{ flex: 1 }} onPress={() => setMoving(true)} />
        </View>
        {!content.length ? (
          <Button title="Удалить пустой короб" variant="danger"
            onPress={() => confirm('Удалить короб?', box.code, async () => {
              try {
                await repo.deleteBox(db, id);
                router.back();
              } catch (e) {
                showError(e);
              }
            })} />
        ) : null}
      </Card>

      <Section title={`Содержимое (${content.length})`}>
        <View style={{ borderRadius: 12, overflow: 'hidden' }}>
          {content.length ? content.map((r) => (
            <ListRow key={r.id} title={r.item_name} subtitle={r.sku} right={`${formatQty(r.qty)} ${r.unit}`}
              onPress={() => router.push({ pathname: '/item/[id]', params: { id: String(r.item_id) } })} />
          )) : <Empty text="Короб пуст" />}
        </View>
      </Section>

      <Section title="Движения по коробу">
        <View style={{ borderRadius: 12, overflow: 'hidden' }}>
          {history.length ? history.slice(0, 50).map((m) => (
            <ListRow key={m.id} title={`${m.qty > 0 ? '+' : ''}${formatQty(m.qty)} ${m.unit} · ${m.item_name}`}
              subtitle={`${m.created_at} · ${m.user_name}${m.recipient ? ' → ' + m.recipient : ''} · ${m.doc_number ?? ''}`} />
          )) : <Empty text="Движений нет" />}
        </View>
      </Section>

      <PlacePicker visible={moving} cellOnly title="Новая ячейка для короба" onClose={() => setMoving(false)}
        onPick={async (p) => {
          setMoving(false);
          try {
            await repo.moveBox(db, id, p.cellId!, user.id);
            reload();
            Alert.alert('Готово', `Короб перемещён: ${p.label}`);
          } catch (e) {
            showError(e);
          }
        }} />
    </ScrollView>
  );
}
