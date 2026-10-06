/** В браузере (рабочее место на ПК) настройки хранятся в localStorage. */
export const kv = {
  async get(key: string): Promise<string | null> {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  async set(key: string, value: string | null) {
    try {
      if (value === null) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, value);
    } catch {
      // приватный режим браузера — настройки живут до перезагрузки
    }
  },
};
