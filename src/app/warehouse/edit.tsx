import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { ScrollView } from 'react-native';
import { Button, Field, s, showError } from '../../components/ui';
import * as repo from '../../db/repo';

export default function WarehouseEdit() {
  const db = useSQLiteContext();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [form, setForm] = useState({ code: '', name: '', address: '' });

  useEffect(() => {
    if (!id) return;
    repo.getWarehouse(db, Number(id)).then((w) => {
      if (w) setForm({ code: w.code, name: w.name, address: w.address ?? '' });
    });
  }, [db, id]);

  async function save() {
    try {
      await repo.saveWarehouse(db, { id: id ? Number(id) : undefined, ...form });
      router.back();
    } catch (e) {
      showError(e);
    }
  }

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <Field label="Код склада (коротко, печатается на этикетках) *" value={form.code} autoCapitalize="characters"
        placeholder="СКЛ1" onChangeText={(code) => setForm({ ...form, code })} />
      <Field label="Наименование *" value={form.name} placeholder="Основной склад"
        onChangeText={(name) => setForm({ ...form, name })} />
      <Field label="Адрес" value={form.address} onChangeText={(address) => setForm({ ...form, address })} />
      <Button title="Сохранить" onPress={save} />
    </ScrollView>
  );
}
