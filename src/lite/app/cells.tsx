import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Button, Card, Empty, Field, ListRow, Muted, SearchBox, Section, colors, notify, s, showError, useFocusLoad } from '../../components/ui';
import { formatQty } from '../../core/codes';
import { cells, racks, rackCellCode } from '../core/service';
import { useDb } from '../lib/db';

/**
 * Стеллажи и ячейки. Ряд (A) → полки (1 — нижняя, 2 — выше …) → ячейки на полке.
 * Ряд A из 5 полок по 40 ячеек = ячейки A-1-1 … A-5-40, у каждой своя QR-этикетка.
 */
export default function CellsScreen() {
  const db = useDb();
  const [q, setQ] = useState('');
  const [code, setCode] = useState('');
  const [shelves, setShelves] = useState('5');
  const [perShelf, setPerShelf] = useState('40');
  const [cellCode, setCellCode] = useState('');
  const [cellName, setCellName] = useState('');
  const [busy, setBusy] = useState(false);
  const [data, reload] = useFocusLoad(async () => ({
    racks: await racks.list(db),
    loose: await cells.list(db, '', { loose: true }),
    found: q.trim() ? await cells.list(db, q) : [],
  }), [db, q]);

  const sh = Number(shelves);
  const cp = Number(perShelf);
  const rc = code.trim().toUpperCase();
  const valid = !!rc && Number.isInteger(sh) && sh > 0 && Number.isInteger(cp) && cp > 0;

  async function addRack() {
    setBusy(true);
    try {
      const r = await racks.save(db, { code, shelves: sh, cellsPerShelf: cp });
      notify(`Ряд ${rc} создан`, `Ячеек: ${r.added} (${rackCellCode(rc, 1, 1)} … ${rackCellCode(rc, sh, cp)})`);
      setCode('');
      router.push({ pathname: '/rack/[id]', params: { id: String(r.id) } });
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  }

  async function addCell() {
    try {
      await cells.save(db, { code: cellCode, name: cellName });
      setCellCode('');
      setCellName('');
      reload();
    } catch (e) {
      showError(e);
    }
  }

  const openCell = (id: number) => router.push({ pathname: '/cell/[id]', params: { id: String(id) } });

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <SearchBox value={q} onChangeText={setQ} placeholder="Найти ячейку: A-1-5" autoCapitalize="characters" />
      {q.trim() ? (
        <View style={{ borderRadius: 12, overflow: 'hidden', marginBottom: 8 }}>
          {data?.found.length ? data.found.slice(0, 100).map((c) => (
            <ListRow key={c.id} title={c.code} subtitle={c.positions ? `позиций: ${c.positions}, ${formatQty(c.qty)} шт.` : 'пусто'}
              right="›" onPress={() => openCell(c.id)} />
          )) : <Empty text="Ячейка не найдена" />}
        </View>
      ) : null}

      <Section title={`Ряды стеллажей · ${data?.racks.length ?? 0}`}>
        <View style={{ borderRadius: 12, overflow: 'hidden' }}>
          {data?.racks.length ? data.racks.map((r) => (
            <ListRow key={r.id} title={`Ряд ${r.code}${r.name ? ` — ${r.name}` : ''}`}
              subtitle={`${r.shelves} полок × ${r.cells_per_shelf} ячеек = ${r.cells} · занято ${r.busy}${r.qty ? ` · ${formatQty(r.qty)} шт.` : ''}`}
              right="›" onPress={() => router.push({ pathname: '/rack/[id]', params: { id: String(r.id) } })} />
          )) : <Empty text="Рядов пока нет — создайте первый" />}
        </View>
        <Card style={{ marginTop: 10 }}>
          <Text style={{ fontWeight: '700', color: colors.text, marginBottom: 6 }}>Новый ряд стеллажей</Text>
          <View style={s.rowWrap}>
            <View style={{ width: 80 }}><Field label="Ряд" value={code} onChangeText={setCode} autoCapitalize="characters" placeholder="A" maxLength={6} /></View>
            <View style={{ flex: 1 }}><Field label="Полок (снизу вверх)" value={shelves} onChangeText={setShelves} keyboardType="number-pad" maxLength={2} /></View>
            <View style={{ flex: 1 }}><Field label="Ячеек на полке" value={perShelf} onChangeText={setPerShelf} keyboardType="number-pad" maxLength={3} /></View>
          </View>
          {valid ? (
            <Muted>Будет создано {sh * cp} ячеек: {rackCellCode(rc, 1, 1)}, {rackCellCode(rc, 1, 2)} … {rackCellCode(rc, sh, cp)}.
              {'\n'}Полка 1 — нижняя. Код ячейки: ряд-полка-ячейка.</Muted>
          ) : <Muted>Например: ряд A, 5 полок, 40 ячеек → A-1-1 … A-5-40</Muted>}
          <Button title="Создать ряд" icon="+" busy={busy} disabled={!valid} onPress={addRack} />
        </Card>
      </Section>

      <Section title={`Отдельные ячейки · ${data?.loose.length ?? 0}`}>
        <View style={{ borderRadius: 12, overflow: 'hidden' }}>
          {data?.loose.map((c) => (
            <ListRow key={c.id} title={c.code} subtitle={[c.name, c.positions ? `позиций: ${c.positions}, ${formatQty(c.qty)} шт.` : 'пусто'].filter(Boolean).join(' · ')}
              right="›" onPress={() => openCell(c.id)} />
          ))}
        </View>
        <Card style={{ marginTop: 10 }}>
          <Muted>Ячейка вне стеллажа (пол, зона приёмки, паллетное место)</Muted>
          <View style={s.rowWrap}>
            <View style={{ flex: 1 }}><Field label="Код" value={cellCode} onChangeText={setCellCode} autoCapitalize="characters" placeholder="ПОЛ-1" /></View>
            <View style={{ flex: 1 }}><Field label="Описание" value={cellName} onChangeText={setCellName} placeholder="необяз." /></View>
          </View>
          <Button title="Добавить ячейку" variant="secondary" disabled={!cellCode.trim()} onPress={addCell} />
        </Card>
      </Section>
    </ScrollView>
  );
}
