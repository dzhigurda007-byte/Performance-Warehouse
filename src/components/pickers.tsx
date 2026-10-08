import { useApi } from '../lib/backend';
import { useEffect, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formatQty, parseQty, parseScan } from '../core/codes';
import type { Box, CellAddress, Item, Rack, StockRow, Warehouse } from '../core/types';
import { Scanner } from './Scanner';
import { Badge, Button, Empty, Field, ListRow, SearchBox, colors, s, showError } from './ui';

function Sheet({ visible, title, onClose, children }: {
  visible: boolean; title: string; onClose: () => void; children: React.ReactNode;
}) {
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 }}>
          <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text, flex: 1 }}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={{ color: colors.primary, fontSize: 16 }}>Закрыть</Text>
          </Pressable>
        </View>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
          {children}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

// ------------------------------------------------------------------ количество

export function QtyPrompt({ visible, title, unit, max, initial, onClose, onSubmit }: {
  visible: boolean;
  title: string;
  unit?: string;
  max?: number;
  initial?: number;
  onClose: () => void;
  onSubmit: (qty: number) => void;
}) {
  const [text, setText] = useState('1');
  useEffect(() => {
    if (visible) setText(initial ? formatQty(initial) : '1');
  }, [visible, initial]);
  const qty = parseQty(text);
  const over = max !== undefined && qty !== null && qty > max;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior="padding"
        style={{ flex: 1, backgroundColor: '#0008', justifyContent: 'center', padding: 24 }}
      >
        <View style={[s.card, { padding: 20, maxWidth: 440, width: '100%', alignSelf: 'center' }]}>
          <Text style={{ fontSize: 17, fontWeight: '700', marginBottom: 12, color: colors.text }}>{title}</Text>
          {max !== undefined ? (
            <Text style={{ color: colors.muted, marginBottom: 8 }}>Доступно: {formatQty(max)} {unit}</Text>
          ) : null}
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <Button title="−" variant="secondary" style={{ width: 52 }}
              onPress={() => setText(formatQty(Math.max(1, (qty ?? 1) - 1)))} />
            <TextInput
              value={text}
              onChangeText={setText}
              keyboardType="decimal-pad"
              autoFocus
              selectTextOnFocus
              style={[s.input, { flex: 1, minWidth: 0, textAlign: 'center', fontSize: 22 }]}
            />
            <Button title="+" variant="secondary" style={{ width: 52 }}
              onPress={() => setText(formatQty((qty ?? 0) + 1))} />
          </View>
          {max !== undefined && max > 1 ? (
            <Button title={`Всё (${formatQty(max)})`} variant="ghost" onPress={() => setText(formatQty(max))} />
          ) : null}
          {over ? <Text style={{ color: colors.danger, marginTop: 6 }}>Больше, чем есть в месте хранения</Text> : null}
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
            <Button title="Отмена" variant="ghost" style={{ flex: 1 }} onPress={onClose} />
            <Button title="OK" style={{ flex: 1 }} disabled={!qty || over} onPress={() => qty && onSubmit(qty)} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ------------------------------------------------------------------ номенклатура

export function ItemPicker({ visible, onClose, onPick, allowCreate = true, newBarcode }: {
  visible: boolean;
  onClose: () => void;
  onPick: (item: Item) => void;
  allowCreate?: boolean;
  /** Открыть сразу форму создания с этим штрихкодом (отсканирован неизвестный товар). */
  newBarcode?: string;
}) {
  const api = useApi();
  const [q, setQ] = useState('');
  const [items, setItems] = useState<(Item & { total: number })[]>([]);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ sku: '', name: '', unit: 'шт', barcode: '' });

  useEffect(() => {
    if (!visible) return;
    api.listItems(q).then(setItems).catch(showError);
  }, [api, q, visible]);

  useEffect(() => {
    if (!visible) return;
    setQ('');
    setCreating(false);
    if (newBarcode) startCreate(newBarcode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, newBarcode]);

  async function startCreate(barcode = '') {
    setForm({ sku: await api.suggestSku(), name: barcode ? '' : q, unit: 'шт', barcode });
    setCreating(true);
  }

  // ШК пришёл со сканера — его проставляет система, товар заводится «на месте» (кладовщик и выше)
  const fromScan = !!newBarcode && form.barcode === newBarcode;

  async function create() {
    try {
      const id = fromScan ? await api.createItemFromScan(form) : await api.saveItem(form);
      const item = await api.getItem(id);
      if (item) onPick(item);
    } catch (e) {
      showError(e);
    }
  }

  return (
    <Sheet visible={visible} title={creating ? (fromScan ? 'Новый товар по штрихкоду' : 'Новый товар') : 'Выбор товара'} onClose={onClose}>
      {creating ? (
        <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
          {fromScan ? (
            <View style={[s.card, { backgroundColor: colors.warnSoft, marginBottom: 12 }]}>
              <Text style={{ color: colors.text, fontWeight: '600' }}>Штрихкода {form.barcode} нет в базе</Text>
              <Text style={{ color: colors.text }}>Заполните полное наименование и артикул — штрихкод проставлен автоматически, товар сразу попадёт в номенклатуру и в приёмку.</Text>
            </View>
          ) : null}
          <Field label={fromScan ? 'Наименование полное *' : 'Наименование *'} value={form.name} multiline={fromScan}
            placeholder={fromScan ? 'напр. Кухонный комбайн Bosch MUM5, 1000 Вт, белый' : undefined}
            onChangeText={(name) => setForm({ ...form, name })} autoFocus />
          <Field label="Артикул *" value={form.sku} autoCapitalize="characters"
            onChangeText={(sku) => setForm({ ...form, sku })} />
          <Field label="Единица измерения" value={form.unit} onChangeText={(unit) => setForm({ ...form, unit })} />
          <Field label={fromScan ? 'Штрихкод (проставлен системой)' : 'Штрихкод производителя (EAN)'} value={form.barcode} keyboardType="number-pad"
            editable={!fromScan} onChangeText={(barcode) => setForm({ ...form, barcode })} />
          <Button title="Создать и выбрать" onPress={create} />
          <Button title="Назад к списку" variant="ghost" onPress={() => setCreating(false)} />
        </ScrollView>
      ) : (
        <View style={{ flex: 1, paddingHorizontal: 16 }}>
          <SearchBox value={q} onChangeText={setQ} placeholder="Название, артикул, штрихкод" />
          {allowCreate ? <Button title="Новый товар" icon="+" variant="secondary" onPress={() => startCreate()} /> : null}
          <FlatList
            style={{ marginTop: 8 }}
            data={items}
            keyExtractor={(i) => String(i.id)}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={<Empty text="Ничего не найдено" />}
            renderItem={({ item }) => (
              <ListRow
                title={item.name}
                subtitle={`${item.sku}${item.barcode ? ' · ' + item.barcode : ''}`}
                right={`${formatQty(item.total)} ${item.unit}`}
                onPress={() => onPick(item)}
              />
            )}
          />
        </View>
      )}
    </Sheet>
  );
}

