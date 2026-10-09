import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { colors } from '../../components/ui';
import { DbProvider } from '../lib/db';

/** PerformanceWarehouseLite: одно устройство, один пользователь (администратор), без входа и регистрации. */
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <DbProvider fallback={<View style={{ flex: 1, justifyContent: 'center', backgroundColor: colors.bg }}><ActivityIndicator size="large" /></View>}>
        <Stack screenOptions={{
          headerTintColor: colors.primary,
          headerTitleStyle: { color: colors.text },
          headerBackButtonDisplayMode: 'minimal',
          contentStyle: { backgroundColor: colors.bg },
        }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="item/[id]" options={{ title: 'Товар' }} />
          <Stack.Screen name="order/[id]" options={{ title: 'Ордер' }} />
          <Stack.Screen name="cell/[id]" options={{ title: 'Ячейка' }} />
          <Stack.Screen name="cells" options={{ title: 'Стеллажи и ячейки' }} />
          <Stack.Screen name="rack/[id]" options={{ title: 'Ряд' }} />
          <Stack.Screen name="move" options={{ title: 'Перемещение' }} />
          <Stack.Screen name="backup" options={{ title: 'Резервная копия' }} />
        </Stack>
      </DbProvider>
    </SafeAreaProvider>
  );
}
