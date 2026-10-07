import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, Switch, Text, View } from 'react-native';
import { Button, Card, Field, Muted, colors, notify, s, showError } from '../components/ui';
import { useApi, useBackend } from '../lib/backend';

/** Настройки склада (только администратор). */
export default function SettingsScreen() {
  const api = useApi();
  const { settings, refreshSettings } = useBackend();
  const [form, setForm] = useState(settings);
  useEffect(() => setForm(settings), [settings]);

  async function save() {
    try {
      await api.saveSettings(form);
      await refreshSettings();
      notify('Сохранено');
    } catch (e) {
      showError(e);
    }
  }

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      <Card>
        <Field label="Название организации (полное, как в документах)" value={form.orgName} onChangeText={(v) => setForm({ ...form, orgName: v })} />
      </Card>
      <Card>
        <Text style={{ fontSize: 16, fontWeight: '600', color: colors.text, marginBottom: 6 }}>Реквизиты организаций</Text>
        <Muted>ИНН, КПП, адреса, банк, руководитель — в «Справочник → Организации». Оттуда они подставляются в УПД и договоры.</Muted>
        <Button title="Открыть «Организации»" variant="secondary"
          onPress={() => router.push({ pathname: '/items', params: { section: 'orgs' } })} />
      </Card>
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 16, fontWeight: '600', color: colors.text }}>Выдача ТМЦ под ответственность</Text>
            <Muted>
              Кладовщик и руководитель выдают ТМЦ сотрудникам и разнорабочим с инвентарными QR и возвратом.
              Выключено — доступно только «Списать».
            </Muted>
          </View>
          <Switch value={form.custodyEnabled} onValueChange={(v) => setForm({ ...form, custodyEnabled: v })} />
        </View>
      </Card>
      <Button title="Сохранить" onPress={save} />
    </ScrollView>
  );
}
