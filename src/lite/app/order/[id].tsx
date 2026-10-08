import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { Chips } from '../../../components/Chips';
import { Scanner, type ScanFeedback } from '../../../components/Scanner';
import { Badge, Button, Card, Empty, Field, Muted, colors, confirm, notify, s, showError, useFocusLoad } from '../../../components/ui';
import { formatQty } from '../../../core/codes';
import { printHtml, saveHtml } from '../../../lib/printHtml';
import { CellPicker, ItemPicker, NewItemModal, QtyModal } from '../../components/pickers';
import { orderFileName, orderHtml, ruDate } from '../../core/forms';
import { CELL_QR_PREFIX, ORDER_TITLE, cells, items, orders, warehouse, type Cell, type Item, type OrderLine } from '../../core/service';
import { useDb } from '../../lib/db';

type ScanMode = 'one' | 'qty';

/**
 * Приходный / расходный ордер. Товар добавляется сканером (1 скан = 1 шт. или с вводом количества)
 * или вручную из номенклатуры. Ордер можно провести и отправить PDF кнопкой «Поделиться».
 */
export default function OrderScreen() {
  const db = useDb();
  const { id: idParam } = useLocalSearchParams<{ id: string }>();
  const id = Number(idParam);
  const [data, reload] = useFocusLoad(async () => ({ order: await orders.get(db, id), lines: await orders.lines(db, id) }), [db, id]);
  const order = data?.order;
  const lines = data?.lines ?? [];
  const draft = order?.status === 'draft';
  const isReceipt = order?.type === 'receipt';

  const [partner, setPartner] = useState('');
  const [comment, setComment] = useState('');
  const [cell, setCell] = useState<Cell | null>(null);
  const [mode, setMode] = useState<ScanMode>('one');
  const [scan, setScan] = useState(false);
  const [pickItem, setPickItem] = useState(false);
  const [pickCell, setPickCell] = useState<'header' | OrderLine | null>(null);
  const [qtyFor, setQtyFor] = useState<{ item: Item; reopenScan: boolean } | null>(null);
  const [editLine, setEditLine] = useState<OrderLine | null>(null);
  const [newCode, setNewCode] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const loadedHeader = useRef(false);

  useEffect(() => {
    if (order && !loadedHeader.current) {
      loadedHeader.current = true;
      setPartner(order.partner ?? '');
      setComment(order.comment ?? '');
    }
  }, [order]);

  // приход по умолчанию — в основную ячейку; расход — «авто»: ячейка, где товара больше всего
  useEffect(() => {
    if (order?.type === 'receipt' && !cell) cells.main(db).then((mid) => cells.get(db, mid)).then(setCell).catch(showError);
  }, [order?.type]); // eslint-disable-line react-hooks/exhaustive-deps

  if (data && !order) return <Empty text="Ордер не найден" />;
  if (!order) return null;

  async function saveHeader() {
    if (!draft) return;
    try {
      await orders.updateHeader(db, id, { partner, comment });
    } catch (e) {
      showError(e);
    }
  }

  async function add(item: Item, qty: number): Promise<OrderLine> {
    const line = await orders.addLine(db, id, { itemId: item.id, qty, cellId: cell?.id ?? null });
    reload();
    return line;
  }

  function feedback(line: OrderLine): ScanFeedback {
    const text = `${line.name}: ${formatQty(line.qty)} ${line.unit} · ячейка ${line.cell_code}`;
    if (!isReceipt && line.qty > line.available) {
      return { ok: true, tone: 'red', text: `${text}\nНа остатке только ${formatQty(line.available)}!` };
    }
    return { ok: true, tone: 'green', text: `✓ ${text}` };
  }

  async function onScan(code: string): Promise<boolean | ScanFeedback> {
    if (code.startsWith(CELL_QR_PREFIX)) return selectCellByCode(code);
    const item = await items.findByCode(db, code);
    if (item) {
      if (mode === 'qty') {
        setScan(false);
        setQtyFor({ item, reopenScan: true });
        return true;
      }
      return feedback(await add(item, 1));
    }
    const c = await cells.findByCode(db, code);
    if (c) return selectCellByCode(code);
    if (isReceipt) {
      setScan(false);
      setNewCode(code);
      return { ok: false, tone: 'yellow', text: `Новый код ${code} — заполните карточку товара` };
    }
    return { ok: false, tone: 'red', text: `Товар с кодом ${code} не найден в номенклатуре` };
  }

  async function selectCellByCode(code: string): Promise<ScanFeedback> {
    const c = await cells.findByCode(db, code);
    if (!c) return { ok: false, tone: 'red', text: `Ячейка ${code} не найдена` };
    setCell(c);
    return { ok: true, tone: 'green', text: `Ячейка ${c.code}: следующие товары — ${isReceipt ? 'в неё' : 'из неё'}` };
  }

  async function onQty(qty: number) {
    const q = qtyFor!;
    setQtyFor(null);
    try {
      const line = await add(q.item, qty);
      if (!isReceipt && line.qty > line.available) notify('Больше, чем на остатке', feedback(line).text);
    } catch (e) {
      showError(e);
    }
    if (q.reopenScan) setTimeout(() => setScan(true), 300);
  }

  async function onEditQty(qty: number) {
    const l = editLine!;
    setEditLine(null);
    try {
      await orders.setLineQty(db, l.id, qty);
      reload();
    } catch (e) {
      showError(e);
    }
  }

  async function step(l: OrderLine, delta: number) {
    try {
      await orders.setLineQty(db, l.id, Math.round((l.qty + delta) * 1000) / 1000);
      reload();
    } catch (e) {
      showError(e);
    }
  }

  async function onPickCell(c: Cell) {
    const target = pickCell;
    setPickCell(null);
    if (target === 'header') return setCell(c);
    if (target) {
      try {
        await orders.setLineCell(db, target.id, c.id);
        reload();
      } catch (e) {
        showError(e);
      }
    }
  }

  function post() {
    const total = lines.reduce((sum, l) => sum + l.qty, 0);
    confirm(`Провести ${ORDER_TITLE[order!.type].toLowerCase()}?`,
      `${lines.length} поз., ${formatQty(total)} шт. ${isReceipt ? 'Товар поступит на склад.' : 'Товар будет списан со склада.'}`, async () => {
        setBusy('post');
        try {
          await saveHeader();
          await orders.post(db, id);
          reload();
          notify('Проведено', `${ORDER_TITLE[order!.type]} ${order!.number}. Нажмите «Поделиться», чтобы отправить PDF.`);
        } catch (e) {
          showError(e);
        } finally {
          setBusy(null);
        }
      }, 'Провести');
  }

  function unpost() {
    confirm('Отменить проведение?', isReceipt ? 'Товар этого ордера будет убран со склада.' : 'Списанный товар вернётся на склад.', async () => {
      try {
        await orders.unpost(db, id);
        reload();
      } catch (e) {
        showError(e);
      }
    }, 'Отменить проведение');
  }

  function remove() {
    confirm('Удалить черновик?', `${ORDER_TITLE[order!.type]} ${order!.number}`, async () => {
      try {
        await orders.remove(db, id);
        router.back();
      } catch (e) {
        showError(e);
      }
    }, 'Удалить');
  }

  async function form() {
    await saveHeader();
    const o = (await orders.get(db, id))!;
    return { html: orderHtml(o, await orders.lines(db, id), await warehouse.get(db)), name: orderFileName(o) };
  }

  async function share() {
    setBusy('share');
    try {
      const f = await form();
      await saveHtml(f.html, f.name);
    } catch (e) {
      showError(e);
    } finally {
      setBusy(null);
    }
  }

  async function print() {
    try {
      await printHtml((await form()).html);
    } catch (e) {
      showError(e);
    }
  }

  const total = lines.reduce((sum, l) => sum + l.qty, 0);
  const short = !isReceipt && lines.some((l) => l.qty > l.available);

  return (
    <View style={s.screen}>
      <Stack.Screen options={{ title: `${isReceipt ? 'Приход' : 'Расход'} ${order.number}` }} />
      <FlatList
        contentContainerStyle={[s.content, { paddingBottom: 24 }]}
        data={lines}
        keyExtractor={(l) => String(l.id)}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View>
            <Card>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <Text style={{ flex: 1, fontSize: 17, fontWeight: '700', color: colors.text }}>
                  {ORDER_TITLE[order.type]} № {order.number}
                </Text>
                <Badge text={draft ? 'черновик' : 'проведён'} tone={draft ? 'warn' : 'success'} />
              </View>
              <Muted>от {ruDate(order.doc_date, true)}{order.posted_at ? ` · проведён ${ruDate(order.posted_at, true)}` : ''}</Muted>
              <View style={{ height: 8 }} />
              <Field label={isReceipt ? 'Поставщик (от кого)' : 'Получатель (кому)'} value={partner} editable={draft}
                onChangeText={setPartner} onBlur={saveHeader} placeholder={draft ? 'необязательно' : ''} />
              <Field label="Комментарий" value={comment} editable={draft} onChangeText={setComment} onBlur={saveHeader} />
            </Card>

            {draft ? (
              <Card>
                <Text style={s.label}>{isReceipt ? 'Ячейка для приёмки' : 'Брать из ячейки'}</Text>
                <View style={s.rowWrap}>
                  <Button title={cell ? cell.code : 'Авто — где больше всего'} variant="secondary" style={{ flex: 1 }} onPress={() => setPickCell('header')} />
                  {!isReceipt && cell ? <Button title="Авто" variant="ghost" onPress={() => setCell(null)} /> : null}
                </View>
                <Muted>Отсканируйте QR ячейки, чтобы сменить её на ходу.</Muted>
                <View style={{ height: 8 }} />
                <Chips value={mode} onChange={setMode} options={[
                  { value: 'one' as ScanMode, label: 'Быстро: 1 скан = 1 шт.' },
                  { value: 'qty' as ScanMode, label: 'С вводом количества' },
                ]} />
                <View style={s.rowWrap}>
                  <Button title="Сканировать" icon="⌖" style={{ flex: 1 }} onPress={() => setScan(true)} />
                  <Button title="Вручную" icon="+" variant="secondary" style={{ flex: 1 }} onPress={() => setPickItem(true)} />
                </View>
              </Card>
            ) : null}

            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6, marginBottom: 6 }}>
              <Text style={s.section}>Товары · {lines.length}</Text>
              <Text style={[s.section, { color: colors.text }]}>Итого: {formatQty(total)}</Text>
            </View>
          </View>
        }
        ListEmptyComponent={<Empty text={draft ? 'Отсканируйте товар или добавьте вручную' : 'Нет товаров'} />}
        renderItem={({ item: l }) => {
          const over = !isReceipt && l.qty > l.available;
          return (
            <View style={[s.card, { marginBottom: 6, padding: 12 }, over && { backgroundColor: colors.dangerSoft, borderColor: colors.danger }]}>
              <Text style={{ fontSize: 15, fontWeight: '600', color: colors.text }}>{l.name}</Text>
              <Muted>{[`Арт. ${l.article}`, l.spp ? `SPP ${l.spp}` : null].filter(Boolean).join(' · ')}</Muted>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 8 }}>
                <Pressable disabled={!draft} onPress={() => setPickCell(l)} style={{ flex: 1 }}>
                  <Text style={{ color: draft ? colors.primary : colors.muted }}>Ячейка {l.cell_code}{draft ? ' ›' : ''}</Text>
                  {!isReceipt ? <Muted>на остатке {formatQty(l.available)}</Muted> : null}
                </Pressable>
                {draft ? (
                  <>
                    <Pressable onPress={() => step(l, -1)} style={qtyBtn}><Text style={qtyBtnText}>−</Text></Pressable>
                    <Pressable onPress={() => setEditLine(l)} style={{ minWidth: 56, alignItems: 'center' }}>
                      <Text style={{ fontSize: 20, fontWeight: '800', color: over ? colors.danger : colors.text }}>{formatQty(l.qty)}</Text>
                    </Pressable>
                    <Pressable onPress={() => step(l, 1)} style={qtyBtn}><Text style={qtyBtnText}>+</Text></Pressable>
                  </>
                ) : <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text }}>{formatQty(l.qty)} {l.unit}</Text>}
              </View>
            </View>
          );
        }}
        ListFooterComponent={
          <View style={{ marginTop: 10 }}>
            {short ? <Muted>Красным — строки, где количество больше остатка в ячейке. Такой ордер не проведётся.</Muted> : null}
            {draft ? <Button title="Провести" icon="✓" variant="success" busy={busy === 'post'} disabled={!lines.length} onPress={post} /> : null}
            <View style={s.rowWrap}>
              <Button title="Поделиться (PDF)" icon="⇪" style={{ flex: 1 }} busy={busy === 'share'} onPress={share} />
              <Button title="Печать" icon="⎙" variant="ghost" onPress={print} />
            </View>
            {draft ? <Button title="Удалить черновик" variant="danger" onPress={remove} />
              : <Button title="Отменить проведение" variant="ghost" onPress={unpost} />}
          </View>
        }
      />

      <Scanner visible={scan} title={`${isReceipt ? 'Приход' : 'Расход'} ${order.number}`}
        hint={`${mode === 'one' ? 'Каждый скан — +1 шт.' : 'После скана — ввод количества.'} Ячейка: ${cell?.code ?? 'авто'}`}
        onClose={() => setScan(false)} onScan={onScan} />
      <ItemPicker visible={pickItem} onlyInStock={!isReceipt} onClose={() => setPickItem(false)}
        onPick={(item) => { setPickItem(false); setTimeout(() => setQtyFor({ item, reopenScan: false }), 250); }} />
      <CellPicker visible={pickCell !== null} onClose={() => setPickCell(null)} onPick={onPickCell} />
      <QtyModal visible={!!qtyFor} title={qtyFor?.item.name ?? ''} subtitle={qtyFor ? `Арт. ${qtyFor.item.article} — сколько ${isReceipt ? 'принять' : 'списать'}?` : ''}
        onClose={() => setQtyFor(null)} onSubmit={onQty} />
      <QtyModal visible={!!editLine} title={editLine?.name ?? ''} subtitle="Количество в строке (0 — удалить строку)"
        initial={editLine ? formatQty(editLine.qty) : '1'} allowZero onClose={() => setEditLine(null)}
        onSubmit={onEditQty} />
      <NewItemModal visible={newCode !== null} barcode={newCode ?? undefined} onClose={() => setNewCode(null)}
        onCreated={async (itemId) => {
          setNewCode(null);
          const item = (await items.get(db, itemId))!;
          if (mode === 'qty') setTimeout(() => setQtyFor({ item, reopenScan: true }), 250);
          else {
            await add(item, 1).catch(showError);
            setTimeout(() => setScan(true), 300);
          }
        }} />
    </View>
  );
}

const qtyBtn = { width: 40, height: 40, borderRadius: 10, backgroundColor: colors.primarySoft, alignItems: 'center' as const, justifyContent: 'center' as const };
const qtyBtnText = { fontSize: 22, fontWeight: '700' as const, color: colors.primary };

