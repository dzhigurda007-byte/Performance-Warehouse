import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { ActionMenu } from '../../components/ActionMenu';
import { Chips } from '../../components/Chips';
import { FormMenu, type FormJob } from '../../components/FormMenu';
import { Button, Card, Field, Muted, Section, colors, notify, s, showError, useFocusLoad } from '../../components/ui';
import { formatQty } from '../../core/codes';
import { VAT_LABEL, VAT_RATES, money, updProblems, updTotals, type UpdData, type UpdParty } from '../../core/upd';
import { useApi, useBackend } from '../../lib/backend';
import { updForm, type UpdSeller } from '../../lib/updForm';
import { PartyPicker } from '../../components/ref/PartyPicker';
import { contractTitle, type Contract, type Counterparty, type Organization } from '../../core/refs';

/** Реквизиты продавца из справочника «Организации». */
const orgToSeller = (o: Organization): UpdSeller => ({
  name: String(o.name ?? ''), inn: String(o.inn ?? ''), kpp: String(o.kpp ?? ''),
  address: String(o.legal_address ?? o.actual_address ?? ''), director: String(o.director ?? ''), accountant: String(o.accountant ?? ''),
});

const ru = (s: string) => (/^\d{4}-\d{2}-\d{2}/.test(s) ? `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}` : s);
/** «1 200,50» → 1200.5; пусто или ошибка → 0. */
const parseMoney = (v: string) => {
  const n = Number(v.replace(/[\s\u00a0₽]/g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
};
const iso = (s: string) => {
  const m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(s.trim());
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : s.trim();
};

/** УПД по расходному ордеру: покупатель, цены, НДС → печать / PDF. */
export default function UpdScreen() {
  const api = useApi();
  const { settings } = useBackend();
  const id = Number(useLocalSearchParams<{ id: string }>().id);
  const [loaded] = useFocusLoad(() => api.getUpd(id), [api, id]);
  const [d, setD] = useState<UpdData | null>(null);
  const [prices, setPrices] = useState<Record<number, string>>({});
  const [dates, setDates] = useState({ date: '', ship: '' });
  const [busy, setBusy] = useState(false);
  const [formJob, setFormJob] = useState<FormJob | null>(null);
  const [buyers, setBuyers] = useState<UpdParty[] | null>(null);
  const [orgs] = useFocusLoad(() => api.listOrgs(), [api]);
  const [pickParty, setPickParty] = useState(false);
  const [contracts, setContracts] = useState<Contract[] | null>(null);

  useEffect(() => {
    if (!loaded) return;
    setD(loaded.data);
    setPrices(Object.fromEntries(loaded.data.lines.map((l) => [l.item_id, l.price ? String(l.price).replace('.', ',') : ''])));
    setDates({ date: ru(loaded.data.date), ship: ru(loaded.data.shipDate) });
  }, [loaded]);

  /** Текущие данные формы (цены и даты из полей ввода). */
  const current = useMemo<UpdData | null>(() => d && {
    ...d,
    date: iso(dates.date),
    shipDate: iso(dates.ship),
    lines: d.lines.map((l) => ({ ...l, price: parseMoney(prices[l.item_id] ?? '') })),
  }, [d, prices, dates]);
  const totals = useMemo(() => (current ? updTotals(current) : null), [current]);

  if (!loaded || !d || !current || !totals) return null;
  // продавец: выбранная в УПД организация, иначе организация по умолчанию, иначе прежние реквизиты из настроек
  const sellerOrg = orgs?.find((o) => o.id === d.sellerOrgId) ?? orgs?.[0];
  const seller: UpdSeller = sellerOrg ? orgToSeller(sellerOrg) : {
    name: settings.orgName, inn: settings.orgInn, kpp: settings.orgKpp, address: settings.orgAddress,
    director: settings.orgDirector, accountant: settings.orgAccountant,
  };

  /** Покупатель из справочника контрагентов; договор с ним — основанием передачи. */
  async function choosePartyAsBuyer(c: Counterparty) {
    const next: UpdData = {
      ...d!, buyerPartyId: c.id,
      buyer: { name: String(c.name), inn: String(c.inn ?? ''), kpp: String(c.kpp ?? ''), address: String(c.address ?? c.actual_address ?? '') },
    };
    setD(next);
    try {
      const list = await api.listContracts({ counterpartyId: c.id });
      if (list.length === 1) setD({ ...next, contractId: list[0].id, basis: contractTitle(list[0]) });
      else if (list.length > 1) setTimeout(() => setContracts(list), 300);
    } catch (e) {
      showError(e);
    }
  }

  async function chooseContract() {
    try {
      const list = await api.listContracts({ counterpartyId: d!.buyerPartyId ?? null });
      if (!list.length) return notify('Договоров нет', 'Добавьте договор: Справочник → Договоры');
      setContracts(list);
    } catch (e) {
      showError(e);
    }
  }
  const problems = updProblems(current, seller);
  const set = (patch: Partial<UpdData>) => setD({ ...d, ...patch });
  const setBuyer = (patch: Partial<UpdParty>) => setD({ ...d, buyer: { ...d.buyer, ...patch } });

  async function save(): Promise<boolean> {
    setBusy(true);
    try {
      await api.saveUpd(id, current!);
      return true;
    } catch (e) {
      showError(e);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function print() {
    if (!(await save())) return;
    const data = current!;
    setFormJob({
      title: `УПД № ${data.number}`,
      subtitle: problems.length ? `Внимание: ${problems.join('; ')}` : 'Альбомный лист A4',
      variants: [{ build: (ctx) => updForm(loaded!.doc, { ...data, sellerOrgId: sellerOrg?.id ?? null }, seller, ctx) }],
    });
  }

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <Card>
        <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text }}>УПД по расходному ордеру {loaded.doc.number}</Text>
        <Muted>{loaded.saved ? 'Сохранён — можно изменить и напечатать заново' : 'Новый — заполните покупателя и цены'}</Muted>
        <Text style={[s.label, { marginTop: 8 }]}>Статус</Text>
        <Chips value={d.status} onChange={(v) => set({ status: v })} options={[
          { value: 1 as const, label: '1 — счёт-фактура и передаточный' },
          { value: 2 as const, label: '2 — только передаточный' },
        ]} />
        <View style={s.rowWrap}>
          <View style={{ flex: 1 }}><Field label="Номер" value={d.number} onChangeText={(v) => set({ number: v })} /></View>
          <View style={{ flex: 1 }}><Field label="Дата (ДД.ММ.ГГГГ)" value={dates.date} onChangeText={(v) => setDates({ ...dates, date: v })} /></View>
        </View>
      </Card>

      <Card>
        <Text style={{ fontWeight: '700', color: colors.text }}>Продавец / грузоотправитель</Text>
        {orgs && orgs.length > 1 ? (
          <Chips value={sellerOrg?.id ?? 0} onChange={(v) => set({ sellerOrgId: v })}
            options={orgs.map((o) => ({ value: o.id, label: String(o.short_name || o.name) }))} />
        ) : null}
        {seller.name ? (
          <Muted>{seller.name}{seller.inn ? ` · ИНН/КПП ${[seller.inn, seller.kpp].filter(Boolean).join('/')}` : ''}{seller.address ? `\n${seller.address}` : ''}</Muted>
        ) : <Text style={{ color: colors.danger }}>Нет реквизитов: добавьте свою организацию в «Справочник → Организации»</Text>}
      </Card>

      <Card>
        <Text style={{ fontWeight: '700', color: colors.text }}>Покупатель</Text>
        <View style={s.rowWrap}>
          <Button title="Из контрагентов" variant="secondary" style={{ flex: 1 }} onPress={() => setPickParty(true)} />
          <Button title="Из прошлых УПД" variant="ghost" style={{ flex: 1 }}
            onPress={() => api.updBuyers().then((b) => (b.length ? setBuyers(b) : notify('Пока нет', 'Сохранённых покупателей ещё нет'))).catch(showError)} />
        </View>
        <Field label="Наименование" value={d.buyer.name} onChangeText={(v) => setBuyer({ name: v })} />
        <View style={s.rowWrap}>
          <View style={{ flex: 1 }}><Field label="ИНН" value={d.buyer.inn} keyboardType="number-pad" maxLength={12} onChangeText={(v) => setBuyer({ inn: v })} /></View>
          <View style={{ flex: 1 }}><Field label="КПП" value={d.buyer.kpp} keyboardType="number-pad" maxLength={9} onChangeText={(v) => setBuyer({ kpp: v })} /></View>
        </View>
        <Field label="Адрес" value={d.buyer.address} multiline onChangeText={(v) => setBuyer({ address: v })} />
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ color: colors.text, flex: 1 }}>Грузополучатель — он же</Text>
          <Switch value={d.consigneeSame} onValueChange={(v) => set({ consigneeSame: v })} />
        </View>
        {!d.consigneeSame ? (
          <>
            <Field label="Грузополучатель" value={d.consignee.name} onChangeText={(v) => set({ consignee: { ...d.consignee, name: v } })} />
            <Field label="Адрес грузополучателя" value={d.consignee.address} onChangeText={(v) => set({ consignee: { ...d.consignee, address: v } })} />
          </>
        ) : null}
      </Card>

      <Card>
        <Field label="Основание передачи (договор, заказ)" value={d.basis} onChangeText={(v) => set({ basis: v, contractId: null })} />
        <Button title={d.buyerPartyId ? 'Выбрать договор с покупателем' : 'Выбрать договор из справочника'} variant="ghost" onPress={chooseContract} />
        <Field label="К платёжно-расчётному документу № … от …" value={d.paymentDoc} onChangeText={(v) => set({ paymentDoc: v })} />
        <View style={s.rowWrap}>
          <View style={{ flex: 1 }}><Field label="Дата отгрузки" value={dates.ship} onChangeText={(v) => setDates({ ...dates, ship: v })} /></View>
        </View>
        <View style={s.rowWrap}>
          <View style={{ flex: 1 }}><Field label="Товар передал (ФИО)" value={d.passedBy} onChangeText={(v) => set({ passedBy: v })} /></View>
          <View style={{ flex: 1 }}><Field label="Товар получил (ФИО)" value={d.receivedBy} onChangeText={(v) => set({ receivedBy: v })} /></View>
        </View>
      </Card>

      <Card>
        <Text style={s.label}>Ставка НДС</Text>
        <Chips value={d.vat} onChange={(v) => set({ vat: v })} options={VAT_RATES.map((r) => ({ value: r, label: VAT_LABEL[String(r)] }))} />
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ color: colors.text, flex: 1 }}>Цены указаны с НДС</Text>
          <Switch value={d.priceWithVat} disabled={d.vat === 'none' || d.vat === 0} onValueChange={(v) => set({ priceWithVat: v })} />
        </View>
      </Card>

      <Section title={`Товары · ${d.lines.length} поз.`}>
        <View style={{ borderRadius: 12, overflow: 'hidden' }}>
          {totals.rows.map((r, i) => (
            <View key={r.item_id} style={[s.row, { alignItems: 'center' }]}>
              <View style={{ flex: 1 }}>
                <Text style={s.rowTitle}>{i + 1}. {r.name}</Text>
                <Text style={s.rowSub}>{r.sku} · {formatQty(r.qty)} {r.unit}{r.okei ? ` (ОКЕИ ${r.okei})` : ''} · сумма {money(r.sumGross)}{d.vat !== 'none' ? `, НДС ${money(r.vatSum)}` : ''}</Text>
              </View>
              <TextInput value={prices[r.item_id] ?? ''} onChangeText={(v) => setPrices({ ...prices, [r.item_id]: v })}
                placeholder="цена" placeholderTextColor={colors.muted} keyboardType="decimal-pad"
                style={[s.input, { width: 110, minWidth: 0, textAlign: 'right' }, !(r.price > 0) && { borderColor: colors.danger }]} />
            </View>
          ))}
        </View>
        <Card style={{ marginTop: 8 }}>
          <Text style={{ color: colors.text }}>Без НДС: <Text style={{ fontWeight: '700' }}>{money(totals.sumNet)}</Text></Text>
          <Text style={{ color: colors.text }}>НДС ({VAT_LABEL[String(d.vat)]}): <Text style={{ fontWeight: '700' }}>{d.vat === 'none' ? 'без НДС' : money(totals.vatSum)}</Text></Text>
          <Text style={{ color: colors.text, fontSize: 16 }}>Всего к оплате: <Text style={{ fontWeight: '700' }}>{money(totals.sumGross)} ₽</Text></Text>
        </Card>
      </Section>

      {problems.length ? (
        <Card style={{ backgroundColor: colors.warnSoft }}>
          {problems.map((p) => <Text key={p} style={{ color: colors.text }}>• {p}</Text>)}
        </Card>
      ) : null}

      <Button title="Печать / PDF УПД" icon="⎙" busy={busy} onPress={print} />
      <Button title="Сохранить" variant="secondary" busy={busy}
        onPress={() => save().then((ok) => ok && notify('Сохранено', 'Цены запомнены для следующих УПД'))} />
      <Button title="К расходному ордеру" variant="ghost" onPress={() => router.back()} />

      <FormMenu job={formJob} onClose={() => setFormJob(null)} />
      <PartyPicker visible={pickParty} onClose={() => setPickParty(false)} onPick={(c) => { setPickParty(false); choosePartyAsBuyer(c); }} />
      <ActionMenu visible={contracts !== null} title="Договор — основание передачи" onClose={() => setContracts(null)}
        actions={(contracts ?? []).map((c) => ({
          label: `${contractTitle(c)}${c.party_name && !d.buyerPartyId ? ` · ${c.party_name}` : ''}`,
          onPress: () => set({ contractId: c.id, basis: contractTitle(c) }),
        }))} />
      <ActionMenu visible={buyers !== null} title="Покупатель из прошлых УПД" onClose={() => setBuyers(null)}
        actions={(buyers ?? []).map((b) => ({
          label: `${b.name}${b.inn ? ` · ИНН ${b.inn}` : ''}`,
          onPress: () => setBuyer(b),
        }))} />
    </ScrollView>
  );
}
