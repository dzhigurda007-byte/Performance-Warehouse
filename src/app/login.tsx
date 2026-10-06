import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Scanner } from '../components/Scanner';
import { Button, Card, Field, H1, Muted, colors, showError } from '../components/ui';
import { parseScan } from '../core/codes';
import { useBackend } from '../lib/backend';
import { remoteAuth } from '../lib/remote';

export default function LoginScreen() {
  const { mode, serverUrl, login, register, resetConnection } = useBackend();
  const [needsSetup, setNeedsSetup] = useState(false);
  const [orgName, setOrgName] = useState('');
  const [signUp, setSignUp] = useState(false);
  const [form, setForm] = useState({ login: '', name: '', pass: '', pass2: '' });
  const [busy, setBusy] = useState(false);
  const [scan, setScan] = useState(false);

  useEffect(() => {
    if (mode !== 'server' || !serverUrl) return;
    remoteAuth.ping(serverUrl).then((p) => {
      setNeedsSetup(p.needsSetup);
      setOrgName(p.orgName);
    }).catch(showError);
  }, [mode, serverUrl]);

  const creating = (mode === 'server' && needsSetup) || (mode === 'local' && signUp);

  async function submit() {
    if (creating && form.pass !== form.pass2) return showError(new Error('Пароли не совпадают'));
    setBusy(true);
    try {
      if (creating) await register(form.login, form.name, form.pass);
      else await login(form.login, form.pass);
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: 24, flexGrow: 1, justifyContent: 'center', maxWidth: 480, width: '100%', alignSelf: 'center' }}
          keyboardShouldPersistTaps="handled">
          <View style={{ alignItems: 'center', marginBottom: 20 }}>
            <Text style={{ fontSize: 44 }}>📦</Text>
            <H1>{orgName || 'Performance Warehouse'}</H1>
            <Muted>{mode === 'server' ? `Сервер склада: ${serverUrl}` : 'Автономный режим (база на телефоне)'}</Muted>
          </View>
          <Card>
            <Text style={{ fontSize: 18, fontWeight: '700', marginBottom: 4, color: colors.text }}>
              {mode === 'server' && needsSetup ? 'Первый запуск: администратор' : creating ? 'Регистрация' : 'Вход'}
            </Text>
            {mode === 'server' && needsSetup ? (
              <Muted>Сервер новый. Создайте учётную запись администратора — он настроит склад и пригласит сотрудников.</Muted>
            ) : null}
            <View style={{ height: 8 }} />
            <Field label="Логин" value={form.login} onChangeText={(v) => setForm({ ...form, login: v })} autoCapitalize="none" autoCorrect={false} />
            {creating ? <Field label="ФИО (будет указано в документах)" value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} /> : null}
            <Field label="Пароль" value={form.pass} onChangeText={(v) => setForm({ ...form, pass: v })} secureTextEntry
              onSubmitEditing={creating ? undefined : submit} />
            {creating ? <Field label="Повторите пароль" value={form.pass2} onChangeText={(v) => setForm({ ...form, pass2: v })} secureTextEntry /> : null}
            <Button title={creating ? 'Создать и войти' : 'Войти'} onPress={submit} busy={busy} />
          </Card>

          {mode === 'server' && !needsSetup ? (
            <Card>
              <Text style={{ fontWeight: '700', color: colors.text }}>Нет аккаунта?</Text>
              <Muted>Новые сотрудники входят по приглашению от руководителя: откройте ссылку или отсканируйте её QR-код.</Muted>
              {Platform.OS !== 'web' ? <Button title="Сканировать приглашение" variant="secondary" icon="⌗" onPress={() => setScan(true)} /> : null}
            </Card>
          ) : null}

          {mode === 'local' ? (
            <Pressable onPress={() => setSignUp(!signUp)} style={{ padding: 12, alignItems: 'center' }}>
              <Text style={{ color: colors.primary }}>{signUp ? 'Уже есть аккаунт? Войти' : 'Нет аккаунта? Зарегистрироваться'}</Text>
            </Pressable>
          ) : null}
          {Platform.OS !== 'web' ? (
            <Pressable onPress={() => resetConnection().catch(showError)} style={{ padding: 12, alignItems: 'center' }}>
              <Text style={{ color: colors.muted }}>Сменить сервер / режим работы</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
      <Scanner visible={scan} title="QR приглашения" onClose={() => setScan(false)} onScan={(code) => {
        const t = parseScan(code);
        if (t.kind !== 'invite') return false;
        setScan(false);
        router.push({ pathname: '/join/[token]', params: { token: t.token, server: t.server } });
        return true;
      }} />
    </SafeAreaView>
  );
}
