import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Scanner, type ScanFeedback } from '../../components/Scanner';
import { Button, Card, Empty, Field, ListRow, Muted, colors, notify, s, showError } from '../../components/ui';
import { formatQty } from '../../core/codes';
import { round3 } from '../../core/db';
import { CellPicker, QtyModal } from '../components/pickers';
import { CELL_QR_PREFIX, cells, items, moveMany, type Cell } from '../core/service';
import { useDb } from '../lib/db';

interface Content { item_id: number; article: string; name: string; spp: string | null; unit: string; qty: number }
interface Line extends Content { move: number }

/**
 * Перемещение между ячейками: скан ячейки «откуда» → сканы товаров → скан ячейки «куда».
 * То же можно сделать вручную: выбрать ячейки из списка и товары из содержимого ячейки.
 * Несколько разных товаров — одним перемещением.
 */
export default function MoveScreen() {
  const db = useDb();
  const params = useLocalSearchParams<{ from?: string }>();
  const [from, setFrom] = useState<Cell | null>(null);
  const [to, setTo] = useState<Cell | null>(null);
  const [content, setContent] = useState<Content[]>([]);
  const [cart, setCart] = useState<Line[]>([]);
  const [comment, setComment] = useState('');
  const [scan, setScan] = useState(false);
  const [pick, setPick] = useState<'from' | 'to' | null>(null);
  const [qtyFor, setQtyFor] = useState<Content | Line | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const id = Number(params.from);
    if (id) cells.get(db, id).then((c) => c && chooseFrom(c)).catch(showError);
  }, [db, params.from]); // eslint-disable-line react-hooks/exhaustive-deps

  async function chooseFrom(c: Cell) {
    const list = await cells.contents(db, c.id);
    setFrom(c);
    setContent(list);
    setCart([]);
    if (to?.id === c.id) setTo(null);
    return list;
  }

  /** Добавить в перемещение; возвращает новую строку или текст ошибки. */
  function addToCart(c: Content, qty: number, replace = false): Line | string {
    const cur = cart.find((l) => l.item_id === c.item_id);
    const next = round3(replace ? qty : (cur?.move ?? 0) + qty);
    if (next > c.qty) return `В ячейке ${from?.code} только ${formatQty(c.qty)} ${c.unit} «${c.name}»`;
    const line: Line = { ...c, move: next };
    setCart((l) => (next <= 0 ? l.filter((x) => x.item_id !== c.item_id)
      : cur ? l.map((x) => (x.item_id === c.item_id ? line : x)) : [...l, line]));
    return line;
  }

  async function finish(dest: Cell, lines = cart): Promise<string> {
    if (!from) throw new Error('Не выбрана ячейка «откуда»');
    if (dest.id === from.id) throw new Error('Ячейка «куда» совпадает с ячейкой «откуда»');
    await moveMany(db, { fromCellId: from.id, toCellId: dest.id, lines: lines.map((l) => ({ itemId: l.item_id, qty: l.move })), comment });
    const text = `Перемещено ${lines.length} поз. (${formatQty(lines.reduce((a, l) => a + l.move, 0))} шт.): ${from.code} → ${dest.code}`;
    setFrom(null);
    setTo(null);
    setCart([]);
    setContent([]);
    setComment('');
    return text;
  }

  async function onScan(code: string): Promise<ScanFeedback> {
    const asCell = async () => cells.findByCode(db, code);
    // 1. ячейка «откуда»
    if (!from) {
      const c = await asCell();
      if (!c) return { ok: false, tone: 'red', text: `Сначала отсканируйте ячейку «откуда». ${code} — не ячейка` };
      const list = await chooseFrom(c);
      return list.length
        ? { ok: true, tone: 'green', text: `Откуда: ${c.code} (${list.length} поз.). Сканируйте товар` }
        : { ok: false, tone: 'yellow', text: `Ячейка ${c.code} пустая — отсканируйте другую` };
    }
    // 2. товары; 3. ячейка «куда» завершает перемещение
    const item = code.startsWith(CELL_QR_PREFIX) ? null : await items.findByCode(db, code);
    if (item) {
      const c = content.find((x) => x.item_id === item.id);
      if (!c) return { ok: false, tone: 'red', text: `«${item.name}» нет в ячейке ${from.code}` };
      const r = addToCart(c, 1);
      if (typeof r === 'string') return { ok: false, tone: 'red', text: r };
      return { ok: true, tone: r.move === c.qty ? 'green' : 'yellow', text: `${c.name}: ${formatQty(r.move)} из ${formatQty(c.qty)}. Ещё товар или ячейка «куда»` };
    }
    const dest = await asCell();
    if (!dest) return { ok: false, tone: 'red', text: `Код ${code} не найден ни среди товаров, ни среди ячеек` };
    if (!cart.length) {
      if (dest.id === from.id) return { ok: false, tone: 'yellow', text: `Это та же ячейка ${from.code}. Сканируйте товар` };
      const list = await chooseFrom(dest);
      return { ok: true, tone: 'yellow', text: `Товар не выбран — «откуда» теперь ${dest.code} (${list.length} поз.)` };
    }
    try {
      return { ok: true, tone: 'green', text: `✓ ${await finish(dest)}. Следующее: ячейка «откуда»` };
    } catch (e) {
      return { ok: false, tone: 'red', text: e instanceof Error ? e.message : String(e) };
    }
  }

  async function doMove() {
    if (!to) return;
    setBusy(true);
    try {
      notify('Готово', await finish(to));
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  }

  const step = !from ? 1 : !cart.length ? 2 : !to ? 3 : 4;
  const hint = ['', 'Отсканируйте ячейку «откуда»', 'Отсканируйте товар (каждый скан +1 шт.)',
    'Ещё товары или ячейка «куда» — перемещение сразу выполнится', 'Нажмите «Переместить»'][step];

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <Button title="Сканировать" icon="⌖" onPress={() => setScan(true)} />
      <Muted>{hint}</Muted>

      <Card style={{ marginTop: 10 }}>
        <Text style={st(step === 1)}>1. Откуда</Text>
        <Button title={from ? `Ячейка ${from.code}` : 'Выбрать ячейку'} variant={from ? 'secondary' : 'ghost'} onPress={() => setPick('from')} />
      </Card>

      <Card>
        <Text style={st(step === 2)}>2. Что переместить · {cart.length}</Text>
        {cart.map((l) => (
          <View key={l.item_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderBottomWidth: 1, borderColor: colors.border }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '600', color: colors.text }}>{l.name}</Text>
              <Muted>Арт. {l.article}{l.spp ? ` · SPP ${l.spp}` : ''} · в ячейке {formatQty(l.qty)}</Muted>
            </View>
            <Pressable onPress={() => setQtyFor(l)}>
              <Text style={{ fontSize: 20, fontWeight: '800', color: l.move === l.qty ? colors.success : colors.warn }}>{formatQty(l.move)}</Text>
            </Pressable>
            <Pressable onPress={() => addToCart(l, 0, true)} hitSlop={8}><Text style={{ color: colors.danger, fontSize: 18 }}>✕</Text></Pressable>
          </View>
        ))}
        {from ? (
          <>
            <Text style={[s.label, { marginTop: 8 }]}>В ячейке {from.code} — нажмите, чтобы добавить</Text>
            <View style={{ borderRadius: 10, overflow: 'hidden' }}>
              {content.length ? content.map((c) => (
                <ListRow key={c.item_id} title={c.name} subtitle={`Арт. ${c.article}${c.spp ? ` · SPP ${c.spp}` : ''}`}
                  right={`${formatQty(c.qty)} ${c.unit}`} onPress={() => setQtyFor(c)} />
              )) : <Empty text="Ячейка пустая" />}
            </View>
          </>
        ) : <Muted>Сначала выберите ячейку «откуда»</Muted>}
      </Card>

      <Card>
        <Text style={st(step === 3)}>3. Куда</Text>
        <Button title={to ? `Ячейка ${to.code}` : 'Выбрать ячейку'} variant={to ? 'secondary' : 'ghost'} disabled={!from} onPress={() => setPick('to')} />
        <Field label="Комментарий" value={comment} onChangeText={setComment} placeholder="необяз." />
      </Card>

      <Button title="Переместить" icon="⇄" variant="success" busy={busy} disabled={!from || !to || !cart.length} onPress={doMove} />

      <Scanner visible={scan} title="Перемещение" hint={hint} onClose={() => setScan(false)} onScan={onScan} />
      <CellPicker visible={pick !== null} title={pick === 'from' ? 'Откуда' : 'Куда'} onClose={() => setPick(null)}
        onPick={(c) => {
          const which = pick;
          setPick(null);
          if (which === 'from') chooseFrom(c).catch(showError);
          else if (c.id === from?.id) notify('Та же ячейка', 'Выберите другую ячейку «куда»');
          else setTo(c);
        }} />
      <QtyModal visible={!!qtyFor} title={qtyFor?.name ?? ''} subtitle={qtyFor ? `Сколько переместить? В ячейке ${formatQty(qtyFor.qty)} ${qtyFor.unit}` : ''}
        initial={qtyFor ? formatQty('move' in qtyFor ? qtyFor.move : qtyFor.qty) : '1'} allowZero
        onClose={() => setQtyFor(null)}
        onSubmit={(n) => {
          const c = qtyFor!;
          setQtyFor(null);
          const r = addToCart(c, n, true);
          if (typeof r === 'string') notify('Больше, чем есть', r);
        }} />
    </ScrollView>
  );
}

const st = (active: boolean) => ({ fontSize: 16, fontWeight: '700' as const, color: active ? colors.primary : colors.text, marginBottom: 6 });
