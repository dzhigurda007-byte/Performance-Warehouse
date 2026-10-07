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
        <Text style={{ fontSize: 16, fontWeight: '600', color: colors.text, marginBottom: 6 }}>Реквизиты для УПД (продавец)</Text>
        <View style={s.rowWrap}>
          <View style={{ flex: 1 }}>
            <Field label="ИНН" value={form.orgInn} keyboardType="number-pad" maxLength={12} onChangeText={(v) => setForm({ ...form, orgInn: v })} />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="КПП" value={form.orgKpp} keyboardType="number-pad" maxLength={9} onChangeText={(v) => setForm({ ...form, orgKpp: v })} />
          </View>
        </View>
        <Field label="Адрес" value={form.orgAddress} multiline onChangeText={(v) => setForm({ ...form, orgAddress: v })} />
        <Field label="Руководитель (ФИО)" value={form.orgDirector} onChangeText={(v) => setForm({ ...form, orgDirector: v })} />
        <Field label="Главный бухгалтер (ФИО)" value={form.orgAccountant} onChangeText={(v) => setForm({ ...form, orgAccountant: v })} />
        <Muted>Подставляются в УПД по расходному ордеру. Для ИП — ИНН из 12 цифр, КПП не заполняется.</Muted>
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
