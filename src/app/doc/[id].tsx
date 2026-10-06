import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, ScrollView, Switch, Text, View } from 'react-native';
import { ActionMenu, type MenuAction } from '../../components/ActionMenu';
import { Chips } from '../../components/Chips';
import { ItemPicker, PlacePicker, QtyPrompt, StockPicker, TextPrompt, type PickedPlace } from '../../components/pickers';
import { Scanner } from '../../components/Scanner';
import {
  Badge, Button, Card, Empty, Field, H1, ListRow, Muted, Section, colors, confirm, notify, s, showError, useFocusLoad,
} from '../../components/ui';
import { custodyQr, formatQty } from '../../core/codes';
import { BusinessError } from '../../core/db';
import {
  CONDITION_LABEL, CUSTODY_STATUS_LABEL, type DocLine, type Item, type ReturnCondition, type StockRow,
} from '../../core/types';
import { useApi, useBackend, usePerms } from '../../lib/backend';
import { DOC_SOURCE_LABEL, DOC_TITLES } from '../../lib/docs';
import { printDocument, printLabels } from '../../lib/print';

type QtyReq = { title: string; unit?: string; max?: number; initial?: number; submit: (q: number) => Promise<void> };
type StockReq = { title: string; rows?: StockRow[]; pick: (r: StockRow) => void };
type Menu = { title: string; subtitle?: string; actions: MenuAction[] };

const CONDITIONS = Object.keys(CONDITION_LABEL) as ReturnCondition[];

