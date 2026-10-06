import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { ActionMenu, type MenuAction } from '../../components/ActionMenu';
import { Chips } from '../../components/Chips';
import { ItemPicker, QtyPrompt, StockPicker, TextPrompt } from '../../components/pickers';
import { Scanner, type ScanFeedback } from '../../components/Scanner';
import {
  Badge, Button, Card, Empty, Field, H1, ListRow, Muted, Section, colors, confirm, notify, s, showError, useFocusLoad,
} from '../../components/ui';
import { custodyQr, formatQty } from '../../core/codes';
import { BusinessError } from '../../core/db';
import {
  CONDITION_LABEL, CUSTODY_STATUS_LABEL, type DocLine, type Item, type ReturnCondition, type StockRow,
} from '../../core/types';
import { useApi, useBackend, usePerms } from '../../lib/backend';
import { CHECK_LABEL, receiptCheck, type CheckRow, type CheckStatus } from '../../core/receiptCheck';
import { DOC_SOURCE_LABEL, DOC_TITLES } from '../../lib/docs';
import { printLabels } from '../../lib/print';
import { documentForm } from '../../lib/docForms';
import { FormMenu, type FormJob } from '../../components/FormMenu';

type QtyReq = { title: string; unit?: string; max?: number; initial?: number; submit: (q: number) => Promise<void> };
type StockReq = { title: string; rows?: StockRow[]; pick: (r: StockRow) => void };
type Menu = { title: string; subtitle?: string; actions: MenuAction[] };

const CONDITIONS = Object.keys(CONDITION_LABEL) as ReturnCondition[];

/** Цвет позиции задания: меньше — красный, сошлось — зелёный, больше — жёлтый. */
const TONE: Record<CheckStatus, 'red' | 'green' | 'yellow'> = { short: 'red', ok: 'green', over: 'yellow', extra: 'yellow' };
const ROW_BG: Record<CheckStatus, { bg: string; fg: string; border: string }> = {
  short: { bg: '#FEE4E2', fg: '#B42318', border: '#F04438' },
  ok: { bg: '#DCFAE6', fg: '#067647', border: '#17B26A' },
  over: { bg: '#FEF0C7', fg: '#B54708', border: '#F79009' },
  extra: { bg: '#FEF0C7', fg: '#B54708', border: '#F79009' },
};

