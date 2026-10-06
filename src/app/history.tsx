import { router } from 'expo-router';
import { useApi } from '../lib/backend';
import { useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { Chips } from '../components/Chips';
import { Empty, ListRow, SearchBox, colors, s, useFocusLoad } from '../components/ui';
import { formatQty } from '../core/codes';

/** Журнал движений ТМЦ: кто, когда, что и откуда взял / куда положил. */
export default function HistoryScreen() {
  const api = useApi();
  const [q, setQ] = useState('');
  const [direction, setDirection] = useState<'in' | 'out' | undefined>('out');
  const [userId, setUserId] = useState<number | undefined>(undefined);
  const [users] = useFocusLoad(() => api.listUsers(), [api]);
  const [moves] = useFocusLoad(() => api.listMoves({ search: q, direction, userId }), [api, q, direction, userId]);

  return (
    <View style={[s.screen, { padding: 16 }]}>
      <SearchBox value={q} onChangeText={setQ} placeholder="Товар, получатель, сотрудник, № документа" />
      <Chips value={direction} onChange={setDirection} options={[
        { value: 'out', label: 'Выдача' },
        { value: 'in', label: 'Поступление' },
        { value: undefined, label: 'Все движения' },
      ]} />
      <Chips value={userId} onChange={setUserId} options={[
        { value: undefined, label: 'Все сотрудники' },
        ...(users ?? []).map((u) => ({ value: u.id as number | undefined, label: u.full_name })),
      ]} />
      <FlatList
        style={{ flex: 1, borderRadius: 12 }}
        data={moves ?? []}
        keyExtractor={(m) => String(m.id)}
        ListEmptyComponent={<Empty text="Нет движений" />}
        renderItem={({ item: m }) => (
          <ListRow
            title={`${m.item_name} · ${m.qty > 0 ? '+' : ''}${formatQty(m.qty)} ${m.unit}`}
            subtitle={[
              m.created_at,
              `оформил: ${m.user_name}`,
              m.recipient ? `получил: ${m.recipient}` : null,
              `${m.address ?? '—'}${m.box_code ? ' · ' + m.box_code : ''}`,
            ].filter(Boolean).join('\n')}
            right={<View style={{ alignItems: 'flex-end' }}>
              <ListBadge text={m.doc_number ?? ''} out={m.qty < 0} />
            </View>}
            onPress={m.doc_id ? () => router.push({ pathname: '/doc/[id]', params: { id: String(m.doc_id) } }) : undefined}
          />
        )}
      />
    </View>
  );
}

function ListBadge({ text, out }: { text: string; out: boolean }) {
  return <Text style={{ color: out ? colors.danger : colors.success, fontWeight: '600', fontSize: 12 }}>{text}</Text>;
}
