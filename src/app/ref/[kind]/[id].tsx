import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { Chips } from '../../../components/Chips';
import {
  Badge, Button, Card, Empty, Field, ListRow, Muted, Section, colors, confirm, notify, s, showError, useFocusLoad,
} from '../../../components/ui';
import {
  FIELDS, KIND_TITLE, contractTitle, isoToRu, type Counterparty, type FieldSpec, type RefKind, type RefRecord,
} from '../../../core/refs';
import { money } from '../../../core/upd';
import { useApi, usePerms } from '../../../lib/backend';
import { PartyPicker, partyDetails } from '../../../components/ref/PartyPicker';

const KINDS: RefKind[] = ['org', 'legal', 'person', 'contract'];

/** Значение поля для формы: даты — ДД.ММ.ГГГГ, суммы — с запятой. */
function toInput(f: FieldSpec, v: unknown): string {
  if (v === null || v === undefined) return '';
  if (f.type === 'date') return isoToRu(String(v));
  if (f.type === 'money') return String(v).replace('.', ',');
  return String(v);
}

/** Карточка записи справочника: своя организация, юр. лицо, физ. лицо или договор. */
export default function RefCard() {
  const api = useApi();
  const p = usePerms();
  const params = useLocalSearchParams<{ kind: string; id: string; party?: string }>();
  const kind = (KINDS.includes(params.kind as RefKind) ? params.kind : 'legal') as RefKind;
  const isNew = params.id === 'new';
  const id = isNew ? undefined : Number(params.id);
  const editable = p.manageItems;

  const [form, setForm] = useState<Record<string, string>>({});
  const [isDefault, setIsDefault] = useState(false);
  const [orgId, setOrgId] = useState<number | null>(null);
  const [party, setParty] = useState<Counterparty | null>(null);
  const [pickParty, setPickParty] = useState(false);
  const [busy, setBusy] = useState(false);

  const [loaded] = useFocusLoad(async () => {
    const rec: RefRecord | null = isNew ? null
      : kind === 'org' ? await api.getOrg(id!)
        : kind === 'contract' ? await api.getContract(id!)
          : await api.getParty(id!);
    const orgs = kind === 'contract' ? await api.listOrgs() : [];
    const contracts = (kind === 'legal' || kind === 'person') && id ? await api.listContracts({ counterpartyId: id }) : [];
    return { rec, orgs, contracts };
  }, [api, kind, id]);

  useEffect(() => {
    if (!loaded) return;
    const rec = loaded.rec;
    setForm(Object.fromEntries(FIELDS[kind].map((f) => [f.key, toInput(f, rec?.[f.key])])));
    setIsDefault(!!rec?.is_default);
    if (kind === 'contract') {
      setOrgId((rec?.org_id as number | null) ?? loaded.orgs[0]?.id ?? null);
      const pid = (rec?.counterparty_id as number | null) ?? (params.party ? Number(params.party) : null);
      if (pid) api.getParty(pid).then(setParty).catch(showError);
    }
  }, [loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!loaded || (!isNew && !loaded.rec)) return null;

  async function save() {
    setBusy(true);
    try {
      const data: RefRecord = { ...form, id };
      if (kind === 'org') await api.saveOrg({ ...data, is_default: isDefault ? 1 : 0 });
      else if (kind === 'contract') await api.saveContract({ ...data, org_id: orgId, counterparty_id: party?.id ?? null });
      else await api.saveParty(kind, data);
      notify('Сохранено');
      router.back();
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  }

  function remove() {
    confirm(`Удалить: ${KIND_TITLE[kind].toLowerCase()}?`, form.name || form.number || '', async () => {
      try {
        if (kind === 'org') await api.deleteOrg(id!);
        else if (kind === 'contract') await api.deleteContract(id!);
        else await api.deleteParty(id!);
        router.back();
      } catch (e) {
        showError(e);
      }
    }, 'Удалить');
  }

  // поля по группам; «half» — по два в строку
  const groups: { title?: string; rows: FieldSpec[][] }[] = [];
  for (const f of FIELDS[kind]) {
    if (f.section || !groups.length) groups.push({ title: f.section, rows: [] });
    const g = groups[groups.length - 1];
    const last = g.rows[g.rows.length - 1];
    if (f.half && last && last.length === 1 && last[0].half) last.push(f);
    else g.rows.push([f]);
  }

  const fieldEl = (f: FieldSpec) => (
    <Field key={f.key} label={`${f.label}${f.required ? ' *' : ''}`} value={form[f.key] ?? ''} editable={editable}
      placeholder={f.hint ?? (f.type === 'date' ? 'ДД.ММ.ГГГГ' : undefined)}
      multiline={f.type === 'multiline'}
      keyboardType={f.type === 'digits' ? 'number-pad' : f.type === 'money' ? 'decimal-pad' : f.type === 'phone' ? 'phone-pad'
        : f.type === 'email' ? 'email-address' : 'default'}
      autoCapitalize={f.type === 'email' ? 'none' : 'sentences'}
      maxLength={f.type === 'digits' && f.len ? Math.max(...f.len) : undefined}
      onChangeText={(v) => setForm((c) => ({ ...c, [f.key]: v }))} />
  );

  const title = isNew ? `Новое: ${KIND_TITLE[kind].toLowerCase()}` : KIND_TITLE[kind];

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title }} />
      <ScrollView style={s.screen} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        {kind === 'contract' ? (
          <Card>
            <Text style={{ fontWeight: '700', color: colors.text, marginBottom: 6 }}>Стороны договора</Text>
            <Text style={s.label}>Наша организация</Text>
            {loaded.orgs.length ? (
              <Chips value={orgId ?? 0} onChange={(v) => editable && setOrgId(v)}
                options={loaded.orgs.map((o) => ({ value: o.id as number, label: String(o.short_name || o.name) }))} />
            ) : (
              <Pressable onPress={() => router.push({ pathname: '/ref/[kind]/[id]', params: { kind: 'org', id: 'new' } })}>
                <Text style={{ color: colors.danger, marginBottom: 8 }}>Нет организаций — добавьте в «Справочник → Организации» ›</Text>
              </Pressable>
            )}
            <Text style={s.label}>Контрагент (юр. или физ. лицо)</Text>
            {party ? (
              <View style={{ borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 10, marginBottom: 6 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={{ fontWeight: '600', color: colors.text, flex: 1 }}>{party.name}</Text>
                  <Badge text={party.kind === 'person' ? 'физ. лицо' : 'юр. лицо'} tone="primary" />
                </View>
                <Muted>{partyDetails(party)}</Muted>
              </View>
            ) : <Muted>не выбран</Muted>}
            {editable ? <Button title={party ? 'Сменить контрагента' : 'Выбрать контрагента'} variant="secondary" onPress={() => setPickParty(true)} /> : null}
          </Card>
        ) : null}

        {groups.map((g, gi) => (
          <Card key={gi}>
            {g.title ? <Text style={{ fontWeight: '700', color: colors.text, marginBottom: 6 }}>{g.title}</Text> : null}
            {g.rows.map((row, ri) => (row.length === 2 ? (
              <View key={ri} style={s.rowWrap}>
                {row.map((f) => <View key={f.key} style={{ flex: 1 }}>{fieldEl(f)}</View>)}
              </View>
            ) : fieldEl(row[0])))}
          </Card>
        ))}

        {kind === 'org' ? (
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={{ color: colors.text, flex: 1 }}>Организация по умолчанию (продавец в УПД)</Text>
              <Switch value={isDefault} disabled={!editable} onValueChange={setIsDefault} />
            </View>
          </Card>
        ) : null}

        {(kind === 'legal' || kind === 'person') && !isNew ? (
          <Section title={`Договоры · ${loaded.contracts.length}`}>
            <View style={{ borderRadius: 12, overflow: 'hidden' }}>
              {loaded.contracts.length ? loaded.contracts.map((c) => (
                <ListRow key={c.id} title={contractTitle(c)}
                  subtitle={`${c.org_name ?? ''}${c.valid_until ? ` · до ${isoToRu(String(c.valid_until))}` : ''}${c.amount ? ` · ${money(Number(c.amount))} ₽` : ''}`}
                  onPress={() => router.push({ pathname: '/ref/[kind]/[id]', params: { kind: 'contract', id: String(c.id) } })} />
              )) : <Empty text="Договоров нет" />}
            </View>
            {editable ? (
              <Button title="Новый договор с контрагентом" icon="+" variant="secondary"
                onPress={() => router.push({ pathname: '/ref/[kind]/[id]', params: { kind: 'contract', id: 'new', party: String(id) } })} />
            ) : null}
          </Section>
        ) : null}

        {editable ? <Button title="Сохранить" busy={busy} onPress={save} /> : <Muted>Изменять справочник могут руководитель и администратор.</Muted>}
        {editable && !isNew ? <Button title="Удалить" variant="danger" onPress={remove} /> : null}
      </ScrollView>
      <PartyPicker visible={pickParty} onClose={() => setPickParty(false)} onPick={(c) => { setPickParty(false); setParty(c); }} />
    </View>
  );
}
