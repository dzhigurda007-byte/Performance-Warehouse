import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { Chips } from '../../../components/Chips';
import { Badge, Button, Empty, Muted, SearchBox, colors, s, showError, useFocusLoad } from '../../../components/ui';
import { formatQty } from '../../../core/codes';
import { ruDate } from '../../core/forms';
import { ORDER_TITLE, orders, type OrderType } from '../../core/service';
import { useDb } from '../../lib/db';

type TypeF = 'all' | OrderType;
type StatusF = 'all' | 'draft' | 'posted';

/** Приходные и расходные ордера. */
export default function OrdersTab() {
  const db = useDb();
  const [type, setType] = useState<TypeF>('all');
  const [status, setStatus] = useState<StatusF>('all');
  const [q, setQ] = useState('');
  const [list] = useFocusLoad(() => orders.list(db, {
    type: type === 'all' ? undefined : type, status: status === 'all' ? undefined : status, search: q,
  }), [db, type, status, q]);

  async function create(t: OrderType) {
    try {
      const id = await orders.create(db, t);
      router.push({ pathname: '/order/[id]', params: { id: String(id) } });
    } catch (e) {
      showError(e);
    }
  }

  return (
    <View style={s.screen}>
      <FlatList
        contentContainerStyle={s.content}
        data={list ?? []}
        keyExtractor={(o) => String(o.id)}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View>
            <View style={s.rowWrap}>
              <Button title="Приход" icon="↓" variant="success" style={{ flex: 1 }} onPress={() => create('receipt')} />
              <Button title="Расход" icon="↑" variant="danger" style={{ flex: 1 }} onPress={() => create('issue')} />
            </View>
            <SearchBox value={q} onChangeText={setQ} placeholder="Номер, поставщик / получатель" />
            <Chips value={type} onChange={setType} options={[
              { value: 'all' as TypeF, label: 'Все' },
              { value: 'receipt' as TypeF, label: '↓ Приходные' },
              { value: 'issue' as TypeF, label: '↑ Расходные' },
            ]} />
            <Chips value={status} onChange={setStatus} options={[
              { value: 'all' as StatusF, label: 'Любые' },
              { value: 'draft' as StatusF, label: 'Черновики' },
              { value: 'posted' as StatusF, label: 'Проведённые' },
            ]} />
          </View>
        }
        ListEmptyComponent={list ? <Empty text="Ордеров нет" /> : null}
        renderItem={({ item: o }) => {
          const isR = o.type === 'receipt';
          return (
            <Pressable onPress={() => router.push({ pathname: '/order/[id]', params: { id: String(o.id) } })}
              style={({ pressed }) => [s.card, { marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 10 }, pressed && { opacity: 0.8 }]}>
              <Text style={{ fontSize: 24, color: isR ? colors.success : colors.danger }}>{isR ? '↓' : '↑'}</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text }}>{ORDER_TITLE[o.type]} {o.number}</Text>
                <Muted>{ruDate(o.doc_date, true)}{o.partner ? ` · ${o.partner}` : ''}</Muted>
                <Muted>{o.lines} поз. · {formatQty(o.total)} шт.</Muted>
              </View>
              <Badge text={o.status === 'posted' ? 'проведён' : 'черновик'} tone={o.status === 'posted' ? 'success' : 'warn'} />
            </Pressable>
          );
        }}
      />
    </View>
  );
}
