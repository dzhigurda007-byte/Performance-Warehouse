import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Badge, Button, Empty, ListRow, Muted, SearchBox, Section, s, useFocusLoad } from '../components/ui';
import { ROLE_LABEL, ROLES, rank } from '../core/roles';
import { useApi, usePerms } from '../lib/backend';

/** Сотрудники по иерархии: Администратор → Руководитель → Кладовщик → Сотрудник → Разнорабочий. */
export default function UsersScreen() {
  const api = useApi();
  const p = usePerms();
  const [q, setQ] = useState('');
  const [users] = useFocusLoad(() => api.listUsers(), [api]);
  const groups = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = (users ?? []).filter((u) => !t || `${u.full_name} ${u.login} ${u.department_name ?? ''}`.toLowerCase().includes(t));
    return ROLES.map((r) => ({ role: r, list: list.filter((u) => u.role === r) })).filter((g) => g.list.length);
  }, [users, q]);

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      {p.invite ? <Button title="Пригласить сотрудника" icon="+" onPress={() => router.push('/invites')} /> : null}
      <SearchBox value={q} onChangeText={setQ} placeholder="ФИО, логин, отдел" />
      {groups.length ? groups.map((g) => (
        <Section key={g.role} title={`${ROLE_LABEL[g.role]} · ${g.list.length}`}>
          <View style={{ borderRadius: 12, overflow: 'hidden' }}>
            {g.list.map((u) => (
              <ListRow key={u.id} title={u.full_name}
                subtitle={[u.position, u.department_name, u.supervisor_name ? `рук.: ${u.supervisor_name}` : null, `@${u.login}`].filter(Boolean).join(' · ')}
                right={u.active ? '›' : <Badge text="заблокирован" tone="danger" />}
                onPress={p.manageUsers && (p.develop || rank(u.role) < rank(p.role))
                  ? () => router.push({ pathname: '/user/[id]', params: { id: String(u.id) } }) : undefined} />
            ))}
          </View>
        </Section>
      )) : <Empty text="Нет сотрудников" />}
      <Muted>Новые сотрудники подключаются по ссылке-приглашению с заранее заданной ролью, отделом и руководителем.</Muted>
    </ScrollView>
  );
}
