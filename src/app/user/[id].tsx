import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, Switch, Text, View } from 'react-native';
import { Chips } from '../../components/Chips';
import { Button, Card, Field, H1, Muted, colors, notify, s, showError, useFocusLoad } from '../../components/ui';
import { ROLE_HINT, ROLE_LABEL, ROLES, rank, type Role } from '../../core/roles';
import { useApi, useBackend, usePerms } from '../../lib/backend';

export default function UserEdit() {
  const api = useApi();
  const { user: me } = useBackend();
  const p = usePerms();
  const id = Number(useLocalSearchParams<{ id: string }>().id);
  const [data] = useFocusLoad(async () => ({
    users: await api.listUsers(),
    deps: await api.listDepartments(),
  }), [api]);
  const u = data?.users.find((x) => x.id === id);
  const [form, setForm] = useState<{ role: Role; department_id: number | null; supervisor_id: number | null; position: string; active: boolean; full_name: string } | null>(null);

  useEffect(() => {
    if (u) setForm({ role: u.role, department_id: u.department_id, supervisor_id: u.supervisor_id, position: u.position ?? '', active: !!u.active, full_name: u.full_name });
  }, [u?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!u || !form || !data || !me) return null;
  const roles = ROLES.filter((r) => p.develop || rank(r) < rank(p.role));
  const supervisors = data.users.filter((x) => x.id !== id && x.active && rank(x.role) > rank(form.role));

  async function save() {
    try {
      await api.updateUser(id, form!);
      notify('Сохранено');
      router.back();
    } catch (e) {
      showError(e);
    }
  }

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <H1>{u.full_name}</H1>
      <Muted>@{u.login} · с {u.created_at.slice(0, 10)}</Muted>
      <Card style={{ marginTop: 12 }}>
        <Field label="ФИО" value={form.full_name} onChangeText={(v) => setForm({ ...form, full_name: v })} />
        <Field label="Должность" value={form.position} onChangeText={(v) => setForm({ ...form, position: v })} />
        <Muted>Роль</Muted>
        <Chips value={form.role} onChange={(r) => setForm({ ...form, role: r })} options={roles.map((r) => ({ value: r, label: ROLE_LABEL[r] }))} />
        <Muted>{ROLE_HINT[form.role]}</Muted>
        <View style={{ height: 10 }} />
        <Muted>Отдел</Muted>
        <Chips value={form.department_id ?? 0} onChange={(d) => setForm({ ...form, department_id: d || null })}
          options={[{ value: 0, label: 'Без отдела' }, ...data.deps.map((d) => ({ value: d.id, label: d.name }))]} />
        <Muted>Непосредственный руководитель</Muted>
        <Chips value={form.supervisor_id ?? 0} onChange={(v) => setForm({ ...form, supervisor_id: v || null })}
          options={[{ value: 0, label: 'Нет' }, ...supervisors.map((x) => ({ value: x.id, label: `${x.full_name} (${ROLE_LABEL[x.role]})` }))]} />
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
          <Text style={{ color: colors.text }}>Доступ разрешён</Text>
          <Switch value={form.active} onValueChange={(v) => setForm({ ...form, active: v })} disabled={id === me.id} />
        </View>
      </Card>
      <Button title="Сохранить" onPress={save} />
    </ScrollView>
  );
}
