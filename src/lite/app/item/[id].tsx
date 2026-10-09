import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Button, Card, Empty, Field, ListRow, Muted, Section, colors, confirm, notify, s, showError, useFocusLoad } from '../../../components/ui';
import { formatQty } from '../../../core/codes';
import { CellPicker, GroupPicker, QtyModal, groupPaths, type ItemDraft } from '../../components/pickers';
import { groups, items, moveStock, type CellRow, type StockPlace } from '../../core/service';
import { useDb } from '../../lib/db';

/** Карточка товара: артикул, наименование, SPP номер, штрихкод; остаток по ячейкам; перемещение. */
export default function ItemCard() {
  const db = useDb();
  const params = useLocalSearchParams<{ id: string; barcode?: string; group?: string }>();
  const isNew = params.id === 'new';
  const id = isNew ? 0 : Number(params.id);
  const [f, setF] = useState<ItemDraft>({ article: '', name: '', spp: '', barcode: params.barcode ?? '', unit: 'шт', comment: '' });
  const [busy, setBusy] = useState(false);
  const [moveFrom, setMoveFrom] = useState<StockPlace | null>(null);
  const [moveTo, setMoveTo] = useState<CellRow | null>(null);
  const [groupId, setGroupId] = useState<number | null>(Number(params.group) || null);
  const [groupPath, setGroupPath] = useState('');
  const [pickGroup, setPickGroup] = useState(false);

  const [data, reload] = useFocusLoad(async () => (isNew ? null : { item: await items.get(db, id), places: await items.places(db, id) }), [db, id]);

  useEffect(() => {
    const it = data?.item;
    if (it) {
      setF({ article: it.article, name: it.name, spp: it.spp ?? '', barcode: it.barcode ?? '', unit: it.unit, comment: it.comment ?? '' });
      setGroupId(it.group_id);
    }
  }, [data?.item]);

  useEffect(() => {
    if (!groupId) { setGroupPath(''); return; }
    groups.all(db).then((all) => setGroupPath(groupPaths(all).get(groupId) ?? '')).catch(() => undefined);
  }, [db, groupId]);

  const set = (k: keyof ItemDraft) => (v: string) => setF((c) => ({ ...c, [k]: v }));

  async function save() {
    setBusy(true);
    try {
      const newId = await items.save(db, { ...f, id: id || undefined, group_id: groupId });
      if (isNew) router.replace({ pathname: '/item/[id]', params: { id: String(newId) } });
      else {
        notify('Сохранено');
        reload();
      }
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  }

  function remove() {
    confirm('Удалить товар из номенклатуры?', `${f.name} (арт. ${f.article}). История движений сохранится.`, async () => {
      try {
        await items.remove(db, id);
        router.back();
      } catch (e) {
        showError(e);
      }
    }, 'Удалить');
  }

  async function doMove(qty: number) {
    const from = moveFrom!;
    const to = moveTo!;
    setMoveFrom(null);
    setMoveTo(null);
    try {
      await moveStock(db, { itemId: id, fromCellId: from.cell_id, toCellId: to.id, qty });
      notify('Перемещено', `${formatQty(qty)} ${f.unit}: ${from.code} → ${to.code}`);
      reload();
    } catch (e) {
      showError(e);
    }
  }

  if (!isNew && data && !data.item) return <Empty text="Товар не найден" />;
  const it = data?.item;

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: isNew ? 'Новый товар' : 'Товар' }} />
      {it ? (
        <Card style={{ backgroundColor: it.qty > 0 ? colors.successSoft : colors.card }}>
          <Muted>На складе</Muted>
          <Text style={{ fontSize: 28, fontWeight: '800', color: colors.text }}>{formatQty(it.qty)} {it.unit}</Text>
          {it.last_receipt ? <Muted>Последний приход: {it.last_receipt.slice(0, 16)}</Muted> : null}
        </Card>
      ) : null}
      {it ? (
        <Section title={`Где лежит · ячеек: ${data.places.length}`}>
          <View style={{ borderRadius: 12, overflow: 'hidden' }}>
            {data.places.length ? data.places.map((p) => (
              <ListRow key={p.cell_id} title={p.code} subtitle={p.name ?? undefined} right={`${formatQty(p.qty)} ${it.unit}`}
                onPress={() => setMoveFrom(p)} />
            )) : <Empty text="Нет на складе" />}
          </View>
          {data.places.length ? <Muted>Нажмите на ячейку, чтобы переместить товар в другую.</Muted> : null}
          <Button title="История движений товара" icon="↻" variant="secondary"
            onPress={() => router.push({ pathname: '/history', params: { itemId: String(id) } })} />
        </Section>
      ) : null}
      <Card>
        {isNew && params.barcode ? <Muted>Новый штрихкод {params.barcode} — заполните карточку товара.</Muted> : null}
        <Field label="Артикул *" value={f.article} onChangeText={set('article')} />
        <Field label="Наименование *" value={f.name} onChangeText={set('name')} multiline />
        <Field label="SPP номер" value={f.spp} onChangeText={set('spp')} autoCapitalize="characters" />
        <Field label="Штрихкод" value={f.barcode} onChangeText={set('barcode')} autoCapitalize="none" />
        <View style={s.rowWrap}>
          <View style={{ width: 110 }}><Field label="Ед. изм." value={f.unit} onChangeText={set('unit')} /></View>
          <View style={{ flex: 1 }}><Field label="Комментарий" value={f.comment} onChangeText={set('comment')} /></View>
        </View>
        <Text style={s.label}>Папка</Text>
        <Button title={groupPath ? `📁 ${groupPath}` : 'Без папки — выбрать'} variant="ghost" onPress={() => setPickGroup(true)} />
        <Button title={isNew ? 'Добавить в номенклатуру' : 'Сохранить'} busy={busy} onPress={save} />
      </Card>
      {it ? <Button title="Удалить из номенклатуры" variant="danger" onPress={remove} /> : null}
      <GroupPicker visible={pickGroup} onClose={() => setPickGroup(false)} onPick={(g) => { setPickGroup(false); setGroupId(g); }} />


      <CellPicker visible={!!moveFrom && !moveTo} title={`Переместить из ${moveFrom?.code ?? ''} — куда?`}
        onClose={() => setMoveFrom(null)} onPick={(c) => setMoveTo(c)} />
      <QtyModal visible={!!moveFrom && !!moveTo} title={`${moveFrom?.code} → ${moveTo?.code}`}
        subtitle={`Сколько переместить? В ячейке ${formatQty(moveFrom?.qty ?? 0)} ${f.unit}`} initial={formatQty(moveFrom?.qty ?? 1)}
        onClose={() => { setMoveFrom(null); setMoveTo(null); }} onSubmit={doMove} />
    </ScrollView>
  );
}
