import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, Field, H1, Muted, colors, showError } from '../components/ui';
import { useAuth } from '../lib/auth-context';

export default function LoginScreen() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [login, setLogin] = useState('');
  const [name, setName] = useState('');
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (mode === 'up' && pass !== pass2) {
      showError(new Error('Пароли не совпадают'));
      return;
    }
    setBusy(true);
    try {
      if (mode === 'in') await signIn(login, pass);
      else await signUp(login, name, pass);
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: 24, flexGrow: 1, justifyContent: 'center' }}
          keyboardShouldPersistTaps="handled">
          <View style={{ alignItems: 'center', marginBottom: 24 }}>
            <Text style={{ fontSize: 44 }}>📦</Text>
            <H1>Performance Warehouse</H1>
            <Muted>Адресное хранение ТМЦ</Muted>
          </View>
          <Card>
            <Text style={{ fontSize: 18, fontWeight: '700', marginBottom: 12, color: colors.text }}>
              {mode === 'in' ? 'Вход' : 'Регистрация'}
            </Text>
            <Field label="Логин" value={login} onChangeText={setLogin} autoCapitalize="none" autoCorrect={false} />
            {mode === 'up' ? (
              <Field label="ФИО (будет указано в документах)" value={name} onChangeText={setName} />
            ) : null}
            <Field label="Пароль" value={pass} onChangeText={setPass} secureTextEntry />
            {mode === 'up' ? <Field label="Повторите пароль" value={pass2} onChangeText={setPass2} secureTextEntry /> : null}
            <Button title={mode === 'in' ? 'Войти' : 'Зарегистрироваться'} onPress={submit} busy={busy} />
          </Card>
          <Pressable onPress={() => setMode(mode === 'in' ? 'up' : 'in')} style={{ padding: 12, alignItems: 'center' }}>
            <Text style={{ color: colors.primary }}>
              {mode === 'in' ? 'Нет аккаунта? Зарегистрироваться' : 'Уже есть аккаунт? Войти'}
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
