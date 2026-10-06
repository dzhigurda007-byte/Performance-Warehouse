import { router } from 'expo-router';
import * as Network from 'expo-network';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Scanner } from '../components/Scanner';
import { Button, Card, Field, H1, ListRow, Muted, colors, showError } from '../components/ui';
import { parseScan } from '../core/codes';
import { useBackend } from '../lib/backend';
import { scanSubnet } from '../lib/remote';

/** Первый запуск: к какому серверу подключаться или работать автономно. */
export default function ConnectScreen() {
  const { connectServer, chooseLocal } = useBackend();
  const [address, setAddress] = useState('');
  const [scan, setScan] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [found, setFound] = useState<string[]>([]);

  async function connect(url: string) {
    setBusy(true);
    try {
      await connectServer(url);
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  }

  async function findInNetwork() {
    try {
      const ip = await Network.getIpAddressAsync();
      setProgress(0);
      const list = await scanSubnet(ip, 8080, setProgress);
      setFound(list);
      if (!list.length) showError(new Error('Сервер не найден. Проверьте, что телефон в той же сети Wi-Fi, а сервер запущен.'));
    } catch (e) {
      showError(e);
    } finally {
      setProgress(null);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
          <View style={{ alignItems: 'center', marginVertical: 16 }}>
            <Text style={{ fontSize: 44 }}>📦</Text>
            <H1>Performance Warehouse</H1>
            <Muted>Выберите, как работать</Muted>
          </View>

          <Card>
            <Text style={{ fontSize: 17, fontWeight: '700', color: colors.text }}>Сервер склада (ПК)</Text>
            <Muted>Общая база для всех сотрудников. Телефон подключается к ПК по Wi-Fi.</Muted>
            <View style={{ height: 10 }} />
            <Button title="Сканировать QR с экрана ПК" icon="⌗" onPress={() => setScan(true)} />
            <Button title={progress === null ? 'Найти сервер в сети Wi-Fi' : `Поиск… ${progress} / 254`}
              variant="secondary" busy={progress !== null} onPress={findInNetwork} />
            {found.map((u) => <ListRow key={u} title={u} subtitle="Найден сервер склада" right="›" onPress={() => connect(u)} />)}
            <View style={{ height: 10 }} />
            <Field label="или адрес вручную" value={address} onChangeText={setAddress} placeholder="192.168.1.10:8080"
              autoCapitalize="none" autoCorrect={false} keyboardType="url" />
            <Button title="Подключиться" variant="ghost" busy={busy} disabled={!address.trim()} onPress={() => connect(address)} />
          </Card>

          <Card>
            <Text style={{ fontSize: 17, fontWeight: '700', color: colors.text }}>Автономно на этом телефоне</Text>
            <Muted>База хранится только на телефоне. Подходит для работы одного человека.</Muted>
            <View style={{ height: 10 }} />
            <Button title="Работать автономно" variant="ghost" onPress={() => chooseLocal().catch(showError)} />
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>

      <Scanner
        visible={scan}
        title="QR сервера или приглашения"
        hint="QR показан на ПК: «Ещё» → «Подключение терминалов», или в приглашении"
        onClose={() => setScan(false)}
        onScan={async (code) => {
          const t = parseScan(code);
          if (t.kind === 'server') {
            setScan(false);
            await connect(t.url);
            return true;
          }
          if (t.kind === 'invite') {
            setScan(false);
            router.push({ pathname: '/join/[token]', params: { token: t.token, server: t.server } });
            return true;
          }
          return false;
        }}
      />
    </SafeAreaView>
  );
}
