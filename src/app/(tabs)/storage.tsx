import { router } from 'expo-router';
import { useApi } from '../../lib/backend';
import { ScrollView, View } from 'react-native';
import { Button, Empty, ListRow, Muted, s, useFocusLoad } from '../../components/ui';

export default function StorageScreen() {
  const api = useApi();
  const [whs] = useFocusLoad(() => api.listWarehouses(), [api]);
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
