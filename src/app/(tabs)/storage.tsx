import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { ScrollView, View } from 'react-native';
import { Button, Empty, ListRow, Muted, s, useFocusLoad } from '../../components/ui';
import * as repo from '../../db/repo';

export default function StorageScreen() {
  const db = useSQLiteContext();
  const [whs] = useFocusLoad(() => repo.listWarehouses(db), [db]);
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      <Muted>Структура хранения: Склад → Стеллаж → Ячейка → (Короб) → Товар</Muted>
      <View style={{ height: 8 }} />
      <Button title="Новый склад" icon="+" onPress={() => router.push('/warehouse/edit')} />
      <View style={{ marginTop: 12, borderRadius: 12, overflow: 'hidden' }}>
        {whs?.length ? (
          whs.map((w) => (
            <ListRow
              key={w.id}
              title={`${w.code} — ${w.name}`}
              subtitle={`${w.address ? w.address + ' · ' : ''}стеллажей: ${w.racks}, ячеек: ${w.cells}`}
              right="›"
              onPress={() => router.push({ pathname: '/warehouse/[id]', params: { id: String(w.id) } })}
            />
          ))
        ) : (
          <Empty text="Складов пока нет" />
        )}
      </View>
    </ScrollView>
  );
}
