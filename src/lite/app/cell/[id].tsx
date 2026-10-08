import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { QrView } from '../../../components/QrView';
import { Button, Card, Empty, Field, ListRow, Section, confirm, notify, s, showError, useFocusLoad } from '../../../components/ui';
import { formatQty } from '../../../core/codes';
import { labelsHtml } from '../../../lib/labelsHtml';
import { saveHtml } from '../../../lib/printHtml';
import { MAIN_CELL_CODE } from '../../core/schema';
import { cellQr, cells } from '../../core/service';
import { useDb } from '../../lib/db';
import { cellLabel } from '../../lib/labels';

/** Ячейка: код, описание, что в ней лежит, QR-этикетка. */
export default function CellScreen() {
  const db = useDb();
  const id = Number(useLocalSearchParams<{ id: string }>().id);
  const [data, reload] = useFocusLoad(async () => ({ cell: await cells.get(db, id), items: await cells.contents(db, id) }), [db, id]);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [comment, setComment] = useState('');
  useEffect(() => {
    const c = data?.cell;
    if (c) { setCode(c.code); setName(c.name ?? ''); setComment(c.comment ?? ''); }
  }, [data?.cell]);

  if (data && !data.cell) return <Empty text="Ячейка не найдена" />;
  const cell = data?.cell;
  if (!cell) return null;

  async function save() {
    try {
      await cells.save(db, { id, code, name, comment });
      notify('Сохранено');
      reload();
    } catch (e) {
      showError(e);
    }
  }

  function remove() {
    confirm('Удалить ячейку?', cell!.code, async () => {
      try {
        await cells.remove(db, id);
        router.back();
      } catch (e) {
        showError(e);
      }
    }, 'Удалить');
  }

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: `Ячейка ${cell.code}` }} />
      <Card style={{ alignItems: 'center' }}>
        <QrView value={cellQr(cell.code)} size={170} />
        <Button title="QR-этикетка (PDF)" icon="⇪" variant="secondary"
          onPress={() => saveHtml(labelsHtml([cellLabel(cell)], 'single'), `Ячейка ${cell.code}`).catch(showError)} />
      </Card>
      <Card>
        <Field label="Код" value={code} onChangeText={setCode} autoCapitalize="characters" editable={cell.code !== MAIN_CELL_CODE} />
        <Field label="Описание" value={name} onChangeText={setName} />
        <Field label="Комментарий" value={comment} onChangeText={setComment} />
        <Button title="Сохранить" onPress={save} />
      </Card>
      <Section title={`Товары в ячейке · ${data.items.length}`}>
        <View style={{ borderRadius: 12, overflow: 'hidden' }}>
          {data.items.length ? data.items.map((i) => (
            <ListRow key={i.item_id} title={i.name} subtitle={[`Арт. ${i.article}`, i.spp ? `SPP ${i.spp}` : null].filter(Boolean).join(' · ')}
              right={`${formatQty(i.qty)} ${i.unit}`} onPress={() => router.push({ pathname: '/item/[id]', params: { id: String(i.item_id) } })} />
          )) : <Empty text="Ячейка пуста" />}
        </View>
      </Section>
      <Button title="История по ячейке" icon="↻" variant="ghost" onPress={() => router.push({ pathname: '/history', params: { cellId: String(id) } })} />
      {cell.code !== MAIN_CELL_CODE ? <Button title="Удалить ячейку" variant="danger" onPress={remove} /> : null}
    </ScrollView>
  );
}
