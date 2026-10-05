import { Stack } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { colors } from '../components/ui';
import { migrate } from '../db/schema';
import { AuthProvider, useAuth } from '../lib/auth-context';

function RootStack() {
  const { user, ready } = useAuth();
  if (!ready) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }
  return (
    <Stack
      screenOptions={{
        headerTintColor: colors.primary,
        headerTitleStyle: { color: colors.text },
        headerBackButtonDisplayMode: 'minimal',
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Protected guard={!user}>
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
        <Stack.Screen name="doc/[id]" options={{ title: 'Документ' }} />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SQLiteProvider databaseName="warehouse.db" onInit={migrate}>
        <AuthProvider>
          <StatusBar style="dark" />
          <RootStack />
        </AuthProvider>
      </SQLiteProvider>
    </SafeAreaProvider>
  );
}
