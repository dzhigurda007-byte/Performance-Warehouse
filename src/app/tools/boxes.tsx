import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Chips } from '../../components/Chips';
import { PlacePicker, type PickedPlace } from '../../components/pickers';
import { PrintMenu, type PrintJob } from '../../components/PrintMenu';
import { Badge, Button, Card, Empty, Field, ListRow, Muted, SearchBox, Section, colors, notify, s, showError, useFocusLoad } from '../../components/ui';
import { boxQr } from '../../core/codes';
import type { Box } from '../../core/types';
import type { Label } from '../../lib/labelsHtml';
import { useApi } from '../../lib/backend';

type Filter = 'unplaced' | 'all';
type BoxRow = Box & { address: string | null; positions: number };

const boxLabel = (b: { code: string; name?: string | null; address?: string | null }): Label =>
  ({ qr: boxQr(b.code), title: b.code, subtitle: [b.name, b.address].filter(Boolean).join(' · ') || 'Короб' });

/**
 * Генератор коробов: создать заданное количество коробов со сквозной нумерацией (BX-000001…),
 * у каждого свой QR-код; распечатать этикетки и наклеить на физические короба.
 * Короб можно сразу поставить в ячейку или оставить свободным и разместить позже перемещением.
 */
export default function BoxGenerator() {
  const api = useApi();
  const [count, setCount] = useState('10');
  const [name, setName] = useState('');
  const [place, setPlace] = useState<PickedPlace | null>(null);
  const [pickPlace, setPickPlace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ id: number; code: string }[]>([]);
  const [printJob, setPrintJob] = useState<PrintJob | null>(null);
  const [filter, setFilter] = useState<Filter>('unplaced');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [boxes, reload] = useFocusLoad(() => api.listBoxes({ unplaced: filter === 'unplaced', search: q }), [api, filter, q]);

  const n = Number(count.replace(/\s/g, ''));
  const valid = Number.isInteger(n) && n >= 1 && n <= 1000;

  async function generate() {
    if (!valid) return notify('Количество', 'Укажите целое число от 1 до 1000');
    setBusy(true);
    try {
      const list = await api.createBoxes({ count: n, name: name.trim() || null, cellId: place?.kind === 'cell' ? place.cellId : null });
      setCreated(list);
      reload();
      const labels = list.map((b) => boxLabel({ code: b.code, name: name.trim(), address: place?.label }));
      setPrintJob({
        title: `Создано коробов: ${list.length}`,
        subtitle: `${list[0].code} … ${list[list.length - 1].code} — распечатайте этикетки`,
        variants: [{ label: 'Этикетки коробов', labels: () => labels }],
      });
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  }

  const toggle = (id: number) => setPicked((c) => { const x = new Set(c); if (x.has(id)) x.delete(id); else x.add(id); return x; });
  const pickedRows = (boxes ?? []).filter((b) => picked.has(b.id));

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <Card>
        <Text style={{ fontSize: 17, fontWeight: '700', color: colors.text }}>Создать короба</Text>
        <Muted>Каждый короб получает номер (BX-000001, BX-000002…) и QR-код. Распечатайте этикетки и наклейте на короба —
          дальше короб сканируется при приёмке, перемещении и отборе.</Muted>
        <View style={[s.rowWrap, { marginTop: 8 }]}>
          <View style={{ width: 130 }}>
            <Field label="Количество" value={count} keyboardType="number-pad" maxLength={4} onChangeText={setCount} />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Подпись на этикетке (необяз.)" value={name} placeholder="напр. Поставка 07.10" onChangeText={setName} />
          </View>
        </View>
        <Chips value={count} onChange={setCount} options={['1', '5', '10', '20', '50', '100'].map((v) => ({ value: v, label: v }))} />
        <Text style={s.label}>Где будут стоять</Text>
        <View style={s.rowWrap}>
          <Button title={place ? place.label : 'Свободные (без ячейки)'} variant={place ? 'secondary' : 'ghost'} style={{ flex: 1 }}
            onPress={() => setPickPlace(true)} />
          {place ? <Button title="Без ячейки" variant="ghost" onPress={() => setPlace(null)} /> : null}
        </View>
        <Button title={valid ? `Создать ${n} ${n % 10 === 1 && n % 100 !== 11 ? 'короб' : 'коробов'} и распечатать` : 'Создать короба'}
          icon="▣" busy={busy} disabled={!valid} onPress={generate} />
      </Card>

      {created.length ? (
        <Card style={{ backgroundColor: colors.successSoft }}>
          <Text style={{ fontWeight: '700', color: colors.text }}>Создано: {created.length}</Text>
          <Muted>{created[0].code} … {created[created.length - 1].code}</Muted>
          <Button title="Печать этикеток ещё раз" icon="⎙" variant="secondary"
            onPress={() => setPrintJob({ title: `Этикетки: ${created.length} коробов`,
              variants: [{ label: 'Этикетки коробов', labels: () => created.map((b) => boxLabel({ code: b.code, name: name.trim(), address: place?.label })) }] })} />
        </Card>
      ) : null}

      <Section title="Короба — повторная печать">
        <Chips value={filter} onChange={(v) => { setFilter(v); setPicked(new Set()); }} options={[
          { value: 'unplaced' as Filter, label: 'Свободные' }, { value: 'all' as Filter, label: 'Все' },
        ]} />
        <SearchBox value={q} onChangeText={setQ} placeholder="Номер короба или подпись" />
        <View style={s.rowWrap}>
          <Button title={picked.size && picked.size === (boxes?.length ?? 0) ? 'Снять все' : 'Выбрать все'} variant="ghost" style={{ flex: 1 }}
            disabled={!boxes?.length}
            onPress={() => setPicked(picked.size === (boxes?.length ?? 0) ? new Set() : new Set((boxes ?? []).map((b) => b.id)))} />
          <Button title={`Печать (${picked.size})`} icon="⎙" style={{ flex: 1 }} disabled={!picked.size}
            onPress={() => setPrintJob({ title: `Этикетки: ${pickedRows.length} коробов`,
              variants: [{ label: 'Этикетки коробов', labels: () => pickedRows.map(boxLabel) }] })} />
        </View>
        <View style={{ borderRadius: 12, overflow: 'hidden' }}>
          {boxes?.length ? boxes.slice(0, 300).map((b: BoxRow) => (
            <ListRow key={b.id} title={b.code}
              subtitle={[b.name, b.address ?? 'не размещён', b.positions ? `позиций: ${b.positions}` : 'пустой'].filter(Boolean).join(' · ')}
              left={<Badge text={picked.has(b.id) ? '✓' : ' '} tone={picked.has(b.id) ? 'primary' : 'muted'} />}
              onPress={() => toggle(b.id)}
              onLongPress={() => router.push({ pathname: '/box/[id]', params: { id: String(b.id) } })} />
          )) : <Empty text={filter === 'unplaced' ? 'Свободных коробов нет' : 'Коробов нет'} />}
        </View>
        {boxes && boxes.length > 300 ? <Muted>Показаны первые 300 — уточните поиск</Muted> : null}
        <Muted>Нажатие — выбрать для печати, долгое нажатие — открыть короб.</Muted>
      </Section>

      <PlacePicker visible={pickPlace} cellOnly title="В какую ячейку поставить короба" onClose={() => setPickPlace(false)}
        onPick={(p) => { setPickPlace(false); setPlace(p); }} />
      <PrintMenu job={printJob} onClose={() => setPrintJob(null)} />
    </ScrollView>
  );
}
