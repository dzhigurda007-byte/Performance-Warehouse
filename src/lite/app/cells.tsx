import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, View } from 'react-native';
import { Chips } from '../../components/Chips';
import { Badge, Button, Card, Empty, Field, ListRow, Muted, SearchBox, notify, s, showError, useFocusLoad } from '../../components/ui';
import { formatQty } from '../../core/codes';
import { labelsHtml, type LabelLayout } from '../../lib/labelsHtml';
import { saveHtml } from '../../lib/printHtml';
import { cells, type CellRow } from '../core/service';
import { useDb } from '../lib/db';
import { cellLabel } from '../lib/labels';

/** Ячейки: добавить одну или целый ряд, распечатать / отправить QR-этикетки. */
export default function CellsScreen() {
  const db = useDb();
  const [q, setQ] = useState('');
  const [list, reload] = useFocusLoad(() => cells.list(db, q), [db, q]);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [prefix, setPrefix] = useState('A-');
  const [from, setFrom] = useState('1');
  const [to, setTo] = useState('10');
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [layout, setLayout] = useState<LabelLayout>('sheet');
  const [busy, setBusy] = useState(false);

  async function addOne() {
    try {
      await cells.save(db, { code, name });
      setCode('');
      setName('');
      reload();
    } catch (e) {
      showError(e);
    }
  }

  async function addRange() {
    try {
      const n = await cells.createRange(db, prefix, Number(from), Number(to));
      notify('Ячейки созданы', `Новых: ${n}${n < Number(to) - Number(from) + 1 ? ' (остальные уже были)' : ''}`);
      reload();
    } catch (e) {
      showError(e);
    }
  }

  async function labels(rows: CellRow[]) {
    setBusy(true);
    try {
      await saveHtml(labelsHtml(rows.map(cellLabel), layout), `Этикетки ячеек (${rows.length})`);
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  }

  const toggle = (id: number) => setPicked((c) => { const x = new Set(c); if (x.has(id)) x.delete(id); else x.add(id); return x; });
  const rows = list ?? [];
  const sel = rows.filter((c) => picked.has(c.id));

  return (
    <View style={s.screen}>
      <FlatList
        contentContainerStyle={s.content}
        data={rows}
        keyExtractor={(c) => String(c.id)}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View>
            <Card>
              <View style={s.rowWrap}>
                <View style={{ flex: 1 }}><Field label="Код ячейки" value={code} onChangeText={setCode} autoCapitalize="characters" placeholder="A-01-01" /></View>
                <View style={{ flex: 1 }}><Field label="Описание" value={name} onChangeText={setName} placeholder="необяз." /></View>
              </View>
              <Button title="Добавить ячейку" icon="+" variant="secondary" disabled={!code.trim()} onPress={addOne} />
            </Card>
            <Card>
              <Muted>Ряд ячеек: префикс + номера (A-01 … A-10)</Muted>
              <View style={s.rowWrap}>
                <View style={{ flex: 1 }}><Field label="Префикс" value={prefix} onChangeText={setPrefix} autoCapitalize="characters" /></View>
                <View style={{ width: 70 }}><Field label="С" value={from} onChangeText={setFrom} keyboardType="number-pad" /></View>
                <View style={{ width: 70 }}><Field label="По" value={to} onChangeText={setTo} keyboardType="number-pad" /></View>
              </View>
              <Button title="Создать ряд" variant="ghost" onPress={addRange} />
            </Card>
            <SearchBox value={q} onChangeText={setQ} placeholder="Поиск ячейки" autoCapitalize="characters" />
            <Chips value={layout} onChange={setLayout} options={[
              { value: 'sheet' as LabelLayout, label: 'Этикетки: 15 на листе' },
              { value: 'single' as LabelLayout, label: 'Одна на листе' },
            ]} />
            <View style={s.rowWrap}>
              <Button title={picked.size ? 'Снять выбор' : 'Выбрать все'} variant="ghost" style={{ flex: 1 }}
                onPress={() => setPicked(picked.size ? new Set() : new Set(rows.map((c) => c.id)))} />
              <Button title={`QR-этикетки (${sel.length})`} icon="⇪" style={{ flex: 1 }} busy={busy} disabled={!sel.length}
                onPress={() => labels(sel)} />
            </View>
          </View>
        }
        ListEmptyComponent={list ? <Empty text="Ячеек нет" /> : null}
        renderItem={({ item: c }) => (
          <ListRow title={c.code} subtitle={[c.name, c.positions ? `позиций: ${c.positions}, ${formatQty(c.qty)} шт.` : 'пусто'].filter(Boolean).join(' · ')}
            left={<Badge text={picked.has(c.id) ? '✓' : ' '} tone={picked.has(c.id) ? 'primary' : 'muted'} />}
            right="›" onPress={() => router.push({ pathname: '/cell/[id]', params: { id: String(c.id) } })}
            onLongPress={() => toggle(c.id)} />
        )}
        ListFooterComponent={rows.length ? <Muted>Нажатие — открыть ячейку, долгое нажатие — выбрать для печати этикеток.</Muted> : null}
      />
    </View>
  );
}
