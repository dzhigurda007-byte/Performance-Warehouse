import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { FlatList, View } from 'react-native';
import { Scanner } from '../../components/Scanner';
import { Button, Empty, ListRow, SearchBox, s, useFocusLoad } from '../../components/ui';
import * as repo from '../../db/repo';
import { formatQty, parseScan } from '../../domain/codes';

export default function ItemsScreen() {
  const db = useSQLiteContext();
  const [q, setQ] = useState('');
  const [scan, setScan] = useState(false);
  const [items] = useFocusLoad(() => repo.listItems(db, q), [db, q]);

  return (
    <View style={[s.screen, { padding: 16 }]}>
      <View style={s.rowWrap}>
        <View style={{ flex: 1 }}>
          <SearchBox value={q} onChangeText={setQ} placeholder="Название, артикул, штрихкод" />
        </View>
        <Button title="⌗" variant="secondary" style={{ marginTop: 0, height: 46 }} onPress={() => setScan(true)} />
      </View>
      <Button title="Новый товар" icon="+" onPress={() => router.push('/item/edit')} />
      <FlatList
        style={{ marginTop: 10, borderRadius: 12 }}
        data={items ?? []}
        keyExtractor={(i) => String(i.id)}
        ListEmptyComponent={<Empty text="Номенклатура пуста" />}
        renderItem={({ item }) => (
          <ListRow
            title={item.name}
            subtitle={`${item.sku}${item.barcode ? ' · ШК ' + item.barcode : ''}`}
            right={`${formatQty(item.total)} ${item.unit}`}
            onPress={() => router.push({ pathname: '/item/[id]', params: { id: String(item.id) } })}
          />
        )}
      />
      <Scanner
        visible={scan}
        title="Поиск товара"
        onClose={() => setScan(false)}
        onScan={async (code) => {
          const r = await repo.resolveScan(db, parseScan(code));
          if (r.type !== 'item') return false;
          setScan(false);
          router.push({ pathname: '/item/[id]', params: { id: String(r.item.id) } });
          return true;
        }}
      />
    </View>
  );
}
