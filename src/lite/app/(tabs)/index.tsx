import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { Chips } from '../../../components/Chips';
import { Scanner } from '../../../components/Scanner';
import { Button, Card, Empty, ListRow, Muted, SearchBox, colors, s, useFocusLoad } from '../../../components/ui';
import { formatQty } from '../../../core/codes';
import { items, summary, type ItemSort, type StockFilter } from '../../core/service';
import { useDb } from '../../lib/db';

/** Номенклатура и остатки: артикул, наименование, SPP номер, количество на складе. */
export default function ItemsTab() {
  const db = useDb();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<StockFilter>('all');
  const [sort, setSort] = useState<ItemSort>('name');
  const [scan, setScan] = useState(false);
  const [list] = useFocusLoad(() => items.list(db, { search: q, filter, sort }), [db, q, filter, sort]);
  const [sum] = useFocusLoad(() => summary(db), [db]);

  async function onScan(code: string) {
    const it = await items.findByCode(db, code);
    setScan(false);
    if (it) router.push({ pathname: '/item/[id]', params: { id: String(it.id) } });
    else router.push({ pathname: '/item/[id]', params: { id: 'new', barcode: code } });
    return true;
  }

  return (
    <View style={s.screen}>
      <FlatList
        contentContainerStyle={s.content}
        data={list ?? []}
        keyExtractor={(i) => String(i.id)}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View>
            {sum ? (
              <Card>
                <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
                  {[['Товаров', sum.items], ['В наличии', sum.in_stock], ['Всего шт.', formatQty(sum.total)], ['Черновиков', sum.drafts]].map(([k, v]) => (
                    <View key={String(k)} style={{ alignItems: 'center' }}>
                      <Text style={{ fontSize: 20, fontWeight: '700', color: colors.text }}>{v}</Text>
                      <Muted>{k}</Muted>
                    </View>
                  ))}
                </View>
              </Card>
            ) : null}
            <View style={s.rowWrap}>
              <Button title="Сканировать" icon="⌖" style={{ flex: 1 }} onPress={() => setScan(true)} />
              <Button title="Новый товар" icon="+" variant="secondary" style={{ flex: 1 }}
                onPress={() => router.push({ pathname: '/item/[id]', params: { id: 'new' } })} />
            </View>
            <SearchBox value={q} onChangeText={setQ} placeholder="Артикул, наименование, SPP, ШК" />
            <Chips value={filter} onChange={setFilter} options={[
              { value: 'all' as StockFilter, label: 'Все' },
              { value: 'in' as StockFilter, label: 'В наличии' },
              { value: 'out' as StockFilter, label: 'Нет на складе' },
            ]} />
            <Chips value={sort} onChange={setSort} options={[
              { value: 'name' as ItemSort, label: 'А–Я' },
              { value: 'article' as ItemSort, label: 'По артикулу' },
              { value: 'qty' as ItemSort, label: 'По количеству' },
              { value: 'date' as ItemSort, label: 'По дате прихода' },
            ]} />
          </View>
        }
        ListEmptyComponent={list ? <Empty text={q ? 'Ничего не найдено' : 'Номенклатура пуста — добавьте товар или отсканируйте ШК'} /> : null}
        renderItem={({ item: i }) => (
          <ListRow title={i.name}
            subtitle={[`Арт. ${i.article}`, i.spp ? `SPP ${i.spp}` : null, i.barcode ? `ШК ${i.barcode}` : null].filter(Boolean).join(' · ')}
            right={<Text style={{ fontSize: 16, fontWeight: '700', color: i.qty > 0 ? colors.text : colors.muted }}>{formatQty(i.qty)} {i.unit}</Text>}
            onPress={() => router.push({ pathname: '/item/[id]', params: { id: String(i.id) } })} />
        )}
      />
      <Scanner visible={scan} title="Найти товар" hint="Отсканируйте ШК, SPP или артикул. Новый код — откроется карточка нового товара."
        onClose={() => setScan(false)} onScan={onScan} />
    </View>
  );
}
