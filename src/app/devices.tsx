import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { QrView } from '../components/QrView';
import { Button, Card, Empty, Muted, colors, s, showError, useFocusLoad } from '../components/ui';
import { serverQr } from '../core/codes';
import { useBackend } from '../lib/backend';
import { remoteAuth, type ServerInfo } from '../lib/remote';

/** QR-код сервера для подключения ТСД и телефонов по Wi-Fi + диагностика сети. */
export default function DevicesScreen() {
  const { serverUrl, token } = useBackend();
  const [loaded] = useFocusLoad(() => (serverUrl && token ? remoteAuth.info(serverUrl, token) : Promise.resolve(null)), [serverUrl, token]);
  const [fresh, setFresh] = useState<ServerInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const info = fresh ?? loaded;
  if (!info) return <Empty text="Загрузка…" />;
  const urls = info.urls.length ? info.urls : serverUrl ? [serverUrl] : [];

  async function recheck() {
    if (!serverUrl || !token) return;
    setBusy(true);
    try {
      setFresh(await remoteAuth.info(serverUrl, token, true));
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      {info.problems?.length ? (
        <Card style={{ backgroundColor: colors.dangerSoft, borderColor: colors.danger }}>
          <Text style={{ fontWeight: '700', color: colors.danger, fontSize: 16 }}>Терминалы не смогут подключиться</Text>
          {info.problems.map((p) => <Text key={p} style={{ color: colors.text, marginTop: 6 }}>{p}</Text>)}
          <Text style={{ color: colors.text, marginTop: 10, fontWeight: '600' }}>Как исправить (WireGuard):</Text>
          <Text style={{ color: colors.text }}>
            1. WireGuard → выберите туннель → «Редактировать».{'\n'}
            2. В строке AllowedIPs уберите все диапазоны 192.168.… (локальная сеть склада).{'\n'}
            3. «Сохранить», переподключите туннель и нажмите «Проверить сеть снова».
          </Text>
          <Text style={{ color: colors.text, marginTop: 6 }}>
            Без изменения VPN: переведите Wi-Fi-роутер склада на подсеть 172.16.x.x или 10.x.x.x (кроме 10.8.x.x) —
            такие адреса ваш VPN не перехватывает.
          </Text>
        </Card>
      ) : (
        <Card style={{ backgroundColor: colors.successSoft }}>
          <Text style={{ color: colors.success, fontWeight: '600' }}>Сеть в порядке: локальная сеть не перехвачена VPN.</Text>
        </Card>
      )}
      <Button title="Проверить сеть снова" variant="ghost" busy={busy} onPress={recheck} />

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
      {info.vpnUrls?.length ? (
        <Muted>Адреса VPN (для терминалов не подходят): {info.vpnUrls.join(', ')}</Muted>
      ) : null}
      <View style={{ marginTop: 8 }}>
        <Text style={{ color: colors.muted }}>Версия сервера: {info.version}</Text>
        <Text style={{ color: colors.muted }}>Папка данных: {info.dataDir}</Text>
        <Text style={{ color: colors.muted }}>Резервные копии: {info.dataDir}/backups (раз в сутки, 30 последних)</Text>
      </View>
    </ScrollView>
  );
}
