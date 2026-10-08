import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { Platform, ScrollView, Share, Text, View } from 'react-native';
import { Chips } from '../components/Chips';
import { QrView } from '../components/QrView';
import { Badge, Button, Card, Empty, ListRow, Muted, Section, colors, confirm, notify, s, showError, useFocusLoad } from '../components/ui';
import { inviteUrl } from '../core/codes';
import { can, ROLE_HINT, ROLE_LABEL, ROLES, type Role } from '../core/roles';
import { useApi, useBackend, usePerms } from '../lib/backend';
import { remoteAuth } from '../lib/remote';

/** Приглашения: руководитель создаёт ссылку с ролью, отделом и руководителем — сотрудник регистрируется по ней. */
export default function InvitesScreen() {
  const api = useApi();
  const { serverUrl, token } = useBackend();
  const p = usePerms();
  const [data, reload] = useFocusLoad(async () => {
    const [invites, deps, users] = await Promise.all([api.listInvites(), api.listDepartments(), api.listUsers()]);
    let base = serverUrl ?? '';
    const info = serverUrl && token ? await remoteAuth.info(serverUrl, token).catch(() => null) : null;
    // Онлайн-сервер: ссылки всегда на адрес в интернете.
    // Сервер на ПК: в браузере адрес может быть localhost — для ссылки берём адрес в сети Wi-Fi.
    if (info?.publicUrl) base = info.publicUrl;
    else if (serverUrl && /localhost|127\.0\.0\.1/.test(serverUrl) && info?.urls[0]) base = info.urls[0];
    return { invites, deps, users, base };
  }, [api, serverUrl, token]);
  const roles = ROLES.filter((r) => can.inviteRole(p.role, r));
  const [form, setForm] = useState<{ role: Role; department_id: number | null; supervisor_id: number | null; days: number; maxUses: number }>(
    { role: roles[roles.length - 1] ?? 'worker', department_id: null, supervisor_id: null, days: 7, maxUses: 1 });
  const [created, setCreated] = useState<string | null>(null);

  if (!data) return null;

  async function create() {
    try {
      const r = await api.createInvite(form);
      setCreated(inviteUrl(data!.base, r.token));
      reload();
    } catch (e) {
      showError(e);
    }
  }

  async function share(url: string) {
    if (Platform.OS === 'web') {
      await Clipboard.setStringAsync(url);
      notify('Ссылка скопирована', url);
    } else {
      await Share.share({ message: `Приглашение на склад: ${url}` });
    }
  }

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      <Card>
        <Text style={{ fontWeight: '700', fontSize: 16, color: colors.text, marginBottom: 6 }}>Новое приглашение</Text>
        <Muted>Роль</Muted>
        <Chips value={form.role} onChange={(r) => setForm({ ...form, role: r })} options={roles.map((r) => ({ value: r, label: ROLE_LABEL[r] }))} />
        <Muted>{ROLE_HINT[form.role]}</Muted>
        <View style={{ height: 8 }} />
        <Muted>Отдел</Muted>
        <Chips value={form.department_id ?? 0} onChange={(v) => setForm({ ...form, department_id: v || null })}
          options={[{ value: 0, label: 'Мой отдел' }, ...data.deps.map((d) => ({ value: d.id, label: d.name }))]} />
        <Muted>Руководитель</Muted>
        <Chips value={form.supervisor_id ?? 0} onChange={(v) => setForm({ ...form, supervisor_id: v || null })}
          options={[{ value: 0, label: 'Я' }, ...data.users.filter((u) => u.active && can.inviteRole(u.role, form.role)).map((u) => ({ value: u.id, label: u.full_name }))]} />
        <Muted>Срок действия и число регистраций</Muted>
        <Chips value={form.days} onChange={(d) => setForm({ ...form, days: d })} options={[1, 7, 30].map((d) => ({ value: d, label: `${d} дн.` }))} />
        <Chips value={form.maxUses} onChange={(n) => setForm({ ...form, maxUses: n })} options={[1, 5, 20, 100].map((n) => ({ value: n, label: n === 1 ? 'Один человек' : `До ${n} чел.` }))} />
        <Button title="Создать ссылку" onPress={create} />
      </Card>

      {created ? (
        <Card style={{ backgroundColor: colors.successSoft }}>
          <Text style={{ fontWeight: '700', color: colors.text }}>Ссылка готова</Text>
          <QrView value={created} size={180} />
          <Muted>Сотрудник открывает ссылку в браузере или сканирует QR в приложении. Телефон должен быть в Wi-Fi склада.</Muted>
          <Button title={Platform.OS === 'web' ? 'Скопировать ссылку' : 'Отправить ссылку'} onPress={() => share(created)} />
        </Card>
      ) : null}

      <Section title="Выданные приглашения">
        <View style={{ borderRadius: 12, overflow: 'hidden' }}>
          {data.invites.length ? data.invites.map((i) => {
            const active = !i.revoked && i.uses < i.max_uses;
            const url = inviteUrl(data.base, i.token);
            return (
              <ListRow key={i.id} title={`${ROLE_LABEL[i.role]}${i.department_name ? ' · ' + i.department_name : ''}`}
                subtitle={`${i.created_at.slice(0, 16)} · ${i.created_by_name} · использовано ${i.uses}/${i.max_uses}${i.expires_at ? ` · до ${i.expires_at.slice(0, 10)}` : ''}`}
                right={<Badge text={i.revoked ? 'отозвано' : active ? 'активно' : 'исчерпано'} tone={active ? 'success' : 'muted'} />}
                onPress={active ? () => setCreated(url) : undefined}
                onLongPress={active ? () => confirm('Отозвать приглашение?', url, () => api.revokeInvite(i.id).then(reload).catch(showError), 'Отозвать') : undefined} />
            );
          }) : <Empty text="Приглашений нет" />}
        </View>
      </Section>
      <Muted>Нажмите на активное приглашение, чтобы снова показать QR; долгое нажатие — отозвать.</Muted>
    </ScrollView>
  );
}
