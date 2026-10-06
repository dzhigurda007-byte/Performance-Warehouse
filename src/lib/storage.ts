import Storage from 'expo-sqlite/kv-store';

/** Небольшое хранилище настроек подключения (на телефоне — SQLite key-value). */
export const kv = {
  get: (key: string) => Storage.getItemAsync(key),
  set: (key: string, value: string | null) => (value === null ? Storage.removeItemAsync(key) : Storage.setItemAsync(key, value)),
};
