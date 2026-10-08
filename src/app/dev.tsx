import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Button, Card, Empty, ListRow, Muted, Section, colors, notify, s, showError, useFocusLoad } from '../components/ui';
import { useApi, useBackend } from '../lib/backend';
import { remoteAuth } from '../lib/remote';

const mb = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} МБ` : `${Math.max(1, Math.round(b / 1024))} КБ`);

/** Раздел «Разработчик» — только администратор: сведения о базе, резервные копии. */
export default function DevScreen() {
  const api = useApi();
  const { mode, serverUrl, token } = useBackend();
  const [info] = useFocusLoad(() => api.devInfo(), [api]);
  const [backups, setBackups] = useState<{ dir: string; files: { name: string; size: number }[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const server = mode === 'server' && serverUrl && token;
  useFocusLoad(async () => {
    if (server) setBackups(await remoteAuth.backups(serverUrl!, token!));
    return null;
  }, [serverUrl, token]);

  async function backupNow() {
    if (!server) return;
    setBusy(true);
    try {
      const r = await remoteAuth.backups(serverUrl!, token!, true);
      setBackups(r);
      notify('Резервная копия создана', `${r.created}\nПапка: ${r.dir}`);
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      <Card>
        <Text style={{ fontSize: 17, fontWeight: '700', color: colors.text }}>База данных</Text>
        {info ? (
          <>
            <Muted>Версия схемы: {info.schemaVersion} · размер: {mb(info.sizeBytes)}</Muted>
            <View style={{ marginTop: 8 }}>
              {info.tables.map((t) => (
                <View key={t.name} style={{ flexDirection: 'row', paddingVertical: 3, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                  <Text style={{ flex: 1, color: colors.text }}>{t.label}</Text>
                  <Text style={{ color: colors.muted, fontFamily: 'monospace' }}>{t.name}</Text>
                  <Text style={{ width: 80, textAlign: 'right', color: colors.text, fontWeight: '600' }}>{t.rows}</Text>
                </View>
              ))}
            </View>
          </>
        ) : null}
      </Card>

      <Section title="Резервные копии">
        {server ? (
          <>
            <Muted>Сервер сам делает копию раз в сутки и хранит 30 последних. Папка: {backups?.dir ?? '…'}</Muted>
            <Button title="Сделать резервную копию сейчас" icon="⛁" busy={busy} onPress={backupNow} />
            <View style={{ borderRadius: 12, overflow: 'hidden' }}>
              {backups?.files.length ? backups.files.slice(0, 40).map((f) => (
                <ListRow key={f.name} title={f.name} right={mb(f.size)} />
              )) : <Empty text="Копий пока нет" />}
            </View>
            <Muted>Восстановление: остановите сервер, замените файл warehouse.db в папке данных копией и запустите сервер снова.</Muted>
          </>
        ) : <Muted>Резервные копии доступны при работе с сервером склада (ПК).</Muted>}
      </Section>
    </ScrollView>
  );
}
