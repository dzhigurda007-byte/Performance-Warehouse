import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Chips } from '../components/Chips';
import { Button, Card, Field, Muted, colors, notify, s, showError, useFocusLoad } from '../components/ui';
import { formatQty } from '../core/codes';
import { CONDITION_LABEL, CONDITION_NOT_ACCEPTED, type ReturnCondition } from '../core/types';
import { useApi } from '../lib/backend';

const CONDITIONS = Object.keys(CONDITION_LABEL) as ReturnCondition[];

/**
 * Возврат ТМЦ на склад. К каждой позиции — отметка из стандартного списка
 * (по умолчанию «Без повреждений») и необязательный комментарий.
 */
export default function ReturnScreen() {
  const api = useApi();
  const ids = (useLocalSearchParams<{ ids: string }>().ids ?? '').split(',').map(Number).filter(Boolean);
  const [rows] = useFocusLoad(() => Promise.all(ids.map((i) => api.getCustody(i))), [api, ids.join(',')]);
  const [cond, setCond] = useState<Record<number, ReturnCondition>>({});
  const [comment, setComment] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (rows) setCond(Object.fromEntries(rows.map((k) => [k.id, 'ok' as ReturnCondition])));
  }, [rows]);

  async function submit() {
    setBusy(true);
    try {
      const res = await api.returnCustody(ids.map((i) => ({ custodyId: i, condition: cond[i] ?? 'ok', comment: comment[i] })));
      notify('Возврат оформлен', res.receipts.length
        ? 'Все ТМЦ по выдаче возвращены — сформирован приходный ордер. Его проведёт выдавший или его руководитель.'
        : 'Факт возврата отображается у выдавшего. Приходный ордер сформируется, когда вернут все ТМЦ по выдаче.');
      router.back();
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  }

  if (!rows) return null;
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <Muted>Возвращается позиций: {rows.length}. Отметьте состояние каждой.</Muted>
      {rows.map((k) => (
        <Card key={k.id}>
          <Text style={{ fontWeight: '700', fontSize: 16, color: colors.text }}>{k.item_name} · {formatQty(k.qty)} {k.unit}</Text>
          <Muted>{k.code} · на руках у {k.holder_name} с {k.issued_at.slice(0, 10)}</Muted>
          <View style={{ height: 8 }} />
          <Chips value={cond[k.id] ?? 'ok'} onChange={(c) => setCond({ ...cond, [k.id]: c })}
            options={CONDITIONS.map((c) => ({ value: c, label: CONDITION_LABEL[c] }))} />
          {CONDITION_NOT_ACCEPTED.includes(cond[k.id] ?? 'ok') ? (
            <Text style={{ color: colors.danger, marginBottom: 6 }}>Не вернётся в остатки — будет списано</Text>
          ) : null}
          <Field label="Комментарий" value={comment[k.id] ?? ''} placeholder="необязательно"
            onChangeText={(t) => setComment({ ...comment, [k.id]: t })} />
        </Card>
      ))}
      <Button title={`Вернуть на склад (${rows.length})`} variant="success" busy={busy} onPress={submit} />
    </ScrollView>
  );
}
