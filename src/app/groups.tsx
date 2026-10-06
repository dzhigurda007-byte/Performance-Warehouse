import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { ActionMenu } from '../components/ActionMenu';
import { Chips } from '../components/Chips';
import { Button, Card, Empty, Field, ListRow, Muted, colors, confirm, s, showError, useFocusLoad } from '../components/ui';
import type { ItemGroup } from '../core/types';
import { useApi } from '../lib/backend';

/** Группы и подгруппы номенклатуры (по виду или другому признаку). */
export default function GroupsScreen() {
  const api = useApi();
  const [groups, reload] = useFocusLoad(() => api.listGroups(), [api]);
  const [form, setForm] = useState<{ id?: number; name: string; parent_id: number | null } | null>(null);
  const [menu, setMenu] = useState<ItemGroup | null>(null);
  if (!groups) return null;

  async function save() {
    try {
      await api.saveGroup(form!);
      setForm(null);
      reload();
    } catch (e) {
      showError(e);
    }
  }

  const tree = (parent: number | null, depth: number): React.ReactNode[] =>
    groups.filter((g) => g.parent_id === parent).flatMap((g) => [
      <ListRow key={g.id} title={`${'    '.repeat(depth)}${depth ? '└ ' : ''}${g.name}`} subtitle={`товаров: ${g.items}`}
        onPress={() => setMenu(g)} />,
      ...tree(g.id, depth + 1),
    ]);

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      {form ? (
        <Card>
          <Text style={{ fontWeight: '700', color: colors.text, marginBottom: 8 }}>{form.id ? 'Группа' : 'Новая группа'}</Text>
          <Field label="Название" value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} autoFocus />
          <Muted>Входит в группу</Muted>
          <Chips value={form.parent_id ?? 0} onChange={(v) => setForm({ ...form, parent_id: v || null })}
            options={[{ value: 0, label: 'Верхний уровень' }, ...groups.filter((g) => g.id !== form.id).map((g) => ({ value: g.id, label: g.name }))]} />
          <View style={s.rowWrap}>
            <Button title="Отмена" variant="ghost" style={{ flex: 1 }} onPress={() => setForm(null)} />
            <Button title="Сохранить" style={{ flex: 1 }} onPress={save} />
          </View>
        </Card>
      ) : <Button title="Новая группа" icon="+" onPress={() => setForm({ name: '', parent_id: null })} />}
      <View style={{ borderRadius: 12, overflow: 'hidden', marginTop: 12 }}>
        {groups.length ? tree(null, 0) : <Empty text="Групп пока нет. Их также можно задать столбцом «Группа» в Excel: «Инструмент / Ручной»." />}
      </View>
      <ActionMenu visible={!!menu} title={menu?.name} onClose={() => setMenu(null)} actions={menu ? [
        { label: 'Подгруппа', onPress: () => setForm({ name: '', parent_id: menu.id }) },
        { label: 'Изменить', onPress: () => setForm({ id: menu.id, name: menu.name, parent_id: menu.parent_id }) },
        { label: 'Удалить', danger: true, onPress: () => confirm('Удалить группу?', 'Товары останутся без группы', () => api.deleteGroup(menu.id).then(reload).catch(showError), 'Удалить') },
      ] : []} />
    </ScrollView>
  );
}