// ------------------------------------------------------------------ место хранения

export type PickedPlace =
  | { kind: 'cell'; cellId: number; label: string }
  | { kind: 'box'; boxId: number; cellId: number | null; label: string };

/**
 * Выбор места хранения: Склад → Стеллаж → Ячейка → (россыпью | короб | новый короб).
 * Можно отсканировать QR ячейки или короба.
 */
export function PlacePicker({ visible, title = 'Место хранения', allowBoxes = true, cellOnly = false, onClose, onPick }: {
  visible: boolean;
  title?: string;
  allowBoxes?: boolean;
  cellOnly?: boolean;
  onClose: () => void;
  onPick: (p: PickedPlace) => void;
}) {
  const api = useApi();
  const [whs, setWhs] = useState<Warehouse[]>([]);
  const [wh, setWh] = useState<Warehouse | null>(null);
  const [racks, setRacks] = useState<Rack[]>([]);
  const [rack, setRack] = useState<Rack | null>(null);
  const [cells, setCells] = useState<{ id: number; code: string; positions: number; boxes: number }[]>([]);
  const [cell, setCell] = useState<CellAddress | null>(null);
  const [boxes, setBoxes] = useState<(Box & { positions: number })[]>([]);
  const [scan, setScan] = useState(false);
  const [typed, setTyped] = useState('');

  useEffect(() => {
    if (!visible) return;
    setWh(null); setRack(null); setCell(null); setTyped('');
    api.listWarehouses().then((w) => {
      setWhs(w);
      if (w.length === 1) setWh(w[0]);
    }).catch(showError);
  }, [api, visible]);
  useEffect(() => { if (wh) api.listRacks(wh.id).then(setRacks).catch(showError); }, [api, wh]);
  useEffect(() => { if (rack) api.listCells(rack.id).then(setCells).catch(showError); }, [api, rack]);
  useEffect(() => { if (cell) api.listBoxesInCell(cell.id).then(setBoxes).catch(showError); }, [api, cell]);

  async function openCell(id: number) {
    const c = await api.getCell(id);
    if (!c) return;
    if (cellOnly || !allowBoxes) {
      onPick({ kind: 'cell', cellId: c.id, label: c.address });
      return;
    }
    setCell(c);
  }

  async function onScan(code: string) {
    const r = await api.resolveScan(code);
    if (r.type === 'cell') {
      setScan(false);
      await openCell(r.cell.id);
      return true;
    }
    if (r.type === 'box' && allowBoxes && !cellOnly) {
      setScan(false);
      const b = await api.getBox(r.box.id);
      onPick({ kind: 'box', boxId: r.box.id, cellId: r.box.cell_id, label: `${b?.address ?? '—'} · ${r.box.code}` });
      return true;
    }
    return false;
  }

  /** Код ячейки, набранный вручную («1-01», «A-1-01», «СК1/A/1-01»). */
  async function submitTyped() {
    const v = typed.trim();
    if (!v) return;
    try {
      const r = await api.resolveScan(v);
      if (r.type === 'cell') return openCell(r.cell.id);
      if (r.type === 'box' && allowBoxes && !cellOnly) {
        return onPick({ kind: 'box', boxId: r.box.id, cellId: r.box.cell_id, label: r.box.code });
      }
      showError(new Error(`Ячейка «${v}» не найдена. Наберите код как на этикетке, например A-1-01, или выберите из списка.`));
    } catch (e) {
      showError(e);
    }
  }

  async function newBox() {
    if (!cell) return;
    try {
      const b = await api.createBox(cell.id);
      onPick({ kind: 'box', boxId: b.id, cellId: cell.id, label: `${cell.address} · ${b.code} (новый)` });
    } catch (e) {
      showError(e);
    }
  }

  const crumbs = [wh?.code, rack?.code, cell?.code].filter(Boolean).join(' / ');
  const back = () => (cell ? setCell(null) : rack ? setRack(null) : whs.length > 1 ? setWh(null) : undefined);

  return (
    <Sheet visible={visible} title={title} onClose={onClose}>
      <View style={{ paddingHorizontal: 16 }}>
        <Button title={allowBoxes && !cellOnly ? 'Сканировать QR ячейки или короба' : 'Сканировать QR ячейки'}
          icon="⌗" variant="secondary" onPress={() => setScan(true)} />
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
          <TextInput value={typed} onChangeText={setTyped} placeholder="Код ячейки вручную, напр. A-1-01"
            placeholderTextColor={colors.muted} autoCapitalize="characters" autoCorrect={false} returnKeyType="search"
            onSubmitEditing={submitTyped} style={[s.input, { flex: 1, minWidth: 0 }]} />
          <Button title="Найти" style={{ marginVertical: 0 }} onPress={submitTyped} />
        </View>
        {crumbs ? (
          <Pressable onPress={back} style={{ paddingVertical: 10 }}>
            <Text style={{ color: colors.primary }}>‹ {crumbs}</Text>
          </Pressable>
        ) : null}
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        {!wh ? (
          whs.length ? whs.map((w) => (
            <ListRow key={w.id} title={`${w.code} — ${w.name}`} subtitle={w.address} onPress={() => setWh(w)} />
          )) : <Empty text="Нет складов. Создайте склад на вкладке «Склад»." />
        ) : !rack ? (
          racks.length ? racks.map((r) => (
            <ListRow key={r.id} title={`Стеллаж ${r.code}`} subtitle={r.name} onPress={() => setRack(r)} />
          )) : <Empty text="На складе нет стеллажей" />
        ) : !cell ? (
          cells.length ? cells.map((c) => (
            <ListRow key={c.id} title={`Ячейка ${c.code}`}
              subtitle={c.positions || c.boxes ? `позиций: ${c.positions}, коробов: ${c.boxes}` : 'пусто'}
              onPress={() => openCell(c.id)} />
          )) : <Empty text="В стеллаже нет ячеек" />
        ) : (
          <View>
            <ListRow title="В ячейку (без короба)" subtitle={cell.address}
              onPress={() => onPick({ kind: 'cell', cellId: cell.id, label: cell.address })} />
            {boxes.map((b) => (
              <ListRow key={b.id} title={`Короб ${b.code}`} subtitle={b.name ?? `позиций: ${b.positions}`}
                left={<Badge text="короб" tone="primary" />}
                onPress={() => onPick({ kind: 'box', boxId: b.id, cellId: cell.id, label: `${cell.address} · ${b.code}` })} />
            ))}
            <View style={{ padding: 16 }}>
              <Button title="Новый короб в этой ячейке" icon="+" variant="secondary" onPress={newBox} />
            </View>
          </View>
        )}
      </ScrollView>
      <Scanner visible={scan} onClose={() => setScan(false)} onScan={onScan} title="QR места хранения" />
    </Sheet>
  );
}

