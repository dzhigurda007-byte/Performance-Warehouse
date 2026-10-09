/**
 * Две сборки из одного проекта:
 *  - по умолчанию — Performance Warehouse (полная версия: сервер, роли, задания);
 *  - APP_VARIANT=lite — PerformanceWarehouseLite: только телефон, база внутри телефона,
 *    отдельное приложение (свой пакет — ставится рядом с полной версией), экраны из src/lite/app.
 */
module.exports = ({ config }) => {
  if (process.env.APP_VARIANT !== 'lite') return config;
  return {
    ...config,
    name: 'PerformanceWarehouseLite',
    slug: 'performance-warehouse-lite',
    version: '1.1.0',
    scheme: 'pwlite',
    ios: { ...config.ios, bundleIdentifier: 'com.performance.warehouse.lite' },
    android: {
      ...config.android,
      package: 'com.performance.warehouse.lite',
      versionCode: 2,
    },
    plugins: config.plugins
      .filter((p) => !(Array.isArray(p) && p[0] === 'expo-build-properties'))
      .map((p) => (p === 'expo-router' ? ['expo-router', { root: './src/lite/app' }] : p)),
  };
};
