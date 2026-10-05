import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { FlatList, View } from 'react-native';
import { Chips } from '../../components/Chips';
import { Badge, Empty, ListRow, s, useFocusLoad } from '../../components/ui';
import * as repo from '../../db/repo';
import type { DocType } from '../../domain/types';
import { DOC_TITLES, docSubtitle } from '../../lib/docs';

export default function DocsScreen() {
  const db = useSQLiteContext();
  const [type, setType] = useState<DocType | undefined>(undefined);
  const [docs] = useFocusLoad(() => repo.listDocuments(db, type), [db, type]);

  return (
    <View style={[s.screen, { padding: 16 }]}>
      <Chips
        value={type}
        onChange={setType}
        options={[
          { value: undefined, label: 'Все' },
          { value: 'receipt', label: 'Приход' },
          { value: 'issue', label: 'Расход' },
          { value: 'move', label: 'Перемещения' },
        ]}
      />
      <FlatList
        style={{ borderRadius: 12 }}
        data={docs ?? []}
        keyExtractor={(d) => String(d.id)}
        ListEmptyComponent={<Empty text="Документов нет. Создайте их на вкладке «Операции»." />}
        renderItem={({ item: d }) => (
          <ListRow
            title={`${d.number} · ${DOC_TITLES[d.type]}${d.type === 'issue' && d.mode === 'fact' ? ' (факт)' : ''}`}
            subtitle={docSubtitle(d)}
            right={<Badge text={d.status === 'posted' ? 'проведён' : 'черновик'} tone={d.status === 'posted' ? 'success' : 'warn'} />}
            onPress={() => router.push({ pathname: '/doc/[id]', params: { id: String(d.id) } })}
          />
        )}
      />
    </View>
  );
}
