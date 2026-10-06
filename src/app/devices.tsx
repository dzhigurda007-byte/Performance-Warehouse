import { ScrollView, Text, View } from 'react-native';
import { QrView } from '../components/QrView';
import { Card, Empty, Muted, colors, s, useFocusLoad } from '../components/ui';
import { serverQr } from '../core/codes';
import { useBackend } from '../lib/backend';
import { remoteAuth } from '../lib/remote';

/** QR-код сервера для подключения ТСД и телефонов по Wi-Fi. */
export default function DevicesScreen() {
  const { serverUrl, token } = useBackend();
  const [info] = useFocusLoad(() => (serverUrl && token ? remoteAuth.info(serverUrl, token) : Promise.resolve(null)), [serverUrl, token]);
  if (!info) return <Empty text="Загрузка…" />;
  const urls = info.urls.length ? info.urls : serverUrl ? [serverUrl] : [];
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      <Muted>
        На терминале: «Сервер склада (ПК)» → «Сканировать QR с экрана ПК». Терминал и ПК должны быть в одной сети Wi-Fi.
        Если сеть блокирует поиск, введите адрес вручную.
      </Muted>
      {urls.map((u) => (
        <Card key={u} style={{ alignItems: 'center' }}>
          <Text style={{ fontWeight: '700', color: colors.text }}>Подключить терминал</Text>
          <QrView value={serverQr(u)} size={220} caption={u} />
        </Card>
      ))}
      {urls[0] ? (
        <Card style={{ alignItems: 'center' }}>
          <Text style={{ fontWeight: '700', color: colors.text }}>Скачать приложение для Android</Text>
          <QrView value={`${urls[0]}/download/PerformanceWarehouse.apk`} size={180} />
          <Muted>Отсканируйте камерой телефона — APK скачается прямо с этого ПК.</Muted>
        </Card>
      ) : null}
      <View style={{ marginTop: 8 }}>
        <Text style={{ color: colors.muted }}>Версия сервера: {info.version}</Text>
        <Text style={{ color: colors.muted }}>Папка данных: {info.dataDir}</Text>
        <Text style={{ color: colors.muted }}>Резервные копии: {info.dataDir}/backups (раз в сутки, 30 последних)</Text>
      </View>
    </ScrollView>
  );
}
