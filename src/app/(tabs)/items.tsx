import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, View } from 'react-native';
import { Chips } from '../../components/Chips';
import { Scanner } from '../../components/Scanner';
import { Button, Empty, ListRow, Muted, SearchBox, s, useFocusLoad } from '../../components/ui';
import { formatQty } from '../../core/codes';
import { useApi, usePerms } from '../../lib/backend';

/**
 * Номенклатура — справочник возможных наименований (как в 1С).
 * Физический товар хранится в ячейках с датой приёмки (см. карточку товара).
 */
export default function ItemsScreen() {
  const api = useApi();
  const p = usePerms();
  const [q, setQ] = useState('');
  const [group, setGroup] = useState<number>(0);
  const [scan, setScan] = useState(false);
  const [groups] = useFocusLoad(() => api.listGroups(), [api]);
  const [items] = useFocusLoad(() => api.listItems(q, group || null), [api, q, group]);

  const topGroups = useMemo(() => {
    const sel = groups?.find((g) => g.id === group);
    const parent = sel ? sel.parent_id : null;
    const children = (groups ?? []).filter((g) => g.parent_id === (sel ? sel.id : null));
    const siblings = (groups ?? []).filter((g) => g.parent_id === parent);
    return { sel, parent, list: children.length ? children : siblings };
  }, [groups, group]);

  return (
    <View style={[s.screen, { padding: 16 }]}>
      <View style={s.rowWrap}>
        <View style={{ flex: 1 }}>
          <SearchBox value={q} onChangeText={setQ} placeholder="Название, артикул, штрихкод" />
        </View>
        <Button title="⌗" variant="secondary" style={{ marginTop: 0, height: 46 }} onPress={() => setScan(true)} />
      </View>
      {groups?.length ? (
        <Chips value={group} onChange={setGroup} options={[
          { value: 0, label: 'Все группы' },
          ...(topGroups.sel ? [{ value: topGroups.parent ?? 0, label: '‹ Назад' }, { value: topGroups.sel.id, label: `▸ ${topGroups.sel.name}` }] : []),
          ...topGroups.list.filter((g) => g.id !== topGroups.sel?.id).map((g) => ({ value: g.id, label: g.name })),
        ]} />
      ) : null}
      {p.manageItems ? (
        <View style={s.rowWrap}>
          <Button title="Новый товар" icon="+" style={{ flex: 1 }} onPress={() => router.push('/item/edit')} />
          <Button title="Из Excel" icon="⊞" variant="secondary" style={{ flex: 1 }}
            onPress={() => router.push({ pathname: '/import', params: { kind: 'items' } })} />
        </View>
      ) : null}
      <FlatList
        style={{ marginTop: 10, borderRadius: 12 }}
        data={items ?? []}
        keyExtractor={(i) => String(i.id)}
        ListEmptyComponent={<Empty text="Номенклатура пуста" />}
        ListFooterComponent={items?.length ? <Muted>Показано: {items.length}</Muted> : null}
        renderItem={({ item }) => (
          <ListRow
            title={item.name}
            subtitle={`${item.sku}${item.barcode ? ' · ШК ' + item.barcode : ''}${item.group_name ? ' · ' + item.group_name : ''}`}
            right={`${formatQty(item.total)} ${item.unit}`}
            onPress={() => router.push({ pathname: '/item/[id]', params: { id: String(item.id) } })}
          />
        )}
      />
      <Scanner visible={scan} title="Поиск товара" onClose={() => setScan(false)}
        onScan={async (code) => {
          const r = await api.resolveScan(code);
          if (r.type !== 'item') return false;
          setScan(false);
          router.push({ pathname: '/item/[id]', params: { id: String(r.item.id) } });
          return true;
        }} />
    </View>
  );
}
