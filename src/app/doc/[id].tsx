import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Alert, Platform, ScrollView, Text, View } from 'react-native';
import { ItemPicker, PlacePicker, QtyPrompt, StockPicker, type PickedPlace } from '../../components/pickers';
import { Scanner } from '../../components/Scanner';
import {
  Badge, Button, Card, Empty, Field, H1, ListRow, Muted, Section, colors, confirm, s, showError, useFocusLoad,
} from '../../components/ui';
import * as repo from '../../db/repo';
import { formatQty, parseScan } from '../../domain/codes';
import type { DocLine, Item, StockRow } from '../../domain/types';
import { useUser } from '../../lib/auth-context';
import { DOC_TITLES } from '../../lib/docs';
import { printDocument } from '../../lib/print';

type QtyReq = { title: string; unit?: string; max?: number; initial?: number; submit: (q: number) => Promise<void> };
type StockReq = { title: string; rows?: StockRow[]; pick: (r: StockRow) => void };

export default function DocumentScreen() {
  const db = useSQLiteContext();
  const user = useUser();
  const id = Number(useLocalSearchParams<{ id: string }>().id);
  const [data, reload] = useFocusLoad(async () => ({
    doc: await repo.getDocument(db, id),
    lines: await repo.listLines(db, id),
  }), [db, id]);

  const [header, setHeader] = useState({ partner: '', recipient: '', comment: '' });
  const [busy, setBusy] = useState(false);
  // Состояния пошаговых диалогов
  const [scanOpen, setScanOpen] = useState(false);
  const [itemPick, setItemPick] = useState<{ barcode?: string } | null>(null);
  const [placePick, setPlacePick] = useState<((p: PickedPlace) => void) | null>(null);
  const [qtyReq, setQtyReq] = useState<QtyReq | null>(null);
  const [stockReq, setStockReq] = useState<StockReq | null>(null);
  // Приход: текущее место размещения (как «ячейка приёмки» в WMS)
  const [target, setTarget] = useState<PickedPlace | null>(null);
  // Расход по факту: открытый (отсканированный) короб
  const [openBox, setOpenBox] = useState<{ id: number; code: string } | null>(null);
  // Поток начат со сканера — после ввода количества сканер откроется снова (непрерывное сканирование)
  const [resume, setResume] = useState(false);

  const doc = data?.doc;
  const lines = data?.lines ?? [];
  useEffect(() => {
    if (doc) setHeader({ partner: doc.partner ?? '', recipient: doc.recipient ?? '', comment: doc.comment ?? '' });
  }, [doc?.id, doc?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!doc) return null;
  const draft = doc.status === 'draft';
  const isReceipt = doc.type === 'receipt';
  const isIssue = doc.type === 'issue';
  const isFact = isIssue && doc.mode === 'fact';

  // iOS не умеет показывать модальное окно, пока закрывается предыдущее, — открываем следующее с задержкой.
  const later = (fn: () => void) => setTimeout(fn, Platform.OS === 'ios' ? 450 : 50);
  const openQty = (r: QtyReq) => later(() => setQtyReq(r));
  const openStock = (r: StockReq) => later(() => setStockReq(r));
  const openPlace = (cb: (p: PickedPlace) => void) => later(() => setPlacePick(() => cb));
  const openItem = (r: { barcode?: string }) => later(() => setItemPick(r));

  const saveHeader = () => repo.updateDocumentHeader(db, id, header).catch(showError);

  /** Сколько ещё можно взять из места с учётом строк этого документа. */
  const freeQty = (r: StockRow) =>
    r.qty - lines
      .filter((l) => l.item_id === r.item_id && (r.box_id ? l.box_id === r.box_id : !l.box_id && l.cell_id === r.cell_id))
      .reduce((a, l) => a + l.qty, 0);

  // ------------------------------------------------------------ приход

  function placeToLine(p: PickedPlace) {
    return p.kind === 'box' ? { boxId: p.boxId } : { cellId: p.cellId };
  }

  function receiveItem(item: Item) {
    const go = (place: PickedPlace) =>
      openQty({
        title: `${item.name}\n→ ${place.label}`,
        unit: item.unit,
        submit: async (qty) => {
          await repo.addLine(db, id, { itemId: item.id, qty, ...placeToLine(place) });
        },
      });
    if (target) go(target);
    else openPlace((p: PickedPlace) => { setTarget(p); go(p); });
  }

  // ------------------------------------------------------------ расход

  function issueFromRow(r: StockRow) {
    const free = freeQty(r);
    if (free <= 0) {
      Alert.alert('Уже в документе', `Всё количество из этого места уже добавлено (${formatQty(r.qty)} ${r.unit})`);
      return;
    }
    openQty({
      title: `${r.item_name}\n← ${r.address ?? '—'}${r.box_code ? ' · ' + r.box_code : ''}`,
      unit: r.unit,
      max: free,
      initial: 1,
      submit: async (qty) => {
        await repo.addLine(db, id, { itemId: r.item_id, qty, cellId: r.cell_id, boxId: r.box_id });
      },
    });
  }

  function issuePlanItem(item: Item) {
    repo.stockByItem(db, item.id).then((rows) => {
      const total = rows.reduce((a, r) => a + r.qty, 0);
      const inDoc = lines.filter((l) => l.item_id === item.id).reduce((a, l) => a + l.qty, 0);
      if (total - inDoc <= 0) {
        Alert.alert('Нет остатка', `«${item.name}» отсутствует на складе или уже весь в документе`);
        return;
      }
      openQty({
        title: `${item.name}\nсистема подберёт места хранения (FIFO)`,
        unit: item.unit,
        max: total - inDoc,
        submit: async (qty) => {
          const r = await repo.addIssueLineAuto(db, id, item.id, qty);
          if (r.shortage > 0) Alert.alert('Не хватает', `Не хватило ${formatQty(r.shortage)} ${item.unit}`);
        },
      });
    }).catch(showError);
  }

  /** Расход по факту: выбрать строку остатка товара (с приоритетом открытого короба). */
  async function issueFactItem(item: Item) {
    const rows = await repo.stockByItem(db, item.id);
    const inBox = openBox ? rows.find((r) => r.box_id === openBox.id) : undefined;
    if (inBox) return issueFromRow(inBox);
    if (!rows.length) {
      Alert.alert('Нет остатка', `«${item.name}» не числится на складе`);
      return;
    }
    if (rows.length === 1) return issueFromRow(rows[0]);
    openStock({ title: `Откуда берём «${item.name}»?`, rows, pick: issueFromRow });
  }

  // ------------------------------------------------------------ сканирование

  async function onScan(code: string): Promise<boolean> {
    const r = await repo.resolveScan(db, parseScan(code));
    if (r.type !== 'none') setResume(true);
    if (isReceipt) {
      if (r.type === 'cell') {
        setTarget({ kind: 'cell', cellId: r.cell.id, label: r.cell.address });
        return true; // место выбрано — сканер закрывается, видно «Размещать в…»
      }
      if (r.type === 'box') {
        const b = await repo.getBox(db, r.box.id);
        setTarget({ kind: 'box', boxId: r.box.id, cellId: r.box.cell_id, label: `${b?.address ?? '—'} · ${r.box.code}` });
        return true;
      }
      setScanOpen(false);
      if (r.type === 'item') receiveItem(r.item);
      else {
        Alert.alert('Неизвестный код', `${r.value}\nСоздать новый товар с этим штрихкодом?`, [
          { text: 'Нет', style: 'cancel' },
          { text: 'Создать', onPress: () => openItem({ barcode: r.value }) },
        ]);
      }
      return true;
    }
    // расход
    if (r.type === 'box') {
      const rows = await repo.stockInBox(db, r.box.id);
      setScanOpen(false);
      setOpenBox({ id: r.box.id, code: r.box.code });
      if (!rows.length) Alert.alert('Короб пуст', r.box.code);
      else openStock({ title: `Короб ${r.box.code}: что изымаем?`, rows, pick: issueFromRow });
      return true;
    }
    if (r.type === 'cell') {
      const rows = await repo.stockAllInCell(db, r.cell.id);
      setScanOpen(false);
      if (!rows.length) Alert.alert('Ячейка пуста', r.cell.address);
      else openStock({ title: `${r.cell.address}: что изымаем?`, rows, pick: issueFromRow });
      return true;
    }
    if (r.type === 'item') {
      setScanOpen(false);
      if (isFact) await issueFactItem(r.item);
      else issuePlanItem(r.item);
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------ строки

  function lineActions(l: DocLine) {
    if (!draft) return;
    Alert.alert(l.item_name, `${formatQty(l.qty)} ${l.unit} · ${l.address ?? '—'}${l.box_code ? ' · ' + l.box_code : ''}`, [
      {
        text: 'Изменить количество',
        onPress: async () => {
          let max: number | undefined;
          if (isIssue) {
            const rows = await repo.stockByItem(db, l.item_id);
            const row = rows.find((r) => (l.box_id ? r.box_id === l.box_id : !r.box_id && r.cell_id === l.cell_id));
            max = row ? freeQty(row) + l.qty : l.qty;
          }
          openQty({ title: l.item_name, unit: l.unit, max, initial: l.qty,
            submit: (qty) => repo.updateLine(db, l.id, { qty }) });
        },
      },
      {
        text: isReceipt ? 'Изменить место' : 'Взять из другого места',
        onPress: async () => {
          if (isReceipt) {
            openPlace((p: PickedPlace) => {
              repo.updateLine(db, l.id, { place: placeToLine(p) }).then(reload).catch(showError);
            });
          } else {
            const rows = await repo.stockByItem(db, l.item_id);
            openStock({
              title: `Откуда берём «${l.item_name}»?`,
              rows,
              pick: (r) => {
                if (r.qty < l.qty) {
                  showError(new repo.BusinessError(`В этом месте только ${formatQty(r.qty)} ${r.unit}`));
                  return;
                }
                repo.updateLine(db, l.id, { place: r.box_id ? { boxId: r.box_id } : { cellId: r.cell_id! } })
                  .then(reload).catch(showError);
              },
            });
          }
        },
      },
      { text: 'Удалить строку', style: 'destructive', onPress: () => repo.deleteLine(db, l.id).then(reload).catch(showError) },
      { text: 'Отмена', style: 'cancel' },
    ]);
  }

  // ------------------------------------------------------------ проведение

  async function post() {
    setBusy(true);
    try {
      await repo.updateDocumentHeader(db, id, header);
      await repo.postDocument(db, id, user.id);
      reload();
      Alert.alert('Проведено', `${doc!.number}: остатки обновлены, движения записаны в историю`);
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  }

  async function unpost() {
    confirm('Отменить проведение?', 'Остатки будут возвращены, документ станет черновиком', async () => {
      try {
        await repo.unpostDocument(db, id);
        reload();
      } catch (e) {
        showError(e);
      }
    }, 'Отменить проведение');
  }

  const total = lines.reduce((a, l) => a + l.qty, 0);
  const subtitle = isFact ? 'по факту (сканирование)' : isIssue ? 'по заявке' : '';

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: doc.number }} />
      <ScrollView style={s.screen} contentContainerStyle={[s.content, { paddingBottom: 120 }]}
        keyboardShouldPersistTaps="handled">
        <Card>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <View style={{ flex: 1 }}>
              <H1>{DOC_TITLES[doc.type]}</H1>
              <Muted>№ {doc.number} от {doc.doc_date.slice(0, 16)}{subtitle ? ` · ${subtitle}` : ''}</Muted>
              <Muted>Составил: {doc.created_by_name}</Muted>
              {doc.posted_at ? <Muted>Провёл: {doc.posted_by_name}, {doc.posted_at}</Muted> : null}
            </View>
            <Badge text={draft ? 'черновик' : 'проведён'} tone={draft ? 'warn' : 'success'} />
          </View>
        </Card>

        {doc.type !== 'move' ? (
          <Card>
            {isIssue ? (
              <Field label="Получатель (кому выдаются ТМЦ) *" value={header.recipient} editable={draft}
                onChangeText={(recipient) => setHeader({ ...header, recipient })} onEndEditing={saveHeader}
                placeholder="ФИО / подразделение" />
            ) : null}
            <Field label={isReceipt ? 'Поставщик / основание' : 'Основание (заявка, объект)'} value={header.partner}
              editable={draft} onChangeText={(partner) => setHeader({ ...header, partner })} onEndEditing={saveHeader} />
            <Field label="Комментарий" value={header.comment} editable={draft} multiline
              onChangeText={(comment) => setHeader({ ...header, comment })} onEndEditing={saveHeader} />
          </Card>
        ) : null}

        {draft && isReceipt ? (
          <Card style={{ backgroundColor: colors.successSoft }}>
            <Muted>Размещать в:</Muted>
            <Text style={{ fontSize: 16, fontWeight: '600', color: colors.text, marginVertical: 4 }}>
              {target ? target.label : 'не выбрано — выберите или отсканируйте ячейку/короб'}
            </Text>
            <Button title="Выбрать место" variant="ghost"
              onPress={() => openPlace((p: PickedPlace) => setTarget(p))} />
          </Card>
        ) : null}

        {draft && isFact && openBox ? (
          <Card style={{ backgroundColor: colors.warnSoft }}>
            <Muted>Открыт короб: {openBox.code} — товары, отсканированные дальше, берутся в первую очередь из него</Muted>
            <View style={s.rowWrap}>
              <Button title="Содержимое" variant="ghost" style={{ flex: 1 }} onPress={async () => {
                const rows = await repo.stockInBox(db, openBox.id);
                openStock({ title: `Короб ${openBox.code}`, rows, pick: issueFromRow });
              }} />
              <Button title="Закрыть короб" variant="ghost" style={{ flex: 1 }} onPress={() => setOpenBox(null)} />
            </View>
          </Card>
        ) : null}

        <Section title={`Строки · ${lines.length} поз. · ${formatQty(total)} ед.`}>
          <View style={{ borderRadius: 12, overflow: 'hidden' }}>
            {lines.length ? lines.map((l, i) => (
              <ListRow
                key={l.id}
                title={`${i + 1}. ${l.item_name}`}
                subtitle={`${l.sku} · ${isReceipt ? '→' : '←'} ${l.address ?? 'место не указано'}${l.box_code ? ' · короб ' + l.box_code : ''}${l.to_address ? ' → ' + l.to_address : ''}`}
                right={`${formatQty(l.qty)} ${l.unit}`}
                onPress={draft ? () => lineActions(l) : undefined}
              />
            )) : <Empty text={isFact ? 'Отсканируйте короб, ячейку или товар' : 'Добавьте товары'} />}
          </View>
        </Section>

        {draft ? (
          <View style={{ marginTop: 12 }}>
            {isFact ? (
              <Button title="Выбрать из остатков" variant="secondary" icon="≣"
                onPress={() => { setResume(false); openStock({ title: 'Что изымаем?', pick: issueFromRow }); }} />
            ) : (
              <Button title="Добавить товар из списка" variant="secondary" icon="+" onPress={() => { setResume(false); openItem({}); }} />
            )}
            <Button title="Удалить черновик" variant="danger"
              onPress={() => confirm('Удалить документ?', doc.number, async () => {
                try {
                  await repo.deleteDocument(db, id);
                  router.back();
                } catch (e) {
                  showError(e);
                }
              })} />
          </View>
        ) : null}

        <Button title={isIssue ? 'Печать ордера / лист подбора' : 'Печать'} icon="⎙" variant="ghost"
          disabled={!lines.length} onPress={() => printDocument(doc, lines).catch(showError)} />
        {!draft && doc.type !== 'move' ? (
          <Button title="Отменить проведение" variant="danger" onPress={unpost} />
        ) : null}
      </ScrollView>

      {draft ? (
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 12, paddingBottom: 28,
          backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border, flexDirection: 'row', gap: 8 }}>
          <Button title="Сканировать" icon="⌗" style={{ flex: 1 }} onPress={() => setScanOpen(true)} />
          <Button title="Провести" variant="success" style={{ flex: 1 }} busy={busy} disabled={!lines.length}
            onPress={post} />
        </View>
      ) : null}

      <Scanner
        visible={scanOpen}
        onClose={() => setScanOpen(false)}
        onScan={onScan}
        title={isReceipt ? 'Приёмка' : 'Изъятие'}
        hint={isReceipt
          ? 'QR ячейки/короба — выбрать место размещения; штрихкод/QR товара — добавить товар'
          : isFact
            ? 'QR короба или ячейки — показать содержимое; штрихкод/QR товара — изъять товар (короб сканировать не обязательно)'
            : 'Штрихкод/QR товара — добавить в заявку'}
      />
      <ItemPicker
        visible={itemPick !== null}
        newBarcode={itemPick?.barcode}
        allowCreate={isReceipt}
        onClose={() => setItemPick(null)}
        onPick={(item) => {
          setItemPick(null);
          if (isReceipt) receiveItem(item);
          else issuePlanItem(item);
        }}
      />
      <PlacePicker
        visible={placePick !== null}
        title="Куда разместить"
        onClose={() => setPlacePick(null)}
        onPick={(p) => {
          const cb = placePick;
          setPlacePick(null);
          cb?.(p);
        }}
      />
      <StockPicker
        visible={stockReq !== null}
        title={stockReq?.title}
        rows={stockReq?.rows}
        onClose={() => { setStockReq(null); setResume(false); }}
        onPick={(r) => {
          const cb = stockReq?.pick;
          setStockReq(null);
          cb?.(r);
        }}
      />
      <QtyPrompt
        visible={qtyReq !== null}
        title={qtyReq?.title ?? ''}
        unit={qtyReq?.unit}
        max={qtyReq?.max}
        initial={qtyReq?.initial}
        onClose={() => { setQtyReq(null); setResume(false); }}
        onSubmit={async (qty) => {
          const req = qtyReq;
          setQtyReq(null);
          try {
            await req?.submit(qty);
            reload();
            if (resume) later(() => setScanOpen(true));
          } catch (e) {
            showError(e);
          }
        }}
      />
    </View>
  );
}
