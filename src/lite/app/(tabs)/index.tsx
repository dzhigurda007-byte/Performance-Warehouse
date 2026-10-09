import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { ActionMenu } from '../../../components/ActionMenu';
import { Chips } from '../../../components/Chips';
import { Scanner } from '../../../components/Scanner';
import { Button, Card, Empty, Muted, SearchBox, colors, confirm, s, showError, useFocusLoad } from '../../../components/ui';
import { formatQty } from '../../../core/codes';
import { GroupPicker, TextModal } from '../../components/pickers';
import { groups, items, summary, type GroupRow, type ItemRow, type ItemSort, type StockFilter } from '../../core/service';
import { useDb } from '../../lib/db';

type Row = { kind: 'group'; g: GroupRow } | { kind: 'item'; i: ItemRow };

const SORTS: { value: ItemSort; label: string }[] = [
  { value: 'name', label: 'А–Я' },
  { value: 'name_desc', label: 'Я–А' },
  { value: 'article', label: 'Артикул' },
  { value: 'spp', label: 'SPP' },
  { value: 'qty', label: 'Больше на складе' },
  { value: 'qty_asc', label: 'Меньше на складе' },
  { value: 'date', label: 'Дата прихода' },
];

/**
 * Номенклатура и остатки: папки (группы) товаров с вложенностью, у товара — артикул, наименование,
 * SPP номер, количество и ячейки, где он лежит. Поиск — по всей базе, независимо от открытой папки.
 */
