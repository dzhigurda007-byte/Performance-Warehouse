import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { colors } from '../components/ui';
import { BackendProvider, useBackend } from '../lib/backend';

function RootStack() {
  const { ready, mode, user } = useBackend();
  if (!ready) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }
  const connected = mode !== null;
  return (
    <Stack
      screenOptions={{
        headerTintColor: colors.primary,
        headerTitleStyle: { color: colors.text },
        headerBackButtonDisplayMode: 'minimal',
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Protected guard={!connected}>
        <Stack.Screen name="connect" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={connected && !user}>
        <Stack.Screen name="login" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={!!user}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="warehouse/[id]" options={{ title: 'Склад' }} />
        <Stack.Screen name="warehouse/edit" options={{ title: 'Склад', presentation: 'modal' }} />
        <Stack.Screen name="rack/[id]" options={{ title: 'Стеллаж' }} />
        <Stack.Screen name="cell/[id]" options={{ title: 'Ячейка' }} />
        <Stack.Screen name="box/[id]" options={{ title: 'Короб' }} />
        <Stack.Screen name="item/[id]" options={{ title: 'Товар' }} />
        <Stack.Screen name="item/edit" options={{ title: 'Товар', presentation: 'modal' }} />
        <Stack.Screen name="groups" options={{ title: 'Группы номенклатуры' }} />
        <Stack.Screen name="import" options={{ title: 'Загрузка из Excel' }} />
        <Stack.Screen name="doc/[id]" options={{ title: 'Документ' }} />
        <Stack.Screen name="doc/allocate" options={{ title: 'Кому выдать' }} />
        <Stack.Screen name="upd/[id]" options={{ title: 'УПД' }} />
        <Stack.Screen name="ref/[kind]/[id]" options={{ title: 'Справочник' }} />
        <Stack.Screen name="documents" options={{ title: 'Документы' }} />
        <Stack.Screen name="history" options={{ title: 'История движений' }} />
        <Stack.Screen name="move" options={{ title: 'Перемещение' }} />
        <Stack.Screen name="custody/[id]" options={{ title: 'ТМЦ на руках' }} />
        <Stack.Screen name="return" options={{ title: 'Возврат ТМЦ' }} />
        <Stack.Screen name="users" options={{ title: 'Сотрудники' }} />
        <Stack.Screen name="user/[id]" options={{ title: 'Сотрудник' }} />
        <Stack.Screen name="departments" options={{ title: 'Отделы' }} />
        <Stack.Screen name="invites" options={{ title: 'Приглашения' }} />
        <Stack.Screen name="settings" options={{ title: 'Настройки' }} />
        <Stack.Screen name="devices" options={{ title: 'Подключение терминалов' }} />
      </Stack.Protected>
      {/* Ссылка-приглашение открывается всегда — даже без входа */}
      <Stack.Screen name="join/[token]" options={{ title: 'Приглашение' }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <BackendProvider>
        <StatusBar style="dark" />
        <RootStack />
      </BackendProvider>
    </SafeAreaProvider>
  );
}