// ------------------------------------------------------------------ остатки (для расхода)

export function StockPicker({ visible, title = 'Выбор из остатков', rows, onClose, onPick }: {
  visible: boolean;
  title?: string;
  rows?: StockRow[];
  onClose: () => void;
  onPick: (row: StockRow) => void;
}) {
  const api = useApi();
  const [q, setQ] = useState('');
  const [data, setData] = useState<StockRow[]>([]);
  useEffect(() => {
    if (!visible) return;
    if (rows) {
      const t = q.trim().toLowerCase();
      setData(t ? rows.filter((r) => `${r.item_name} ${r.sku}`.toLowerCase().includes(t)) : rows);
    } else {
      api.stockSearch(q).then(setData).catch(showError);
    }
  }, [api, q, rows, visible]);
  useEffect(() => { if (visible) setQ(''); }, [visible]);

  return (
    <Sheet visible={visible} title={title} onClose={onClose}>
      <View style={{ flex: 1, paddingHorizontal: 16 }}>
        <SearchBox value={q} onChangeText={setQ} placeholder="Товар, артикул, короб" />
        <FlatList
          data={data}
          keyExtractor={(r) => String(r.id)}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={<Empty text="Нет остатков" />}
          renderItem={({ item: r }) => (
            <ListRow
              title={r.item_name}
              subtitle={`${r.sku} · ${r.address ?? '—'}${r.box_code ? ' · ' + r.box_code : ''} · приёмка ${r.received_at}`}
              left={r.is_buffer ? <Badge text="буфер" tone="warn" /> : undefined}
              right={`${formatQty(r.qty)} ${r.unit}`}
              onPress={() => onPick(r)}
            />
          )}
        />
      </View>
    </Sheet>
  );
}

// ------------------------------------------------------------------ текст

export function TextPrompt({ visible, title, initial, placeholder, onClose, onSubmit }: {
  visible: boolean;
  title: string;
  initial?: string;
  placeholder?: string;
  onClose: () => void;
  onSubmit: (text: string) => void;
}) {
  const [text, setText] = useState('');
  useEffect(() => {
    if (visible) setText(initial ?? '');
  }, [visible, initial]);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior="padding"
        style={{ flex: 1, backgroundColor: '#0008', justifyContent: 'center', padding: 24 }}>
        <View style={[s.card, { padding: 20, maxWidth: 440, width: '100%', alignSelf: 'center' }]}>
          <Text style={{ fontSize: 17, fontWeight: '700', marginBottom: 12, color: colors.text }}>{title}</Text>
          <TextInput value={text} onChangeText={setText} autoFocus multiline placeholder={placeholder}
            placeholderTextColor={colors.muted} style={[s.input, { minHeight: 80, textAlignVertical: 'top' }]} />
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
            <Button title="Отмена" variant="ghost" style={{ flex: 1 }} onPress={onClose} />
            <Button title="OK" style={{ flex: 1 }} onPress={() => onSubmit(text)} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