export default function ItemsTab() {
  const db = useDb();
  const [q, setQ] = useState('');
  const [folder, setFolder] = useState<number | null>(null);
  const [filter, setFilter] = useState<StockFilter>('all');
  const [sort, setSort] = useState<ItemSort>('name');
  const [scan, setScan] = useState(false);
  const [nameModal, setNameModal] = useState<{ mode: 'new' | 'rename'; initial: string } | null>(null);
  const [folderMenu, setFolderMenu] = useState(false);
  const [moveFolder, setMoveFolder] = useState(false);
  const [itemMenu, setItemMenu] = useState<ItemRow | null>(null);
  const [moveItem, setMoveItem] = useState<ItemRow | null>(null);
  const searching = !!q.trim();

  const [data, reload] = useFocusLoad(async () => ({
    path: await groups.path(db, folder),
    folders: searching ? [] : await groups.children(db, folder),
    items: await items.list(db, { search: q, filter, sort, groupId: folder }),
    groupPaths: searching ? new Map((await groups.all(db)).map((g) => [g.id, g.name])) : null,
  }), [db, q, filter, sort, folder]);
  const [sum] = useFocusLoad(() => summary(db), [db]);

  const rows: Row[] = [
    ...(data?.folders ?? []).map((g) => ({ kind: 'group' as const, g })),
    ...(data?.items ?? []).map((i) => ({ kind: 'item' as const, i })),
  ];
  const current = data?.path[data.path.length - 1];

  async function onScan(code: string) {
    const it = await items.findByCode(db, code);
    setScan(false);
    if (it) router.push({ pathname: '/item/[id]', params: { id: String(it.id) } });
    else router.push({ pathname: '/item/[id]', params: { id: 'new', barcode: code, group: folder ? String(folder) : '' } });
    return true;
  }

  async function saveFolder(name: string) {
    const m = nameModal!;
    setNameModal(null);
    try {
      if (m.mode === 'new') setFolder(await groups.save(db, { name, parent_id: folder }));
      else if (current) { await groups.save(db, { id: current.id, name, parent_id: current.parent_id }); reload(); }
    } catch (e) {
      showError(e);
    }
  }

  function removeFolder() {
    if (!current) return;
    confirm(`Удалить папку «${current.name}»?`, 'Товары и вложенные папки перейдут в папку уровнем выше. Сами товары не удаляются.', async () => {
      try {
        await groups.remove(db, current.id);
        setFolder(current.parent_id);
      } catch (e) {
        showError(e);
      }
    }, 'Удалить папку');
  }

  return (
    <View style={s.screen}>
      <FlatList
        contentContainerStyle={s.content}
        data={rows}
        keyExtractor={(r) => (r.kind === 'group' ? `g${r.g.id}` : `i${r.i.id}`)}
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
                onPress={() => router.push({ pathname: '/item/[id]', params: { id: 'new', group: folder ? String(folder) : '' } })} />
            </View>
            <SearchBox value={q} onChangeText={setQ} placeholder="Поиск по всей базе: артикул, название, SPP, ШК" />
            <Chips value={filter} onChange={setFilter} options={[
              { value: 'all' as StockFilter, label: 'Все' },
              { value: 'in' as StockFilter, label: 'В наличии' },
              { value: 'out' as StockFilter, label: 'Нет на складе' },
            ]} />
            <Chips value={sort} onChange={setSort} options={SORTS} />
            {searching ? (
              <Text style={[s.section, { marginBottom: 6 }]}>Найдено во всей базе: {data?.items.length ?? 0}</Text>
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginBottom: 8, gap: 4 }}>
                <Pressable onPress={() => setFolder(null)}><Text style={crumb(!folder)}>Все товары</Text></Pressable>
                {data?.path.map((g, i) => (
                  <View key={g.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Text style={{ color: colors.muted }}>›</Text>
                    <Pressable onPress={() => setFolder(g.id)}><Text style={crumb(i === data.path.length - 1)}>{g.name}</Text></Pressable>
                  </View>
                ))}
                <View style={{ flex: 1 }} />
                <Pressable onPress={() => setNameModal({ mode: 'new', initial: '' })} hitSlop={6}>
                  <Text style={{ color: colors.primary, fontWeight: '600' }}>+ Папка</Text>
                </Pressable>
                {current ? (
                  <Pressable onPress={() => setFolderMenu(true)} hitSlop={8}><Text style={{ color: colors.primary, fontSize: 18, paddingHorizontal: 6 }}>⋯</Text></Pressable>
                ) : null}
              </View>
            )}
          </View>
        }
        ListEmptyComponent={data ? <Empty text={searching ? 'Ничего не найдено' : folder ? 'Папка пустая' : 'Номенклатура пуста — добавьте товар или отсканируйте ШК'} /> : null}
        renderItem={({ item: r }) => (r.kind === 'group' ? (
          <Pressable onPress={() => setFolder(r.g.id)} style={({ pressed }) => [s.row, { borderRadius: 0 }, pressed && { backgroundColor: '#F9FAFB' }]}>
            <Text style={{ fontSize: 22 }}>📁</Text>
            <View style={{ flex: 1 }}>
              <Text style={s.rowTitle}>{r.g.name}</Text>
              <Text style={s.rowSub}>{r.g.items} тов.{r.g.subgroups ? ` · папок: ${r.g.subgroups}` : ''}</Text>
            </View>
            <Text style={{ color: colors.muted, fontSize: 18 }}>›</Text>
          </Pressable>
        ) : (
          <Pressable onPress={() => router.push({ pathname: '/item/[id]', params: { id: String(r.i.id) } })} onLongPress={() => setItemMenu(r.i)}
            style={({ pressed }) => [s.row, pressed && { backgroundColor: '#F9FAFB' }]}>
            <View style={{ flex: 1 }}>
              <Text style={s.rowTitle}>{r.i.name}</Text>
              <Text style={s.rowSub}>{[`Арт. ${r.i.article}`, r.i.spp ? `SPP ${r.i.spp}` : null].filter(Boolean).join(' · ')}</Text>
              {r.i.places ? <Text style={{ fontSize: 13, color: colors.primary, marginTop: 2 }}>📍 {r.i.places}</Text> : null}
              {searching && r.i.group_id && data?.groupPaths ? <Text style={s.rowSub}>📁 {data.groupPaths.get(r.i.group_id)}</Text> : null}
            </View>
            <Text style={{ fontSize: 16, fontWeight: '700', color: r.i.qty > 0 ? colors.text : colors.muted }}>{formatQty(r.i.qty)} {r.i.unit}</Text>
          </Pressable>
        ))}
        ListFooterComponent={data?.items.length ? <Muted>Долгое нажатие на товар — переложить в другую папку.</Muted> : null}
      />
      <Scanner visible={scan} title="Найти товар" hint="Отсканируйте ШК, SPP или артикул. Новый код — откроется карточка нового товара."
        onClose={() => setScan(false)} onScan={onScan} />
      <TextModal visible={!!nameModal} title={nameModal?.mode === 'rename' ? 'Переименовать папку' : `Новая папка${current ? ` в «${current.name}»` : ''}`}
        label="Название папки" initial={nameModal?.initial} onClose={() => setNameModal(null)} onSubmit={saveFolder} />
      <ActionMenu visible={folderMenu} title={`Папка «${current?.name ?? ''}»`} onClose={() => setFolderMenu(false)} actions={[
        { label: 'Переименовать', onPress: () => setNameModal({ mode: 'rename', initial: current?.name ?? '' }) },
        { label: 'Переложить в другую папку', onPress: () => setMoveFolder(true) },
        { label: 'Удалить папку', danger: true, onPress: removeFolder },
      ]} />
      <ActionMenu visible={!!itemMenu} title={itemMenu?.name} onClose={() => setItemMenu(null)} actions={[
        { label: 'Открыть карточку', onPress: () => router.push({ pathname: '/item/[id]', params: { id: String(itemMenu!.id) } }) },
        { label: 'Переложить в папку…', onPress: () => setMoveItem(itemMenu) },
      ]} />
      <GroupPicker visible={!!moveItem} title="Переложить товар в папку" onClose={() => setMoveItem(null)}
        onPick={async (gid) => {
          const it = moveItem!;
          setMoveItem(null);
          try { await items.setGroup(db, [it.id], gid); reload(); } catch (e) { showError(e); }
        }} />
      <GroupPicker visible={moveFolder} title="Куда переложить папку" exclude={current?.id} onClose={() => setMoveFolder(false)}
        onPick={async (gid) => {
          setMoveFolder(false);
          if (!current) return;
          try { await groups.save(db, { id: current.id, name: current.name, parent_id: gid }); reload(); } catch (e) { showError(e); }
        }} />
    </View>
  );
}

const crumb = (active: boolean) => ({ color: active ? colors.text : colors.primary, fontWeight: active ? ('700' as const) : ('500' as const) });
