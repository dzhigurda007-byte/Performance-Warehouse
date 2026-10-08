import { useEffect, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Empty, Field, ListRow, Muted, SearchBox, colors, s, showError } from '../../components/ui';
import { formatQty, parseQty } from '../../core/codes';
import { cells, items, type CellRow, type ItemRow } from '../core/service';
import { useDb } from '../lib/db';

function Sheet({ visible, title, onClose, children }: { visible: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
          <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16, paddingBottom: 8 }}>
            <Text style={{ flex: 1, fontSize: 18, fontWeight: '700', color: colors.text }}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={12}><Text style={{ color: colors.primary, fontSize: 16 }}>Закрыть</Text></Pressable>
          </View>
          {children}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

/** Выбор товара из номенклатуры с поиском по артикулу, наименованию, SPP и ШК. */
export function ItemPicker({ visible, onClose, onPick, onlyInStock, title = 'Выберите товар' }: {
  visible: boolean; onClose: () => void; onPick: (i: ItemRow) => void; onlyInStock?: boolean; title?: string;
}) {
  const db = useDb();
  const [q, setQ] = useState('');
  const [list, setList] = useState<ItemRow[]>([]);
  useEffect(() => {
    if (!visible) return;
    items.list(db, { search: q, filter: onlyInStock ? 'in' : 'all' }).then(setList).catch(showError);
  }, [db, q, visible, onlyInStock]);
  useEffect(() => { if (visible) setQ(''); }, [visible]);
  return (
    <Sheet visible={visible} title={title} onClose={onClose}>
      <View style={{ paddingHorizontal: 16 }}>
        <SearchBox value={q} onChangeText={setQ} placeholder="Артикул, наименование, SPP, ШК" autoFocus />
      </View>
      <FlatList data={list} keyExtractor={(i) => String(i.id)} keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<Empty text={onlyInStock ? 'Нет товаров на остатке' : 'Ничего не найдено'} />}
        renderItem={({ item: i }) => (
          <ListRow title={i.name} subtitle={[`Арт. ${i.article}`, i.spp ? `SPP ${i.spp}` : null].filter(Boolean).join(' · ')}
            right={`${formatQty(i.qty)} ${i.unit}`} onPress={() => onPick(i)} />
        )} />
    </Sheet>
  );
}

/** Выбор ячейки. */
export function CellPicker({ visible, onClose, onPick, title = 'Выберите ячейку' }: {
  visible: boolean; onClose: () => void; onPick: (c: CellRow) => void; title?: string;
}) {
  const db = useDb();
  const [q, setQ] = useState('');
  const [list, setList] = useState<CellRow[]>([]);
  useEffect(() => {
    if (visible) cells.list(db, q).then(setList).catch(showError);
  }, [db, q, visible]);
  return (
    <Sheet visible={visible} title={title} onClose={onClose}>
      <View style={{ paddingHorizontal: 16 }}>
        <SearchBox value={q} onChangeText={setQ} placeholder="Код ячейки" autoCapitalize="characters" />
      </View>
      <FlatList data={list} keyExtractor={(c) => String(c.id)} keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<Empty text="Ячеек не найдено" />}
        renderItem={({ item: c }) => (
          <ListRow title={c.code} subtitle={[c.name, c.positions ? `позиций: ${c.positions}` : 'пусто'].filter(Boolean).join(' · ')}
            onPress={() => onPick(c)} />
        )} />
    </Sheet>
  );
}

export interface ItemDraft { article: string; name: string; spp: string; barcode: string; unit: string; comment: string }

/** Быстрое создание товара (например, по неизвестному ШК при сканировании). */
export function NewItemModal({ visible, barcode, onClose, onCreated }: {
  visible: boolean; barcode?: string; onClose: () => void; onCreated: (id: number) => void;
}) {
  const db = useDb();
  const [f, setF] = useState<ItemDraft>({ article: '', name: '', spp: '', barcode: '', unit: 'шт', comment: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (visible) setF({ article: '', name: '', spp: '', barcode: barcode ?? '', unit: 'шт', comment: '' });
  }, [visible, barcode]);
  const set = (k: keyof ItemDraft) => (v: string) => setF((c) => ({ ...c, [k]: v }));
  async function save() {
    setBusy(true);
    try {
      onCreated(await items.save(db, f));
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet visible={visible} title="Новый товар" onClose={onClose}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>
            {barcode ? <Muted>Штрихкод {barcode} не найден — заполните карточку товара.</Muted> : null}
            <Field label="Артикул *" value={f.article} onChangeText={set('article')} autoFocus />
            <Field label="Наименование *" value={f.name} onChangeText={set('name')} />
            <Field label="SPP номер" value={f.spp} onChangeText={set('spp')} autoCapitalize="characters" />
            <Field label="Штрихкод" value={f.barcode} onChangeText={set('barcode')} autoCapitalize="none" />
            <Field label="Единица измерения" value={f.unit} onChangeText={set('unit')} />
            <Button title="Сохранить товар" busy={busy} onPress={save} />
      </ScrollView>
    </Sheet>
  );
}

/** Ввод количества (режим сканирования «с количеством», правка строки). */
export function QtyModal({ visible, title, subtitle, initial = '1', allowZero, onClose, onSubmit }: {
  visible: boolean; title: string; subtitle?: string; initial?: string; allowZero?: boolean; onClose: () => void; onSubmit: (qty: number) => void;
}) {
  const [v, setV] = useState(initial);
  useEffect(() => { if (visible) setV(initial); }, [visible, initial]);
  const ok = () => {
    const n = allowZero && v.trim() !== '' && Number(v.replace(',', '.').trim()) === 0 ? 0 : parseQty(v);
    if (n === null) return showError(new Error('Введите количество больше нуля'));
    onSubmit(n);
  };
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: '#0008', justifyContent: 'center', padding: 24 }}>
          <Pressable style={[s.card, { maxWidth: 420, width: '100%', alignSelf: 'center' }]}>
            <Text style={{ fontSize: 17, fontWeight: '700', color: colors.text }}>{title}</Text>
            {subtitle ? <Muted>{subtitle}</Muted> : null}
            <TextInput value={v} onChangeText={setV} keyboardType="decimal-pad" autoFocus selectTextOnFocus
              onSubmitEditing={ok} style={[s.input, { marginTop: 10, fontSize: 24, textAlign: 'center' }]} />
            <View style={[s.rowWrap, { marginTop: 8 }]}>
              <Button title="Отмена" variant="ghost" style={{ flex: 1 }} onPress={onClose} />
              <Button title="OK" style={{ flex: 1 }} onPress={ok} />
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}
