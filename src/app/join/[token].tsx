import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { Button, Card, Empty, Field, H1, Muted, colors, showError } from '../../components/ui';
import { ROLE_HINT, ROLE_LABEL } from '../../core/roles';
import { useBackend } from '../../lib/backend';
import { remoteAuth, type InviteInfo } from '../../lib/remote';

/** Регистрация по ссылке-приглашению: http://<сервер>/join/<токен>. */
export default function JoinScreen() {
  const params = useLocalSearchParams<{ token: string; server?: string }>();
  const { serverUrl, joinInvite, user, logout } = useBackend();
  const server = params.server || serverUrl || (Platform.OS === 'web' ? window.location.origin : '');
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ login: '', name: '', pass: '', pass2: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!server || !params.token) return;
    remoteAuth.invite(server, params.token).then(setInfo).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [server, params.token]);

  async function submit() {
    if (form.pass !== form.pass2) return showError(new Error('Пароли не совпадают'));
    setBusy(true);
    try {
      if (user) await logout();
      await joinInvite(server, params.token, form.login, form.name, form.pass);
      router.replace('/');
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: 20, maxWidth: 480, width: '100%', alignSelf: 'center' }} keyboardShouldPersistTaps="handled">
        {error ? <Empty text={error} /> : !info ? <Empty text="Проверяем приглашение…" /> : (
          <View>
            <H1>Приглашение{info.orgName ? ` в «${info.orgName}»` : ''}</H1>
            <Muted>От: {info.createdBy}</Muted>
            <Card style={{ marginTop: 12 }}>
              <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text }}>Роль: {ROLE_LABEL[info.role]}</Text>
              <Muted>{ROLE_HINT[info.role]}</Muted>
              {info.department ? <Muted>Отдел: {info.department}</Muted> : null}
              {info.supervisor ? <Muted>Руководитель: {info.supervisor}</Muted> : null}
            </Card>
            <Card>
              <Field label="Логин" value={form.login} onChangeText={(v) => setForm({ ...form, login: v })} autoCapitalize="none" autoCorrect={false} />
              <Field label="ФИО" value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} />
              <Field label="Пароль" value={form.pass} onChangeText={(v) => setForm({ ...form, pass: v })} secureTextEntry />
              <Field label="Повторите пароль" value={form.pass2} onChangeText={(v) => setForm({ ...form, pass2: v })} secureTextEntry />
              <Button title="Зарегистрироваться" onPress={submit} busy={busy} />
            </Card>
            <Muted>Сервер: {server}</Muted>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
