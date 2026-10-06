import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { PlacePicker, QtyPrompt, StockPicker, type PickedPlace } from '../components/pickers';
import { Scanner } from '../components/Scanner';
import { Button, Card, Empty, ListRow, Muted, Section, colors, notify, s, showError } from '../components/ui';
import { formatQty } from '../core/codes';
import type { StockRow } from '../core/types';
import { useApi } from '../lib/backend';

type Step = 'source' | 'item' | 'target';

/**
 * Перемещение товара: сканируем ячейку/короб-источник (или ШК товара),
 * выбираем позицию и количество (весь товар или часть), затем место назначения.
 */
export default function MoveScreen() {
  const api = useApi();
  const [step, setStep] = useState<Step>('source');
  const [sourceLabel, setSourceLabel] = useState('');
  const [rows, setRows] = useState<StockRow[]>([]);
  const [row, setRow] = useState<StockRow | null>(null);
  const [qty, setQty] = useState(0);
  const [scan, setScan] = useState(false);
  const [askQty, setAskQty] = useState(false);
  const [pickSource, setPickSource] = useState(false);
  const [pickTarget, setPickTarget] = useState(false);
  const [pickRow, setPickRow] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const params = useLocalSearchParams<{ cellId?: string; boxId?: string; itemId?: string; lot?: string }>();

  // Открыто из карточки ячейки / короба: позиция уже выбрана.
  useEffect(() => {
    if (!params.itemId || (!params.cellId && !params.boxId)) return;
    (async () => {
      const list = params.boxId ? await api.stockInBox(Number(params.boxId)) : await api.stockLooseInCell(Number(params.cellId));
      const r = list.find((x) => x.item_id === Number(params.itemId) && (!params.lot || x.received_at === params.lot));
      if (r) {
        setSourceLabel(`${r.address ?? ''}${r.box_code ? ' · ' + r.box_code : ''}`);
        setRows(list);
        chooseRow(r);
      }
    })().catch(showError);
  }, [params.itemId, params.cellId, params.boxId, params.lot]); // eslint-disable-line react-hooks/exhaustive-deps

  function reset() {
    setStep('source');
    setRow(null);
    setRows([]);
    setSourceLabel('');
  }

  function chooseRow(r: StockRow) {
    setRow(r);
    setStep('item');
    setTimeout(() => setAskQty(true), 300);
  }

  async function onSource(code: string) {
    const r = await api.resolveScan(code);
    if (r.type === 'cell') {
      const list = await api.stockAllInCell(r.cell.id);
      setScan(false);
      setSourceLabel(r.cell.address);
      setRows(list);
      setStep('item');
      if (list.length === 1) chooseRow(list[0]);
      return true;
    }
    if (r.type === 'box') {
      const list = await api.stockInBox(r.box.id);
      setScan(false);
      setSourceLabel(`Короб ${r.box.code}`);
      setRows(list);
      setStep('item');
      if (list.length === 1) chooseRow(list[0]);
      return true;
    }
    if (r.type === 'item') {
      const list = await api.stockByItem(r.item.id);
      setScan(false);
      setSourceLabel(`${r.item.name} — все места`);
      setRows(list);
      setStep('item');
      if (list.length === 1) chooseRow(list[0]);
      return true;
    }
    return false;
  }

  async function onTarget(code: string) {
    const r = await api.resolveScan(code);
    if (r.type === 'cell') { setScan(false); await doMove({ cellId: r.cell.id }, r.cell.address); return true; }
    if (r.type === 'box') { setScan(false); await doMove({ boxId: r.box.id }, `короб ${r.box.code}`); return true; }
    return false;
  }

  async function doMove(to: { cellId?: number; boxId?: number }, label: string) {
    if (!row) return;
    try {
      await api.moveStock({
        itemId: row.item_id,
        from: row.box_id ? { boxId: row.box_id } : { cellId: row.cell_id! },
        to: to.boxId ? { boxId: to.boxId } : { cellId: to.cellId! },
        qty,
        receivedAt: row.received_at,
      });
      setLog([`${row.item_name}: ${formatQty(qty)} ${row.unit} → ${label}`, ...log].slice(0, 20));
      notify('Перемещено', `${row.item_name}: ${formatQty(qty)} ${row.unit} → ${label}`);
      reset();
    } catch (e) {
      showError(e);
    }
  }

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      <Card>
        <Text style={{ fontWeight: '700', color: colors.text }}>Шаг 1. Откуда</Text>
        <Muted>{sourceLabel || 'Отсканируйте ячейку, короб или ШК товара'}</Muted>
        <View style={s.rowWrap}>
          <Button title="Сканировать" icon="⌗" style={{ flex: 1 }} onPress={() => { reset(); setScan(true); }} />
          <Button title="Выбрать" variant="ghost" style={{ flex: 1 }} onPress={() => { reset(); setPickSource(true); }} />
        </View>
      </Card>

      {step !== 'source' ? (
        <Card>
          <Text style={{ fontWeight: '700', color: colors.text }}>Шаг 2. Что и сколько</Text>
          {row ? (
            <ListRow title={`${row.item_name}: ${formatQty(qty)} из ${formatQty(row.qty)} ${row.unit}`}
              subtitle={`${row.address ?? ''}${row.box_code ? ' · ' + row.box_code : ''} · приёмка ${row.received_at}`}
              right="изм." onPress={() => setAskQty(true)} />
          ) : rows.length ? (
            <Button title={`Выбрать позицию (${rows.length})`} variant="secondary" onPress={() => setPickRow(true)} />
          ) : <Empty text="Здесь пусто" />}
        </Card>
      ) : null}

      {row && qty > 0 ? (
        <Card style={{ backgroundColor: colors.successSoft }}>
          <Text style={{ fontWeight: '700', color: colors.text }}>Шаг 3. Куда</Text>
          <View style={s.rowWrap}>
            <Button title="Сканировать место" icon="⌗" style={{ flex: 1 }} onPress={() => { setStep('target'); setScan(true); }} />
            <Button title="Выбрать" variant="ghost" style={{ flex: 1 }} onPress={() => setPickTarget(true)} />
          </View>
        </Card>
      ) : null}

      {log.length ? (
        <Section title="Перемещено за сессию">
          {log.map((l, i) => <Muted key={i}>• {l}</Muted>)}
        </Section>
      ) : null}
      <Button title="Документы перемещения" variant="ghost" onPress={() => router.push({ pathname: '/documents', params: { filter: 'move' } })} />

      <Scanner visible={scan} onClose={() => setScan(false)} title={step === 'target' ? 'Куда' : 'Откуда'}
        hint={step === 'target' ? 'QR ячейки или короба назначения' : 'QR ячейки / короба или ШК товара'}
        onScan={step === 'target' ? onTarget : onSource} />
      <StockPicker visible={pickRow} title={sourceLabel} rows={rows} onClose={() => setPickRow(false)}
        onPick={(r) => { setPickRow(false); chooseRow(r); }} />
      <StockPicker visible={pickSource} title="Что перемещаем?" onClose={() => setPickSource(false)}
        onPick={(r) => { setPickSource(false); setSourceLabel(r.address ?? ''); setRows([r]); chooseRow(r); }} />
      <QtyPrompt visible={askQty} title={row ? `${row.item_name}: сколько переместить?` : ''} unit={row?.unit} max={row?.qty}
        initial={row?.qty} onClose={() => setAskQty(false)} onSubmit={(q) => { setQty(q); setAskQty(false); }} />
      <PlacePicker visible={pickTarget} title="Куда переместить" onClose={() => setPickTarget(false)}
        onPick={(p: PickedPlace) => {
          setPickTarget(false);
          doMove(p.kind === 'box' ? { boxId: p.boxId } : { cellId: p.cellId }, p.label);
        }} />
    </ScrollView>
  );
}
