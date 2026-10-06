import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { ActionMenu, type MenuAction } from '../components/ActionMenu';
import { PlacePicker, QtyPrompt, StockPicker, type PickedPlace } from '../components/pickers';
import { Scanner, type ScanFeedback } from '../components/Scanner';
import { Badge, Button, Card, Empty, Muted, Section, colors, confirm, notify, s, showError } from '../components/ui';
import { formatQty } from '../core/codes';
import { round3 } from '../core/db';
import type { StockRow } from '../core/types';
import { useApi } from '../lib/backend';

/** Позиция в перемещении: конкретная партия в конкретном месте и сколько из неё берём. */
type CartLine = { key: string; row: StockRow; qty: number };

const lineKey = (r: StockRow) => `${r.item_id}|${r.cell_id ?? 0}|${r.box_id ?? 0}|${r.received_at}`;
const placeText = (r: StockRow) => `${r.address ?? '—'}${r.box_code ? ' · ' + r.box_code : ''}`;

/**
 * Перемещение нескольких товаров одним документом:
 *  1) откуда — ячейка / короб / стеллаж (скан, вручную) или сразу ШК товара;
 *  2) набрать позиции — сканировать ШК / QR товаров (быстрый режим: 1 скан = 1 шт) или выбрать;
 *     источник можно менять, позиции из разных мест копятся в одном списке;
 *  3) куда — скан или выбор места → одно перемещение со всеми позициями.
 */