export default function DocumentScreen() {
  const api = useApi();
  const { user } = useBackend();
  const perms = usePerms();
  const id = Number(useLocalSearchParams<{ id: string }>().id);
  const [data, reload] = useFocusLoad(async () => {
    const doc = await api.getDocument(id);
    const [lines, warehouses, custody] = await Promise.all([
      api.listLines(id),
      api.listWarehouses(),
      doc.type === 'issue' && doc.post_mode === 'custody' ? api.custodyByIssueDoc(id) : Promise.resolve([]),
    ]);
    return { doc, lines, warehouses, custody };
  }, [api, id]);

  const [header, setHeader] = useState({ partner: '', recipient: '', comment: '' });
  const [busy, setBusy] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [itemPick, setItemPick] = useState<{ barcode?: string } | null>(null);
  const [placePick, setPlacePick] = useState<((p: PickedPlace) => void) | null>(null);
  const [qtyReq, setQtyReq] = useState<QtyReq | null>(null);
  const [stockReq, setStockReq] = useState<StockReq | null>(null);
  const [textReq, setTextReq] = useState<{ title: string; initial?: string; submit: (t: string) => void } | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  // Приход: место размещения (по умолчанию — буферная ячейка склада)
  const [target, setTarget] = useState<PickedPlace | null>(null);
  // Приход: каждый скан = +1 шт без запроса количества
  const [quick, setQuick] = useState(false);
  // Расход по факту: открытый (отсканированный) короб
  const [openBox, setOpenBox] = useState<{ id: number; code: string } | null>(null);
  const [resume, setResume] = useState(false);

  const doc = data?.doc;
  const lines = data?.lines ?? [];
  const warehouses = data?.warehouses ?? [];

  useEffect(() => {
    if (doc) setHeader({ partner: doc.partner ?? '', recipient: doc.recipient ?? '', comment: doc.comment ?? '' });
  }, [doc?.id, doc?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // Приход на единственный склад — склад выбирается автоматически.
  useEffect(() => {
    if (doc && doc.type === 'receipt' && doc.status === 'draft' && !doc.warehouse_id && warehouses.length === 1) {
      api.updateDocumentHeader(id, { ...header, warehouseId: warehouses[0].id }).then(reload).catch(showError);
    }
  }, [doc?.id, warehouses.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!doc || !user) return null;
  const draft = doc.status === 'draft';
  const isReceipt = doc.type === 'receipt';
  const isReturn = doc.source === 'return';
  const isIssue = doc.type === 'issue';
  const isFact = isIssue && doc.mode === 'fact';
  const canEdit = draft && !isReturn && (perms.operate || doc.created_by === user.id);

  const later = (fn: () => void) => setTimeout(fn, Platform.OS === 'ios' ? 450 : 50);
  const openQty = (r: QtyReq) => later(() => setQtyReq(r));
  const openStock = (r: StockReq) => later(() => setStockReq(r));
  const openPlace = (cb: (p: PickedPlace) => void) => later(() => setPlacePick(() => cb));
  const openItem = (r: { barcode?: string }) => later(() => setItemPick(r));
  const saveHeader = () => draft && !isReturn && api.updateDocumentHeader(id, header).catch(showError);

  const freeQty = (r: StockRow) =>
    r.qty - lines
      .filter((l) => l.item_id === r.item_id && (r.box_id ? l.box_id === r.box_id : !l.box_id && l.cell_id === r.cell_id))
      .reduce((a, l) => a + l.qty, 0);

  const placeToLine = (p: PickedPlace | null) => (p ? (p.kind === 'box' ? { boxId: p.boxId } : { cellId: p.cellId }) : {});

  // ------------------------------------------------------------ приход

  async function receiveItem(item: Item) {
    if (quick) {
      await api.addLine(id, { itemId: item.id, qty: 1, ...placeToLine(target) });
      reload();
      return;
    }
    openQty({
      title: `${item.name}\n→ ${target ? target.label : 'буферная ячейка'}`,
      unit: item.unit,
      submit: async (qty) => {
        await api.addLine(id, { itemId: item.id, qty, ...placeToLine(target) });
      },
    });
  }

  // ------------------------------------------------------------ расход

  function issueFromRow(r: StockRow) {
    const free = freeQty(r);
    if (free <= 0) {
      notify('Уже в документе', `Всё количество из этого места уже добавлено (${formatQty(r.qty)} ${r.unit})`);
      return;
    }
    openQty({
      title: `${r.item_name}\n← ${r.address ?? '—'}${r.box_code ? ' · ' + r.box_code : ''}`,
      unit: r.unit,
      max: free,
      initial: 1,
      submit: async (qty) => {
        await api.addLine(id, { itemId: r.item_id, qty, cellId: r.cell_id, boxId: r.box_id });
      },
    });
  }

  async function issuePlanItem(item: Item) {
    try {
      const rows = await api.stockByItem(item.id);
      const total = rows.reduce((a, r) => a + r.qty, 0);
      const inDoc = lines.filter((l) => l.item_id === item.id).reduce((a, l) => a + l.qty, 0);
      if (total - inDoc <= 0) return notify('Нет остатка', `«${item.name}» отсутствует на складе или уже весь в документе`);
      openQty({
        title: `${item.name}\nсистема подберёт места хранения (FIFO по дате приёмки)`,
        unit: item.unit,
        max: total - inDoc,
        submit: async (qty) => {
          const r = await api.addIssueLineAuto(id, item.id, qty);
          if (r.shortage > 0) notify('Не хватает', `Не хватило ${formatQty(r.shortage)} ${item.unit}`);
        },
      });
    } catch (e) {
      showError(e);
    }
  }

  async function issueFactItem(item: Item) {
    const rows = await api.stockByItem(item.id);
    const inBox = openBox ? rows.find((r) => r.box_id === openBox.id) : undefined;
    if (inBox) return issueFromRow(inBox);
    if (!rows.length) return notify('Нет остатка', `«${item.name}» не числится на складе`);
    if (rows.length === 1) return issueFromRow(rows[0]);
    openStock({ title: `Откуда берём «${item.name}»?`, rows, pick: issueFromRow });
  }

  // ------------------------------------------------------------ сканирование

  async function onScan(code: string): Promise<boolean> {
    const r = await api.resolveScan(code);
    if (r.type !== 'none') setResume(true);
    if (isReceipt) {
      if (r.type === 'cell') {
        setTarget({ kind: 'cell', cellId: r.cell.id, label: r.cell.address });
        return true;
      }
      if (r.type === 'box') {
        const b = await api.getBox(r.box.id);
        setTarget({ kind: 'box', boxId: r.box.id, cellId: r.box.cell_id, label: `${b?.address ?? '—'} · ${r.box.code}` });
        return true;
      }
      if (r.type === 'item') {
        if (quick) {
          await receiveItem(r.item);
          return true; // сканер остаётся открытым — сканируйте дальше
        }
        setScanOpen(false);
        await receiveItem(r.item);
        return true;
      }
      setScanOpen(false);
      if (perms.operate) {
        later(() => confirm('Неизвестный код', `${code}\nСоздать новый товар с этим штрихкодом?`, () => openItem({ barcode: code }), 'Создать'));
      }
      return true;
    }
    if (r.type === 'box') {
      const rows = await api.stockInBox(r.box.id);
      setScanOpen(false);
      setOpenBox({ id: r.box.id, code: r.box.code });
      if (!rows.length) notify('Короб пуст', r.box.code);
      else openStock({ title: `Короб ${r.box.code}: что изымаем?`, rows, pick: issueFromRow });
      return true;
    }
    if (r.type === 'cell') {
      const rows = await api.stockAllInCell(r.cell.id);
      setScanOpen(false);
      if (!rows.length) notify('Ячейка пуста', r.cell.address);
      else openStock({ title: `${r.cell.address}: что изымаем?`, rows, pick: issueFromRow });
      return true;
    }
    if (r.type === 'item') {
      setScanOpen(false);
      if (isFact) await issueFactItem(r.item);
      else await issuePlanItem(r.item);
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------ строки

  function lineActions(l: DocLine) {
    if (isReturn && draft) {
      return setMenu({
        title: l.item_name,
        subtitle: `${l.custody_code ?? ''} · ${CONDITION_LABEL[l.condition ?? 'ok']}`,
        actions: [
          ...CONDITIONS.map((c) => ({
            label: `Отметка: ${CONDITION_LABEL[c]}`,
            onPress: () => api.updateLine(l.id, { condition: c }).then(reload).catch(showError),
          })),
          {
            label: 'Примечание',
            onPress: () => later(() => setTextReq({ title: 'Примечание', initial: l.note ?? '',
              submit: (t) => api.updateLine(l.id, { note: t }).then(reload).catch(showError) })),
          },
        ],
      });
    }
    if (!canEdit) return;
    setMenu({
      title: l.item_name,
      subtitle: `${formatQty(l.qty)} ${l.unit} · ${l.address ?? 'буферная ячейка'}${l.box_code ? ' · ' + l.box_code : ''}`,
      actions: [
        {
          label: 'Изменить количество',
          onPress: async () => {
            let max: number | undefined;
            if (isIssue) {
              const rows = await api.stockByItem(l.item_id);
              const inPlace = rows.filter((r) => (l.box_id ? r.box_id === l.box_id : !r.box_id && r.cell_id === l.cell_id));
              max = inPlace.reduce((a, r) => a + r.qty, 0);
            }
            openQty({ title: l.item_name, unit: l.unit, max, initial: l.qty, submit: (qty) => api.updateLine(l.id, { qty }) });
          },
        },
        {
          label: isReceipt ? 'Изменить место' : 'Взять из другого места',
          onPress: async () => {
            if (isReceipt) {
              openPlace((p) => api.updateLine(l.id, { place: p.kind === 'box' ? { boxId: p.boxId } : { cellId: p.cellId } })
                .then(reload).catch(showError));
            } else {
              const rows = await api.stockByItem(l.item_id);
              openStock({
                title: `Откуда берём «${l.item_name}»?`, rows,
                pick: (r) => {
                  if (r.qty < l.qty) return showError(new BusinessError(`В этом месте только ${formatQty(r.qty)} ${r.unit}`));
                  api.updateLine(l.id, { place: r.box_id ? { boxId: r.box_id } : { cellId: r.cell_id! } }).then(reload).catch(showError);
                },
              });
            }
          },
        },
        { label: 'Удалить строку', danger: true, onPress: () => api.deleteLine(l.id).then(reload).catch(showError) },
      ],
    });
  }

  // ------------------------------------------------------------ проведение

  async function run(fn: () => Promise<unknown>, done?: string) {
    setBusy(true);
    try {
      if (!isReturn) await api.updateDocumentHeader(id, header);
      await fn();
      reload();
      if (done) notify('Готово', done);
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  }

  const postReceipt = () => run(() => api.postReceipt(id),
    `${doc.number}: ${isReturn ? 'ТМЦ приняты на склад (буферная ячейка), отметки сохранены' : 'остатки обновлены'}`);

  const writeOff = () => confirm('Списать ТМЦ?', 'Товар будет списан из базы в количестве, указанном в ордере.',
    () => run(() => api.postIssue(id, 'writeoff'), `${doc.number}: ТМЦ списаны`), 'Списать');

  const giveOut = () => {
    if (!perms.operate) {
      return confirm('Взять ТМЦ на себя?', 'ТМЦ будут числиться на вас до возврата.',
        () => run(() => api.postIssue(id, 'custody'), 'ТМЦ записаны на вас'), 'Взять');
    }
    saveHeader();
    router.push({ pathname: '/doc/allocate', params: { id: String(id) } });
  };

  const total = lines.reduce((a, l) => a + l.qty, 0);
  const subtitle = isReturn ? `возврат по ${doc.base_doc_number}` : DOC_SOURCE_LABEL[doc.source] ?? '';
  const modeLabel = doc.post_mode === 'custody' ? 'выдано под ответственность' : doc.post_mode === 'writeoff' ? 'списано' : '';
  const byHolder = new Map<string, typeof data.custody>();
  for (const k of data.custody) byHolder.set(k.holder_name, [...(byHolder.get(k.holder_name) ?? []), k]);
  const returnedNoReceipt = data.custody.some((k) => k.status === 'returned' && !k.return_doc_id);

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: doc.number }} />
      <ScrollView style={s.screen} contentContainerStyle={[s.content, { paddingBottom: 140 }]} keyboardShouldPersistTaps="handled">
        <Card>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <View style={{ flex: 1 }}>
              <H1>{DOC_TITLES[doc.type]}</H1>
              <Muted>№ {doc.number} от {doc.doc_date.slice(0, 16)}{subtitle ? ` · ${subtitle}` : ''}</Muted>
              <Muted>Составил: {doc.created_by_name}</Muted>
              {doc.posted_at ? <Muted>Провёл: {doc.posted_by_name}, {doc.posted_at}{modeLabel ? ` · ${modeLabel}` : ''}</Muted> : null}
              {doc.warehouse_name ? <Muted>Склад: {doc.warehouse_name}</Muted> : null}
            </View>
            <Badge text={draft ? 'черновик' : modeLabel || 'проведён'} tone={draft ? 'warn' : 'success'} />
          </View>
        </Card>

        {doc.type !== 'move' && !isReturn ? (
          <Card>
            {isReceipt && draft && warehouses.length > 1 ? (
              <>
                <Muted>Склад приёмки</Muted>
                <Chips value={doc.warehouse_id ?? undefined}
                  onChange={(w) => api.updateDocumentHeader(id, { ...header, warehouseId: w ?? null }).then(reload).catch(showError)}
                  options={warehouses.map((w) => ({ value: w.id as number | undefined, label: w.name }))} />
              </>
            ) : null}
            {isIssue && perms.operate ? (
              <Field label="Кому / куда (для списания — получатель или объект)" value={header.recipient} editable={canEdit}
                onChangeText={(recipient) => setHeader({ ...header, recipient })} onEndEditing={saveHeader} />
            ) : null}
            <Field label={isReceipt ? 'Поставщик / основание' : 'Основание (заявка, объект)'} value={header.partner}
              editable={canEdit} onChangeText={(partner) => setHeader({ ...header, partner })} onEndEditing={saveHeader} />
            <Field label="Комментарий" value={header.comment} editable={canEdit} multiline
              onChangeText={(comment) => setHeader({ ...header, comment })} onEndEditing={saveHeader} />
          </Card>
        ) : null}

        {canEdit && isReceipt ? (
          <Card style={{ backgroundColor: colors.successSoft }}>
            <Muted>Размещать в:</Muted>
            <Text style={{ fontSize: 16, fontWeight: '600', color: colors.text, marginVertical: 4 }}>
              {target ? target.label : 'буферная ячейка склада (разложите потом перемещением)'}
            </Text>
            <View style={s.rowWrap}>
              <Button title="Выбрать место" variant="ghost" style={{ flex: 1 }} onPress={() => openPlace((p) => setTarget(p))} />
              {target ? <Button title="В буфер" variant="ghost" style={{ flex: 1 }} onPress={() => setTarget(null)} /> : null}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
              <Text style={{ color: colors.text, flex: 1 }}>Быстрый режим: каждый скан = +1 шт</Text>
              <Switch value={quick} onValueChange={setQuick} />
            </View>
          </Card>
        ) : null}

        {canEdit && isFact && openBox ? (
          <Card style={{ backgroundColor: colors.warnSoft }}>
            <Muted>Открыт короб: {openBox.code} — товары, отсканированные дальше, берутся в первую очередь из него</Muted>
            <View style={s.rowWrap}>
              <Button title="Содержимое" variant="ghost" style={{ flex: 1 }} onPress={async () => {
                const rows = await api.stockInBox(openBox.id);
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
                subtitle={[
                  `${l.sku}${l.custody_code ? ' · ' + l.custody_code : ''}`,
                  isReturn
                    ? `${CONDITION_LABEL[l.condition ?? 'ok']}${l.accept ? '' : ' — не приходуется'}${l.note ? ` · «${l.note}»` : ''}`
                    : `${isReceipt ? '→' : '←'} ${l.address ?? 'буферная ячейка'}${l.box_code ? ' · короб ' + l.box_code : ''}${l.to_address ? ' → ' + l.to_address : ''}${l.received_at ? ' · партия ' + l.received_at : ''}`,
                ].join('\n')}
                left={isReturn ? <Badge text={l.condition === 'ok' || !l.condition ? '✓' : '!'} tone={l.accept ? (l.condition === 'ok' || !l.condition ? 'success' : 'warn') : 'danger'} /> : undefined}
                right={`${formatQty(l.qty)} ${l.unit}`}
                onPress={(canEdit || (isReturn && draft)) ? () => lineActions(l) : undefined}
              />
            )) : <Empty text={isFact ? 'Отсканируйте короб, ячейку или товар' : 'Добавьте товары'} />}
          </View>
        </Section>

        {data.custody.length ? (
          <Section title={`Выдано · ${byHolder.size} чел.`} action={
            <Button title="QR-этикетки" variant="secondary" style={{ minHeight: 34, marginVertical: 0 }}
              onPress={() => printLabels(data.custody.map((k) => ({ qr: custodyQr(k.code), title: k.code, subtitle: `${k.item_name} · ${k.holder_name}` }))).catch(showError)} />
          }>
            <View style={{ borderRadius: 12, overflow: 'hidden' }}>
              {[...byHolder.entries()].map(([holder, list]) => (
                <ListRow key={holder} title={holder}
                  subtitle={list.map((k) => `${k.item_name} ${formatQty(k.qty)} ${k.unit} — ${CUSTODY_STATUS_LABEL[k.status]}`).join('\n')}
                  right={`${list.filter((k) => k.status === 'held').length} на руках`}
                  onPress={() => router.push({ pathname: '/custody/[id]', params: { id: String(list[0].id) } })} />
              ))}
            </View>
            {returnedNoReceipt ? (
              <Button title="Оформить приход по уже возвращённым" variant="secondary"
                onPress={() => run(async () => {
                  const rid = await api.receiptForReturned(id);
                  router.push({ pathname: '/doc/[id]', params: { id: String(rid) } });
                })} />
            ) : null}
          </Section>
        ) : null}

        {canEdit ? (
          <View style={{ marginTop: 12 }}>
            {isFact || !perms.operate ? (
              <Button title="Выбрать из остатков" variant="secondary" icon="≣"
                onPress={() => { setResume(false); openStock({ title: 'Что берём?', pick: issueFromRow }); }} />
            ) : (
              <Button title="Добавить товар из списка" variant="secondary" icon="+" onPress={() => { setResume(false); openItem({}); }} />
            )}
            <Button title="Удалить черновик" variant="danger"
              onPress={() => confirm('Удалить документ?', doc.number, async () => {
                try {
                  await api.deleteDocument(id);
                  router.back();
                } catch (e) {
                  showError(e);
                }
              })} />
          </View>
        ) : null}

        <Button title={isIssue ? 'Печать ордера / лист подбора' : 'Печать'} icon="⎙" variant="ghost"
          disabled={!lines.length} onPress={() => printDocument(doc, lines).catch(showError)} />
        {!draft && doc.type !== 'move' && (perms.operate || isReturn) ? (
          <Button title="Отменить проведение" variant="danger" onPress={() => confirm('Отменить проведение?',
            'Остатки будут возвращены, документ станет черновиком', () => run(() => api.unpostDocument(id)), 'Отменить проведение')} />
        ) : null}
      </ScrollView>

      {draft && (canEdit || isReturn) ? (
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 12, paddingBottom: 28,
          backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border, flexDirection: 'row', gap: 8 }}>
          {canEdit ? <Button title="Сканировать" icon="⌗" style={{ flex: 1 }} onPress={() => setScanOpen(true)} /> : null}
          {isReceipt ? (
            <Button title="Провести" variant="success" style={{ flex: 1 }} busy={busy} disabled={!lines.length} onPress={postReceipt} />
          ) : null}
          {isIssue && perms.operate ? (
            <Button title="Списать" variant="danger" style={{ flex: 1 }} busy={busy} disabled={!lines.length} onPress={writeOff} />
          ) : null}
          {isIssue && perms.custody ? (
            <Button title={perms.operate ? 'Выдать' : 'Взять себе'} variant="success" style={{ flex: 1 }} busy={busy}
              disabled={!lines.length} onPress={giveOut} />
          ) : null}
        </View>
      ) : null}

      <Scanner
        visible={scanOpen}
        onClose={() => setScanOpen(false)}
        onScan={onScan}
        title={isReceipt ? 'Приёмка' : 'Изъятие'}
        hint={isReceipt
          ? `QR ячейки/короба — место размещения; ШК товара — ${quick ? '+1 шт' : 'добавить с количеством'}`
          : isFact
            ? 'QR короба или ячейки — содержимое; ШК/QR товара — изъять (короб сканировать не обязательно)'
            : 'ШК/QR товара — добавить в заявку'}
      />
      <ItemPicker visible={itemPick !== null} newBarcode={itemPick?.barcode} allowCreate={isReceipt}
        onClose={() => setItemPick(null)}
        onPick={(item) => {
          setItemPick(null);
          if (isReceipt) later(() => receiveItem(item).catch(showError));
          else issuePlanItem(item);
        }} />
      <PlacePicker visible={placePick !== null} title="Куда разместить" onClose={() => setPlacePick(null)}
        onPick={(p) => {
          const cb = placePick;
          setPlacePick(null);
          cb?.(p);
        }} />
      <StockPicker visible={stockReq !== null} title={stockReq?.title} rows={stockReq?.rows}
        onClose={() => { setStockReq(null); setResume(false); }}
        onPick={(r) => {
          const cb = stockReq?.pick;
          setStockReq(null);
          cb?.(r);
        }} />
      <QtyPrompt visible={qtyReq !== null} title={qtyReq?.title ?? ''} unit={qtyReq?.unit} max={qtyReq?.max} initial={qtyReq?.initial}
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
        }} />
      <TextPrompt visible={textReq !== null} title={textReq?.title ?? ''} initial={textReq?.initial}
        onClose={() => setTextReq(null)}
        onSubmit={(t) => {
          const req = textReq;
          setTextReq(null);
          req?.submit(t);
        }} />
      <ActionMenu visible={menu !== null} title={menu?.title} subtitle={menu?.subtitle} actions={menu?.actions ?? []}
        onClose={() => setMenu(null)} />
    </View>
  );
}