export default function DocumentScreen() {
  const api = useApi();
  const { user } = useBackend();
  const perms = usePerms();
  const id = Number(useLocalSearchParams<{ id: string }>().id);
  const [data, reload] = useFocusLoad(async () => {
    const doc = await api.getDocument(id);
    const [lines, warehouses, custody, plan] = await Promise.all([
      api.listLines(id),
      api.listWarehouses(),
      doc.type === 'issue' && doc.post_mode === 'custody' ? api.custodyByIssueDoc(id) : Promise.resolve([]),
      doc.type !== 'move' && doc.source !== 'return' ? api.docPlan(id) : Promise.resolve([]),
    ]);
    // задание на отбор: где лежит товар (FIFO по дате приёмки) — подсказка кладовщику
    const where = new Map<number, StockRow[]>();
    if (doc.type === 'issue' && doc.status === 'draft' && plan.length) {
      const rows = await Promise.all(plan.map((p) => api.stockByItem(p.item_id)));
      plan.forEach((p, i) => where.set(p.item_id, rows[i]));
    }
    return { doc, lines, warehouses, custody, plan, where };
  }, [api, id]);

  const [header, setHeader] = useState({ partner: '', recipient: '', comment: '' });
  const [busy, setBusy] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  // purpose: plan — добавить в задание на приёмку (план), иначе — принять / добавить в расход
  const [itemPick, setItemPick] = useState<{ barcode?: string; purpose?: 'plan' } | null>(null);
  const [qtyReq, setQtyReq] = useState<QtyReq | null>(null);
  const [stockReq, setStockReq] = useState<StockReq | null>(null);
  const [textReq, setTextReq] = useState<{ title: string; initial?: string; submit: (t: string) => void } | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [formJob, setFormJob] = useState<FormJob | null>(null);
  // Приход: каждый скан = +1 шт без запроса количества
  const [quick, setQuick] = useState(false);
  // Расход по факту: открытый (отсканированный) короб
  const [openBox, setOpenBox] = useState<{ id: number; code: string } | null>(null);
  const [resume, setResume] = useState(false);

  const doc = data?.doc;
  const lines = data?.lines ?? [];
  const warehouses = data?.warehouses ?? [];
  const plan = data?.plan ?? [];
  const check = plan.length ? receiptCheck(plan, lines) : null;

  useEffect(() => {
    if (doc) setHeader({ partner: doc.partner ?? '', recipient: doc.recipient ?? '', comment: doc.comment ?? '' });
  }, [doc?.id, doc?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // Кладовщик открыл свободное задание — оно закрепляется за ним, его ФИО попадает в ордер.
  useEffect(() => {
    if (doc && user && doc.status === 'draft' && doc.plan_count > 0 && !doc.assignee_id && user.role === 'storekeeper') {
      api.takeTask(id).then(reload).catch(() => reload());
    }
  }, [doc?.id, doc?.assignee_id]); // eslint-disable-line react-hooks/exhaustive-deps

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
  /** Задание на отбор: отбор сканированием, как по факту, со сверкой с заданием. */
  const isIssueTask = isIssue && plan.length > 0;
  const pickMode = isFact || isIssueTask;
  const verb = isIssue ? 'отобрано' : 'принято';
  const canEdit = draft && !isReturn && (perms.operate || doc.created_by === user.id);

  const later = (fn: () => void) => setTimeout(fn, Platform.OS === 'ios' ? 450 : 50);
  const openQty = (r: QtyReq) => later(() => setQtyReq(r));
  const openStock = (r: StockReq) => later(() => setStockReq(r));
  const openItem = (r: { barcode?: string; purpose?: 'plan' }) => later(() => setItemPick(r));
  const saveHeader = () => draft && !isReturn && api.updateDocumentHeader(id, header).catch(showError);

  const freeQty = (r: StockRow) =>
    r.qty - lines
      .filter((l) => l.item_id === r.item_id && (r.box_id ? l.box_id === r.box_id : !l.box_id && l.cell_id === r.cell_id))
      .reduce((a, l) => a + l.qty, 0);

  // ------------------------------------------------------------ приход

  /** Цветная отметка по товару после скана: сколько принято из задания. */
  async function feedbackFor(item: Item): Promise<ScanFeedback> {
    const [plan2, lines2] = await Promise.all([api.docPlan(id), api.listLines(id)]);
    const row = receiptCheck(plan2, lines2).rows.find((x) => x.item_id === item.id);
    if (!plan2.length || !row) return { ok: true, tone: 'green', text: `✓ ${item.name}: ${verb} ${formatQty(row?.fact ?? 0)} ${item.unit}` };
    const tone = TONE[row.status];
    if (row.status === 'extra') return { ok: true, tone, text: `${item.name}\nнет в задании · ${verb} ${formatQty(row.fact)} ${item.unit}` };
    const label = isIssue && row.status === 'short' ? 'не добрано' : CHECK_LABEL[row.status].toLowerCase();
    return { ok: true, tone, text: `${item.name}\n${formatQty(row.fact)} из ${formatQty(row.plan)} ${item.unit} — ${label}` };
  }

  /** Приёмка: всё принятое падает в буферную ячейку склада, раскладка — перемещением. */
  async function receiveItem(item: Item): Promise<ScanFeedback | void> {
    if (quick) {
      await api.addLine(id, { itemId: item.id, qty: 1 });
      reload();
      return feedbackFor(item);
    }
    const row = check?.rows.find((x) => x.item_id === item.id);
    openQty({
      title: `${item.name}\n→ буферная ячейка${row && row.plan ? `\nпо заданию ${formatQty(row.plan)}, принято ${formatQty(row.fact)}` : ''}`,
      unit: item.unit,
      submit: async (qty) => {
        await api.addLine(id, { itemId: item.id, qty });
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
    const row = check?.rows.find((x) => x.item_id === r.item_id);
    const remaining = row ? row.plan - row.fact : 0;
    openQty({
      title: `${r.item_name}\n← ${r.address ?? '—'}${r.box_code ? ' · ' + r.box_code : ''}${row?.plan ? `\nпо заданию ${formatQty(row.plan)}, отобрано ${formatQty(row.fact)}` : ''}`,
      unit: r.unit,
      max: free,
      initial: remaining > 0 ? Math.min(free, remaining) : 1,
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

  /** Быстрый отбор: 1 скан = 1 шт — из открытого короба, иначе из самой старой партии (FIFO). */
  async function quickPick(item: Item): Promise<ScanFeedback> {
    const rows = await api.stockByItem(item.id);
    const fresh = await api.listLines(id);
    const free = (r: StockRow) => r.qty - fresh
      .filter((l) => l.item_id === r.item_id && (r.box_id ? l.box_id === r.box_id : !l.box_id && l.cell_id === r.cell_id))
      .reduce((a, l) => a + l.qty, 0);
    const ordered = openBox ? [...rows.filter((r) => r.box_id === openBox.id), ...rows.filter((r) => r.box_id !== openBox.id)] : rows;
    const src = ordered.find((r) => free(r) >= 1);
    if (!src) return { ok: false, tone: 'red', text: `${item.name}\nнет свободного остатка на складе` };
    await api.addLine(id, { itemId: item.id, qty: 1, cellId: src.cell_id, boxId: src.box_id });
    reload();
    const fb = await feedbackFor(item);
    return { ...fb, text: `${fb.text}\n← ${src.address ?? '—'}${src.box_code ? ' · ' + src.box_code : ''}` };
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

  async function onScan(code: string): Promise<boolean | ScanFeedback> {
    const r = await api.resolveScan(code);
    if (r.type !== 'none') setResume(true);
    if (isReceipt) {
      if (r.type === 'cell' || r.type === 'box' || r.type === 'rack') {
        return { ok: false, tone: 'yellow', text: 'Место выбирать не нужно: товар принимается в буферную ячейку. Сканируйте ШК товара.' };
      }
      if (r.type === 'item') {
        if (quick) {
          return (await receiveItem(r.item)) ?? true; // сканер остаётся открытым — сканируйте дальше
        }
        setScanOpen(false);
        await receiveItem(r.item);
        return true;
      }
      if (!perms.manageItems) {
        return { ok: false, tone: 'red', text: `Код ${code} не найден в номенклатуре.\nСообщите руководителю — товар заводит он.` };
      }
      setScanOpen(false);
      if (perms.manageItems) {
        later(() => confirm('Неизвестный код', `${code}\nСоздать новый товар с этим штрихкодом?`, () => openItem({ barcode: code }), 'Создать'));
      }
      return true;
    }
    if (r.type === 'box') {
      if (pickMode && quick) {
        setOpenBox({ id: r.box.id, code: r.box.code });
        return { ok: true, tone: 'green', text: `Открыт короб ${r.box.code}\nсканируйте товар — он берётся из этого короба` };
      }
      const rows = await api.stockInBox(r.box.id);
      setScanOpen(false);
      setOpenBox({ id: r.box.id, code: r.box.code });
      if (!rows.length) notify('Короб пуст', r.box.code);
      else openStock({ title: `Короб ${r.box.code}: что изымаем?`, rows, pick: issueFromRow });
      return true;
    }
    if (r.type === 'rack') {
      const rows = await api.stockInRack(r.rack.id);
      setScanOpen(false);
      if (!rows.length) notify('Стеллаж пуст', r.rack.code);
      else openStock({ title: `Стеллаж ${r.rack.code}: что изымаем?`, rows, pick: issueFromRow });
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
      if (pickMode && quick) return quickPick(r.item); // сканер остаётся открытым
      setScanOpen(false);
      if (pickMode) await issueFactItem(r.item);
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
        ...(isReceipt ? [] : [{
          label: 'Взять из другого места',
          onPress: async () => {
            {
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
        }]),
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

  const doPostReceipt = () => run(() => api.postReceipt(id),
    `${doc.number}: ${isReturn ? 'ТМЦ приняты на склад (буферная ячейка), отметки сохранены' : 'товар принят в буферную ячейку, разложите его перемещением'}`);
  const postReceipt = () => {
    if (!check || check.matched) return doPostReceipt();
    const list = check.rows.filter((x) => x.status !== 'ok').slice(0, 8)
      .map((x) => `${x.item_name}: ${formatQty(x.fact)} из ${formatQty(x.plan)} (${CHECK_LABEL[x.status].toLowerCase()})`).join('\n');
    confirm('Есть расхождения с заданием',
      `Недостача: ${check.short}, излишек: ${check.over}, нет в задании: ${check.extra}\n\n${list}\n\nПровести по факту отсканированного?`,
      doPostReceipt, 'Провести по факту');
  };

  /** Действия по позиции задания на приёмку. */
  function planActions(row: CheckRow) {
    if (!canEdit) return;
    const item = { id: row.item_id, name: row.item_name, unit: row.unit } as Item;
    const planEdits = [
      ...(perms.operate ? [{
        label: 'Изменить количество в задании',
        onPress: () => openQty({ title: `${row.item_name}\nпо заданию`, unit: row.unit, initial: row.plan || row.fact,
          submit: (qty) => api.setPlanQty(id, row.item_id, qty) }),
      }] : []),
      ...(perms.operate && row.plan > 0 ? [{ label: 'Убрать из задания', danger: true,
        onPress: () => api.setPlanQty(id, row.item_id, 0).then(reload).catch(showError) }] : []),
    ];
    if (isIssue) {
      return setMenu({
        title: row.item_name,
        subtitle: `${row.sku} · отобрано ${formatQty(row.fact)} из ${formatQty(row.plan)} ${row.unit}`,
        actions: [
          { label: 'Отобрать: выбрать место', onPress: () => { setResume(false); issueFactItem(item).catch(showError); } },
          ...(row.fact > 0 ? [{ label: 'Сбросить отобранное', danger: true,
            onPress: () => api.setFactQty(id, row.item_id, 0).then(reload).catch(showError) }] : []),
          ...planEdits,
        ],
      });
    }
    setMenu({
      title: row.item_name,
      subtitle: `${row.sku} · принято ${formatQty(row.fact)} из ${formatQty(row.plan)} ${row.unit}`,
      actions: [
        {
          label: 'Добавить количество',
          onPress: () => { setResume(false); openQty({ title: `${row.item_name}\n→ буферная ячейка`, unit: row.unit,
            submit: async (qty) => { await api.addLine(id, { itemId: item.id, qty }); } }); },
        },
        {
          label: 'Принято всего: указать количество',
          onPress: () => openQty({ title: `${row.item_name}\nпринято всего`, unit: row.unit, initial: row.fact || row.plan,
            submit: (qty) => api.setFactQty(id, row.item_id, qty) }),
        },
        ...(row.plan > 0 && row.fact !== row.plan ? [{ label: `Принять по заданию (${formatQty(row.plan)})`,
          onPress: () => api.setFactQty(id, row.item_id, row.plan).then(reload).catch(showError) }] : []),
        ...(row.fact > 0 ? [{ label: 'Обнулить принятое', danger: true,
          onPress: () => api.setFactQty(id, row.item_id, 0).then(reload).catch(showError) }] : []),
        ...(perms.operate ? [{
          label: 'Изменить количество в задании',
          onPress: () => openQty({ title: `${row.item_name}\nожидается по заданию`, unit: row.unit, initial: row.plan || row.fact,
            submit: (qty) => api.setPlanQty(id, row.item_id, qty) }),
        }] : []),
        ...(perms.operate && row.plan > 0 ? [{ label: 'Убрать из задания', danger: true,
          onPress: () => api.setPlanQty(id, row.item_id, 0).then(reload).catch(showError) }] : []),
      ],
    });
  }

  const postedNote = 'Документ сохранён: «Ещё → Документы → Проведённые».';
  const writeOff = () => confirm('Провести расходный ордер?',
    'Товар будет отпущен со склада (списан с остатков) в количестве, указанном в ордере.',
    () => run(() => api.postIssue(id, 'writeoff'), `${doc.number} проведён.\n${postedNote}`), 'Провести');

  /** «Провести»: если включена выдача под ответственность — выбор, как провести. */
  const postIssue = () => {
    if (check && !check.matched) {
      const list = check.rows.filter((x) => x.status !== 'ok').slice(0, 8)
        .map((x) => `${x.item_name}: ${formatQty(x.fact)} из ${formatQty(x.plan)} (${CHECK_LABEL[x.status].toLowerCase()})`).join('\n');
      return confirm('Отобрано не по заданию', `${list}\n\nПровести по факту отобранного?`, postIssueChecked, 'Продолжить');
    }
    postIssueChecked();
  };
  const postIssueChecked = () => {
    if (!perms.operate) return giveOut();
    if (!perms.custody) return writeOff();
    setMenu({
      title: `Провести ${doc.number}`,
      subtitle: 'Как провести расходный ордер?',
      actions: [
        { label: 'Отпуск со склада (списать с остатков)', onPress: writeOff },
        { label: 'Выдать под ответственность (числится на получателях)', onPress: giveOut },
      ],
    });
  };

  const giveOut = () => {
    if (!perms.operate) {
      return confirm('Взять ТМЦ на себя?', 'ТМЦ будут числиться на вас до возврата.',
        () => run(() => api.postIssue(id, 'custody'), `ТМЦ записаны на вас.\n${postedNote}`), 'Взять');
    }
    saveHeader();
    router.push({ pathname: '/doc/allocate', params: { id: String(id) } });
  };

  const total = lines.reduce((a, l) => a + l.qty, 0);
  const subtitle = isReturn ? `возврат по ${doc.base_doc_number}` : DOC_SOURCE_LABEL[doc.source] ?? '';
  const modeLabel = doc.post_mode === 'custody' ? 'выдано под ответственность' : doc.post_mode === 'writeoff' ? 'отпущено со склада' : '';
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
              <H1>{DOC_TITLES[doc.type]}{isReceipt && (plan.length || doc.mode === 'plan') ? ' · задание на приёмку' : ''}</H1>
              <Muted>№ {doc.number} от {doc.doc_date.slice(0, 16)}{subtitle ? ` · ${subtitle}` : ''}</Muted>
              <Muted>Составил: {doc.created_by_name}</Muted>
              {doc.assignee_name ? <Text style={{ color: colors.text, fontWeight: '600', marginTop: 2 }}>
                {isIssue ? 'Отбирает' : 'Принимает'}: {doc.assignee_name}{doc.assignee_id === user.id ? ' (вы)' : ''}
              </Text> : null}
              {doc.posted_at ? <Muted>Провёл: {doc.posted_by_name}, {doc.posted_at}{modeLabel ? ` · ${modeLabel}` : ''}</Muted> : null}
              {doc.warehouse_name ? <Muted>Склад: {doc.warehouse_name}</Muted> : null}
            </View>
            <Badge text={draft ? 'черновик' : modeLabel || 'проведён'} tone={draft ? 'warn' : 'success'} />
          </View>
          {draft && perms.operate && plan.length ? (
            <View style={s.rowWrap}>
              {doc.assignee_id !== user.id ? (
                <Button title={doc.assignee_id ? 'Забрать задание себе' : 'Взять в работу'} variant="secondary" style={{ flex: 1 }}
                  onPress={() => api.takeTask(id, true).then(reload).catch(showError)} />
              ) : null}
              {doc.assignee_id && (doc.assignee_id === user.id || perms.manageUsers) ? (
                <Button title="Вернуть в общий пул" variant="ghost" style={{ flex: 1 }}
                  onPress={() => api.releaseTask(id).then(() => (doc.assignee_id === user.id ? router.back() : reload())).catch(showError)} />
              ) : null}
            </View>
          ) : null}
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
              <Field label="Кому / куда (получатель или объект)" value={header.recipient} editable={canEdit}
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
            <Text style={{ color: colors.text }}>Весь принятый товар попадает в <Text style={{ fontWeight: '700' }}>буферную ячейку</Text> склада — разложите его потом перемещением (ТСД или ПК).</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
              <Text style={{ color: colors.text, flex: 1 }}>Быстрый режим: 1 скан = +1 шт</Text>
              <Switch value={quick} onValueChange={setQuick} />
            </View>
          </Card>
        ) : null}

        {canEdit && isIssueTask ? (
          <Card style={{ backgroundColor: colors.warnSoft }}>
            <Text style={{ color: colors.text }}>Сканируйте ШК товара (или QR короба / ячейки, откуда берёте). Подсказка «где взять» — самые старые партии (FIFO).</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
              <Text style={{ color: colors.text, flex: 1 }}>Быстрый режим: 1 скан = 1 шт</Text>
              <Switch value={quick} onValueChange={setQuick} />
            </View>
          </Card>
        ) : null}

        {check ? (
          <Section title={`${isIssue ? 'Задание на отбор' : 'Задание на приёмку'} · ${verb} ${formatQty(check.fact)} из ${formatQty(check.plan)}`}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              <Badge text={`Сошлось: ${check.ok}`} tone="success" />
              <Badge text={`Недостача: ${check.short}`} tone="danger" />
              <Badge text={`Излишек: ${check.over + check.extra}`} tone="warn" />
            </View>
            <View style={{ borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: colors.border }}>
              {check.rows.map((row) => {
                const c = ROW_BG[row.status];
                return (
                  <Pressable key={row.item_id} disabled={!canEdit} onPress={() => planActions(row)}
                    style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', padding: 12, backgroundColor: c.bg,
                      borderLeftWidth: 6, borderLeftColor: c.border, borderBottomWidth: 1, borderBottomColor: '#fff' }, pressed && { opacity: 0.8 }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 15, fontWeight: '600', color: colors.text }}>{row.item_name}</Text>
                      <Text style={{ fontSize: 12, color: colors.muted }}>{row.sku}{row.barcode ? ` · ШК ${row.barcode}` : ''}</Text>
                      <Text style={{ fontSize: 12, color: c.fg, fontWeight: '600' }}>
                        {isIssue && row.status === 'short' ? 'Не добрано' : CHECK_LABEL[row.status]}{row.status === 'short' ? ` ${formatQty(-row.diff)}` : row.status === 'over' ? ` +${formatQty(row.diff)}` : ''}
                      </Text>
                      {isIssue && draft && row.status === 'short' ? (
                        <Text style={{ fontSize: 12, color: colors.text, marginTop: 2 }}>
                          {(data.where.get(row.item_id) ?? []).length
                            ? 'Где взять: ' + (data.where.get(row.item_id) ?? []).slice(0, 3)
                              .map((w) => `${w.address ?? '—'}${w.box_code ? ' · ' + w.box_code : ''} (${formatQty(w.qty)})`).join('; ')
                            : 'Нет на складе'}
                        </Text>
                      ) : null}
                    </View>
                    <Text style={{ fontSize: 18, fontWeight: '700', color: c.fg }}>
                      {formatQty(row.fact)}<Text style={{ fontSize: 13, color: colors.muted }}> / {formatQty(row.plan)} {row.unit}</Text>
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </Section>
        ) : null}

        {canEdit && pickMode && openBox ? (
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

        {check && !isIssue ? null : <Section title={`${isIssueTask ? 'Отобрано (откуда)' : 'Строки'} · ${lines.length} поз. · ${formatQty(total)} ед.`}>
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
            )) : <Empty text={pickMode ? 'Отсканируйте короб, ячейку или товар' : isReceipt ? 'Отсканируйте ШК товара или добавьте товар' : 'Добавьте товары'} />}
          </View>
        </Section>}

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
            {pickMode || !perms.operate ? (
              <Button title="Выбрать из остатков" variant="secondary" icon="≣"
                onPress={() => { setResume(false); openStock({ title: 'Что берём?', pick: issueFromRow }); }} />
            ) : (
              <Button title={isReceipt ? 'Принять товар из списка (количеством)' : 'Добавить товар из списка'} variant="secondary" icon="+"
                onPress={() => { setResume(false); openItem({}); }} />
            )}
            {perms.operate && (isReceipt || (isIssue && (plan.length > 0 || doc.mode === 'plan'))) ? (
              <Button title={isIssue ? 'Добавить позицию в задание на отбор' : 'Добавить позицию в задание на приёмку'} variant="secondary" icon="☰"
                onPress={() => { setResume(false); openItem({ purpose: 'plan' }); }} />
            ) : null}
            {check && check.rows.some((x) => x.status === 'short') ? (
              <Button title={isIssue ? 'Подобрать всё автоматически (FIFO, без сканирования)' : 'Принять всё по заданию (без сканирования)'}
                variant="secondary" icon="✓"
                onPress={() => confirm(isIssue ? 'Подобрать всё по заданию?' : 'Принять всё по заданию?',
                  isIssue ? 'Недостающее количество будет взято из самых старых партий.' : 'Недостающее количество будет записано как принятое.',
                  () => api.fillFromPlan(id).then((res) => {
                    reload();
                    if (res.shortage > 0) notify('Не хватает на складе', `Не хватило ${formatQty(res.shortage)} ед.`);
                  }).catch(showError), isIssue ? 'Подобрать' : 'Принять')} />
            ) : null}
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

        <Button title={isIssue && draft ? 'Печать ордера / лист подбора' : 'Печать документа'} icon="⎙" variant="secondary"
          disabled={!lines.length && !plan.length} onPress={() => setFormJob({
            title: `${DOC_TITLES[doc.type]} № ${doc.number}`,
            subtitle: 'Печатная форма A4 по образцу 1С',
            variants: [{
              build: async (ctx) => documentForm(doc, lines, ctx, isIssue ? {
                plan,
                custody: data?.custody,
                allocations: !data?.custody?.length ? await api.listAllocations(id) : undefined,
              } : { plan }),
            }],
          })} />
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
          {isIssue && (perms.operate || perms.custody) ? (
            <Button title={perms.operate ? 'Провести' : 'Взять себе'} variant="success" style={{ flex: 1 }} busy={busy}
              disabled={!lines.length} onPress={postIssue} />
          ) : null}
        </View>
      ) : null}

      <Scanner
        visible={scanOpen}
        onClose={() => setScanOpen(false)}
        onScan={onScan}
        title={isReceipt ? 'Приёмка' : 'Изъятие'}
        hint={isReceipt
          ? `ШК товара / коробки — ${quick ? '+1 шт за скан' : 'принять с количеством'} · всё в буферную ячейку`
          : pickMode
            ? quick
              ? 'Быстрый отбор: ШК товара = 1 шт (из открытого короба или самой старой партии); QR короба — открыть короб'
              : 'QR короба или ячейки — содержимое; ШК/QR товара — изъять (короб сканировать не обязательно)'
            : 'ШК/QR товара — добавить в заявку'}
      />
      <ItemPicker visible={itemPick !== null} newBarcode={itemPick?.barcode} allowCreate={isReceipt && perms.manageItems}
        onClose={() => setItemPick(null)}
        onPick={(item) => {
          const purpose = itemPick?.purpose;
          setItemPick(null);
          if (purpose === 'plan') {
            const row = check?.rows.find((x) => x.item_id === item.id);
            openQty({ title: `${item.name}\nожидается по заданию`, unit: item.unit, initial: row?.plan || undefined,
              submit: (qty) => api.setPlanQty(id, item.id, qty) });
          } else if (isReceipt) later(() => { receiveItem(item).catch(showError); });
          else issuePlanItem(item);
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
      <FormMenu job={formJob} onClose={() => setFormJob(null)} />
      <ActionMenu visible={menu !== null} title={menu?.title} subtitle={menu?.subtitle} actions={menu?.actions ?? []}
        onClose={() => setMenu(null)} />
    </View>
  );
}