export default function MoveScreen() {
  const api = useApi();
  const [sourceLabel, setSourceLabel] = useState('');
  const [rows, setRows] = useState<StockRow[]>([]);
  // как перечитать содержимое источника после перемещения
  const [reloadSource, setReloadSource] = useState<(() => Promise<StockRow[]>) | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [quick, setQuick] = useState(false);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  // окна
  const [scanMode, setScanMode] = useState<'items' | 'target' | null>(null);
  const [pickSourceCell, setPickSourceCell] = useState(false);
  const [pickStock, setPickStock] = useState<{ title: string; rows?: StockRow[] } | null>(null);
  const [pickTarget, setPickTarget] = useState(false);
  const [qtyReq, setQtyReq] = useState<{ row: StockRow; initial?: number; replace?: boolean } | null>(null);
  const [menu, setMenu] = useState<{ title: string; subtitle?: string; actions: MenuAction[] } | null>(null);

  const params = useLocalSearchParams<{ cellId?: string; boxId?: string; itemId?: string; lot?: string }>();

  // Открыто из карточки ячейки / короба: позиция уже выбрана.
  useEffect(() => {
    if (!params.cellId && !params.boxId) return;
    (async () => {
      const loader = params.boxId ? () => api.stockInBox(Number(params.boxId)) : () => api.stockAllInCell(Number(params.cellId));
      const list = await loader();
      setSource(list[0] ? placeText(list[0]) : 'Источник', list, loader);
      const r = params.itemId ? list.find((x) => x.item_id === Number(params.itemId) && (!params.lot || x.received_at === params.lot)) : undefined;
      if (r) askQty(r);
    })().catch(showError);
  }, [params.itemId, params.cellId, params.boxId, params.lot]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Сколько из этой партии ещё можно взять (с учётом уже набранного). */
  const inCart = (r: StockRow) => cart.find((c) => c.key === lineKey(r))?.qty ?? 0;
  const freeOf = (r: StockRow) => round3(r.qty - inCart(r));

  function addToCart(r: StockRow, qty: number, replace = false) {
    setCart((c) => {
      const k = lineKey(r);
      const ex = c.find((x) => x.key === k);
      if (!ex) return qty > 0 ? [...c, { key: k, row: r, qty }] : c;
      const next = replace ? qty : round3(ex.qty + qty);
      return next > 0 ? c.map((x) => (x.key === k ? { ...x, qty: next } : x)) : c.filter((x) => x.key !== k);
    });
  }

  const askQty = (row: StockRow, initial?: number, replace = false) => setTimeout(() => setQtyReq({ row, initial, replace }), 250);

  /** Взять позицию: быстрый режим — +1 шт, иначе спросить количество. */
  function take(r: StockRow): ScanFeedback {
    const free = freeOf(r);
    if (free <= 0) return { ok: false, tone: 'yellow', text: `${r.item_name}\nуже набрано всё: ${formatQty(r.qty)} ${r.unit} (${placeText(r)})` };
    if (quick) {
      addToCart(r, Math.min(1, free));
      return { ok: true, tone: 'green', text: `${r.item_name}\n+1 · набрано ${formatQty(inCart(r) + 1)} из ${formatQty(r.qty)} ${r.unit} · ${placeText(r)}` };
    }
    setScanMode(null);
    askQty(r, free);
    return { ok: true, text: r.item_name };
  }

  function setSource(label: string, list: StockRow[], loader: (() => Promise<StockRow[]>) | null) {
    setSourceLabel(label);
    setRows(list);
    setReloadSource(() => loader);
  }

  /** Скан в режиме набора: QR места — сменить источник; ШК / QR товара — взять товар. */
  async function onItemsScan(code: string): Promise<boolean | ScanFeedback> {
    const r = await api.resolveScan(code);
    if (r.type === 'cell' || r.type === 'box' || r.type === 'rack') {
      const loader = r.type === 'cell' ? () => api.stockAllInCell(r.cell.id)
        : r.type === 'box' ? () => api.stockInBox(r.box.id) : () => api.stockInRack(r.rack.id);
      const list = await loader();
      const label = r.type === 'cell' ? r.cell.address : r.type === 'box' ? `Короб ${r.box.code}` : `Стеллаж ${r.rack.code}`;
      setSource(label, list, loader);
      return list.length
        ? { ok: true, tone: 'green', text: `Откуда: ${label}\nпозиций: ${list.length} — сканируйте товары` }
        : { ok: false, tone: 'red', text: `${label}: пусто` };
    }
    if (r.type !== 'item') return { ok: false, tone: 'red', text: `Код ${code} не распознан` };
    // товар ищем в выбранном месте; если место не выбрано — по всему складу (FIFO)
    let found = rows.filter((x) => x.item_id === r.item.id);
    if (!sourceLabel) found = await api.stockByItem(r.item.id);
    if (!found.length) {
      return { ok: false, tone: 'red', text: `«${r.item.name}»: нет ${sourceLabel ? `в «${sourceLabel}»` : 'на складе'}` };
    }
    const withFree = found.filter((x) => freeOf(x) > 0);
    if (withFree.length === 1 || (quick && withFree.length)) return take(withFree[0]); // быстрый режим — самая старая партия
    if (!withFree.length) return take(found[0]);
    setScanMode(null);
    setTimeout(() => setPickStock({ title: `«${r.item.name}»: откуда взять?`, rows: withFree }), 300);
    return true;
  }

  async function onTargetScan(code: string): Promise<boolean | ScanFeedback> {
    const r = await api.resolveScan(code);
    if (r.type === 'cell') { setScanMode(null); await doMove({ cellId: r.cell.id }, r.cell.address); return true; }
    if (r.type === 'box') { setScanMode(null); await doMove({ boxId: r.box.id }, `короб ${r.box.code}`); return true; }
    return { ok: false, tone: 'red', text: 'Отсканируйте QR ячейки или короба, куда перемещаете' };
  }

  async function doMove(to: { cellId?: number; boxId?: number }, label: string) {
    if (!cart.length) return;
    setBusy(true);
    try {
      await api.moveMany({
        to: to.boxId ? { boxId: to.boxId } : { cellId: to.cellId! },
        lines: cart.map((c) => ({
          itemId: c.row.item_id,
          from: c.row.box_id ? { boxId: c.row.box_id } : { cellId: c.row.cell_id! },
          qty: c.qty,
          receivedAt: c.row.received_at,
        })),
      });
      const total = cart.reduce((a, c) => a + c.qty, 0);
      const text = `${cart.length} поз. (${formatQty(total)} ед.) → ${label}`;
      setLog([text, ...log].slice(0, 20));
      notify('Перемещено', `${text}\nОдин документ перемещения.`);
      setCart([]);
      // обновить содержимое источника
      if (reloadSource) setRows(await reloadSource());
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  }

  function lineActions(c: CartLine) {
    setMenu({
      title: c.row.item_name,
      subtitle: `${formatQty(c.qty)} из ${formatQty(c.row.qty)} ${c.row.unit} · ${placeText(c.row)}`,
      actions: [
        { label: 'Изменить количество', onPress: () => askQty(c.row, c.qty, true) },
        { label: 'Убрать из перемещения', danger: true, onPress: () => setCart((x) => x.filter((y) => y.key !== c.key)) },
      ],
    });
  }

  const total = useMemo(() => cart.reduce((a, c) => a + c.qty, 0), [cart]);

  return (
    <View style={{ flex: 1 }}>
      <ScrollView style={s.screen} contentContainerStyle={[s.content, { paddingBottom: cart.length ? 120 : 48 }]}>
        <Card>
          <Text style={{ fontWeight: '700', color: colors.text }}>1. Откуда</Text>
          <Muted>{sourceLabel ? `${sourceLabel} · позиций: ${rows.length}` : 'Не выбрано — сканируйте ячейку / короб или сразу ШК товара (возьмём из самой старой партии)'}</Muted>
          <View style={s.rowWrap}>
            <Button title="Ячейка вручную" icon="▦" variant="secondary" style={{ flex: 1 }} onPress={() => setPickSourceCell(true)} />
            <Button title="Из остатков" variant="ghost" style={{ flex: 1 }} onPress={() => setPickStock({ title: 'Что перемещаем?' })} />
          </View>
          {sourceLabel ? <Button title="Сбросить источник" variant="ghost" onPress={() => setSource('', [], null)} /> : null}
        </Card>

        <Card>
          <Text style={{ fontWeight: '700', color: colors.text }}>2. Что перемещаем — можно несколько товаров</Text>
          <Button title="Сканировать товары" icon="⌗" onPress={() => setScanMode('items')} />
          {rows.length ? (
            <Button title={`Выбрать из «${sourceLabel}» (${rows.length})`} variant="secondary"
              onPress={() => setPickStock({ title: sourceLabel, rows })} />
          ) : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
            <Text style={{ color: colors.text, flex: 1 }}>Быстрый режим: 1 скан = 1 шт</Text>
            <Switch value={quick} onValueChange={setQuick} />
          </View>
          <Muted>В режиме сканирования QR ячейки или короба меняет «откуда» — позиции из разных мест копятся в одном перемещении.</Muted>
        </Card>

        <Section title={`К перемещению · ${cart.length} поз. · ${formatQty(total)} ед.`}
          action={cart.length ? (
            <Pressable onPress={() => confirm('Очистить список?', '', () => setCart([]), 'Очистить')} hitSlop={8}>
              <Text style={{ color: colors.danger }}>Очистить</Text>
            </Pressable>
          ) : undefined}>
          <View style={{ borderRadius: 12, overflow: 'hidden' }}>
            {cart.length ? cart.map((c, i) => (
              <Pressable key={c.key} onPress={() => lineActions(c)}
                style={({ pressed }) => [s.row, pressed && { opacity: 0.8 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={s.rowTitle}>{i + 1}. {c.row.item_name}</Text>
                  <Text style={s.rowSub}>{c.row.sku} · ← {placeText(c.row)} · приёмка {c.row.received_at}</Text>
                </View>
                {c.qty === c.row.qty ? <Badge text="всё" tone="primary" /> : null}
                <Text style={[s.rowRight, { marginLeft: 8 }]}>{formatQty(c.qty)} {c.row.unit}</Text>
              </Pressable>
            )) : <Empty text="Пусто — отсканируйте товары или выберите из списка" />}
          </View>
        </Section>

        {log.length ? (
          <Section title="Перемещено за сессию">
            {log.map((l, i) => <Muted key={i}>• {l}</Muted>)}
          </Section>
        ) : null}
        <Button title="Документы перемещения" variant="ghost" onPress={() => router.push({ pathname: '/documents', params: { filter: 'move' } })} />
      </ScrollView>

      {cart.length ? (
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 12, paddingBottom: 28,
          backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border }}>
          <Text style={{ fontWeight: '700', color: colors.text, marginBottom: 4 }}>3. Куда переместить {cart.length} поз.</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button title="Сканировать место" icon="⌗" variant="success" style={{ flex: 1 }} busy={busy} onPress={() => setScanMode('target')} />
            <Button title="Выбрать" variant="ghost" style={{ flex: 1 }} disabled={busy} onPress={() => setPickTarget(true)} />
          </View>
        </View>
      ) : null}

      <Scanner visible={scanMode !== null} onClose={() => setScanMode(null)}
        title={scanMode === 'target' ? 'Куда' : `Набор: ${cart.length} поз.`}
        hint={scanMode === 'target' ? 'QR ячейки или короба назначения'
          : `${sourceLabel ? `Откуда: ${sourceLabel}. ` : ''}ШК / QR товара — ${quick ? '+1 шт' : 'с количеством'}; QR ячейки / короба — сменить «откуда»`}
        onScan={scanMode === 'target' ? onTargetScan : onItemsScan} />
      <StockPicker visible={pickStock !== null} title={pickStock?.title} rows={pickStock?.rows} onClose={() => setPickStock(null)}
        onPick={(r) => {
          setPickStock(null);
          if (freeOf(r) <= 0) return notify('Уже в списке', `${r.item_name}: набрано всё (${formatQty(r.qty)} ${r.unit})`);
          askQty(r, freeOf(r));
        }} />
      <QtyPrompt visible={qtyReq !== null}
        title={qtyReq ? `${qtyReq.row.item_name}\n← ${placeText(qtyReq.row)}\nсколько переместить?` : ''}
        unit={qtyReq?.row.unit}
        max={qtyReq ? (qtyReq.replace ? qtyReq.row.qty : freeOf(qtyReq.row)) : undefined}
        initial={qtyReq?.initial}
        onClose={() => setQtyReq(null)}
        onSubmit={(q) => {
          const req = qtyReq;
          setQtyReq(null);
          if (req) addToCart(req.row, q, req.replace);
        }} />
      <PlacePicker visible={pickSourceCell} cellOnly title="Откуда: выберите ячейку" onClose={() => setPickSourceCell(false)}
        onPick={async (p: PickedPlace) => {
          setPickSourceCell(false);
          try {
            const loader = p.kind === 'box' ? () => api.stockInBox(p.boxId) : () => api.stockAllInCell(p.cellId);
            const list = await loader();
            setSource(p.label, list, loader);
            if (!list.length) notify('Пусто', p.label);
          } catch (e) {
            showError(e);
          }
        }} />
      <PlacePicker visible={pickTarget} title="Куда переместить" onClose={() => setPickTarget(false)}
        onPick={(p: PickedPlace) => {
          setPickTarget(false);
          doMove(p.kind === 'box' ? { boxId: p.boxId } : { cellId: p.cellId }, p.label);
        }} />
      <ActionMenu visible={menu !== null} title={menu?.title} subtitle={menu?.subtitle} actions={menu?.actions ?? []}
        onClose={() => setMenu(null)} />
    </View>
  );
}
