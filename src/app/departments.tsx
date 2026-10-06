import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { ActionMenu } from '../components/ActionMenu';
import { Chips } from '../components/Chips';
import { Button, Card, Empty, Field, ListRow, Muted, Section, colors, confirm, s, showError, useFocusLoad } from '../components/ui';
import { ROLE_LABEL, ROLE_RANK, rank } from '../core/roles';
import type { Department } from '../core/types';
import { useApi } from '../lib/backend';

/** Отделы: дерево подчинённости, глава отдела и сотрудники. */
export default function DepartmentsScreen() {
  const api = useApi();
  const [data, reload] = useFocusLoad(async () => ({ deps: await api.listDepartments(), users: await api.listUsers() }), [api]);
  const [form, setForm] = useState<{ id?: number; name: string; parent_id: number | null; head_id: number | null } | null>(null);
  const [menu, setMenu] = useState<Department | null>(null);
  if (!data) return null;
  const heads = data.users.filter((u) => u.active && rank(u.role) >= ROLE_RANK.storekeeper);

  async function save() {
    try {
      await api.saveDepartment(form!);
      setForm(null);
      reload();
    } catch (e) {
      showError(e);
    }
  }

  const tree = (parent: number | null, depth: number): React.ReactNode[] =>
    data.deps.filter((d) => d.parent_id === parent).flatMap((d) => [
      <ListRow key={d.id} title={`${'   '.repeat(depth)}${depth ? '└ ' : ''}${d.name}`}
        subtitle={`${d.head_name ? `Глава: ${d.head_name} · ` : ''}сотрудников: ${d.members}\n${data.users.filter((u) => u.department_id === d.id).map((u) => `${u.full_name} (${ROLE_LABEL[u.role]})`).join(', ')}`}
        onPress={() => setMenu(d)} />,
      ...tree(d.id, depth + 1),
    ]);

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <Muted>Глава отдела и руководители по цепочке видят выдачи подчинённых и могут проводить их возвраты.</Muted>
      {form ? (
        <Card>
          <Text style={{ fontWeight: '700', color: colors.text, marginBottom: 8 }}>{form.id ? 'Отдел' : 'Новый отдел'}</Text>
          <Field label="Название" value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} autoFocus />
          <Muted>Входит в отдел</Muted>
          <Chips value={form.parent_id ?? 0} onChange={(v) => setForm({ ...form, parent_id: v || null })}
            options={[{ value: 0, label: 'Верхний уровень' }, ...data.deps.filter((d) => d.id !== form.id).map((d) => ({ value: d.id, label: d.name }))]} />
          <Muted>Глава отдела</Muted>
          <Chips value={form.head_id ?? 0} onChange={(v) => setForm({ ...form, head_id: v || null })}
            options={[{ value: 0, label: 'Не назначен' }, ...heads.map((u) => ({ value: u.id, label: `${u.full_name} (${ROLE_LABEL[u.role]})` }))]} />
          <View style={s.rowWrap}>
            <Button title="Отмена" variant="ghost" style={{ flex: 1 }} onPress={() => setForm(null)} />
            <Button title="Сохранить" style={{ flex: 1 }} onPress={save} />
          </View>
        </Card>
      ) : <Button title="Новый отдел" icon="+" onPress={() => setForm({ name: '', parent_id: null, head_id: null })} />}
      <Section title="Структура">
        <View style={{ borderRadius: 12, overflow: 'hidden' }}>
          {data.deps.length ? tree(null, 0) : <Empty text="Отделов пока нет" />}
        </View>
      </Section>
      <ActionMenu visible={!!menu} title={menu?.name} onClose={() => setMenu(null)} actions={menu ? [
        { label: 'Изменить', onPress: () => setForm({ id: menu.id, name: menu.name, parent_id: menu.parent_id, head_id: menu.head_id }) },
        { label: 'Удалить', danger: true, onPress: () => confirm('Удалить отдел?', menu.name, () => api.deleteDepartment(menu.id).then(reload).catch(showError), 'Удалить') },
      ] : []} />
    </ScrollView>
  );
}
