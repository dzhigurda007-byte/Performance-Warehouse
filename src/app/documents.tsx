import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { FlatList, View } from 'react-native';
import { Chips } from '../components/Chips';
import { Badge, Button, Empty, ListRow, s, useFocusLoad } from '../components/ui';
import type { DocumentRow } from '../core/types';
import { useApi, usePerms } from '../lib/backend';
import { DOC_SOURCE_LABEL, DOC_TITLES, docSubtitle } from '../lib/docs';

type Filter = 'all' | 'drafts' | 'posted' | 'receipt' | 'issue' | 'returns' | 'move';

const QUERY: Record<Filter, Parameters<ReturnType<typeof useApi>['listDocuments']>[0]> = {
  all: {},
  drafts: { status: 'draft' },
  posted: { status: 'posted' },
  receipt: { type: 'receipt' },
  issue: { type: 'issue' },
  returns: { source: 'return' },
  move: { type: 'move' },
};

function statusBadge(d: DocumentRow) {
  if (d.status === 'draft') return <Badge text="черновик" tone="warn" />;
  if (d.post_mode === 'custody') return <Badge text="выдано" tone="primary" />;
  if (d.post_mode === 'writeoff') return <Badge text="проведён" tone="success" />;
  return <Badge text="проведён" tone="success" />;
}

export default function DocsScreen() {
  const api = useApi();
  const p = usePerms();
  const initial = (useLocalSearchParams<{ filter?: Filter }>().filter ?? 'all') as Filter;
  const [filter, setFilter] = useState<Filter>(initial in QUERY ? initial : 'all');
  const [docs] = useFocusLoad(() => api.listDocuments(QUERY[filter]), [api, filter]);

  return (
    <View style={[s.screen, { padding: 16 }]}>
      {p.operate ? (
        <Button title="Приходный ордер из Excel (Артикул · Наименование · Количество)" icon="⊞" variant="secondary"
          onPress={() => router.push({ pathname: '/import', params: { kind: 'receipt' } })} />
      ) : null}
      <Chips value={filter} onChange={setFilter} options={[
        { value: 'all' as Filter, label: 'Все' },
        { value: 'drafts' as Filter, label: 'Черновики' },
        { value: 'posted' as Filter, label: 'Проведённые' },
        { value: 'receipt' as Filter, label: 'Приход' },
        { value: 'issue' as Filter, label: 'Расход' },
        { value: 'returns' as Filter, label: 'Возвраты' },
        { value: 'move' as Filter, label: 'Перемещения' },
      ]} />
      <FlatList
        style={{ borderRadius: 12 }}
        data={docs ?? []}
        keyExtractor={(d) => String(d.id)}
        ListEmptyComponent={<Empty text="Документов нет" />}
        renderItem={({ item: d }) => (
          <ListRow
            title={`${d.number} · ${DOC_TITLES[d.type]}${d.source !== 'manual' && DOC_SOURCE_LABEL[d.source] ? ` (${DOC_SOURCE_LABEL[d.source]})` : ''}`}
            subtitle={docSubtitle(d)}
            right={statusBadge(d)}
            onPress={() => router.push({ pathname: '/doc/[id]', params: { id: String(d.id) } })}
          />
        )}
      />
    </View>
  );
}
