import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Chips } from '../../components/Chips';
import { Scanner } from '../../components/Scanner';
import { Badge, Button, Empty, Muted, SearchBox, Section, colors, s, useFocusLoad } from '../../components/ui';
import { formatQty } from '../../core/codes';
import { CONDITION_LABEL, CUSTODY_STATUS_LABEL, type CustodyRow, type CustodyStatus } from '../../core/types';
import { useApi, useBackend, usePerms } from '../../lib/backend';
import { FormMenu, type FormJob } from '../../components/FormMenu';
import { custodyListForm } from '../../lib/docForms';

type Tab = 'mine' | 'issued' | 'team';

const STATUS_TONE: Record<CustodyStatus, 'warn' | 'primary' | 'success' | 'danger' | 'muted'> = {
  held: 'warn',
  returned: 'primary',
  closed: 'success',
  written_off: 'danger',
  lost: 'danger',
};

/**
 * Личный кабинет выдачи ТМЦ:
 *  «Мои ТМЦ» — что числится на мне (вернуть);
 *  «Выдано мной» — кому, что, сколько и когда я выдал, факты возврата;
 *  «Команда» — то же по подчинённым (для руководителя).
 */
export default function CustodyScreen() {
  const api = useApi();
  const { user } = useBackend();
  const p = usePerms();
  const [tab, setTab] = useState<Tab>(p.operate ? 'issued' : 'mine');
  const [activeOnly, setActiveOnly] = useState(true);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<number[]>([]);
  const [scan, setScan] = useState(false);
  const [formJob, setFormJob] = useState<FormJob | null>(null);

  const [rows] = useFocusLoad(async () => {
    setSelected([]);
    if (tab === 'mine') return api.myCustody(activeOnly);
    return api.issuedCustody({ scope: tab === 'team' ? 'team' : 'mine', active: activeOnly });
  }, [api, tab, activeOnly]);
  const [pending] = useFocusLoad(() => (p.operate ? api.pendingReturnReceipts() : Promise.resolve([])), [api, p.operate]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (rows ?? []).filter((k) => !t || `${k.item_name} ${k.sku} ${k.holder_name} ${k.code} ${k.issued_by_name}`.toLowerCase().includes(t));
  }, [rows, q]);

  const groups = useMemo(() => {
    const m = new Map<string, CustodyRow[]>();
    for (const k of filtered) {
      const key = tab === 'mine' ? `${k.issue_doc_number} · выдал ${k.issued_by_name}` : k.holder_name;
      m.set(key, [...(m.get(key) ?? []), k]);
    }
    return [...m.entries()];
  }, [filtered, tab]);

  const toggle = (id: number) => setSelected((s0) => (s0.includes(id) ? s0.filter((x) => x !== id) : [...s0, id]));
  const held = filtered.filter((k) => k.status === 'held');

  return (
    <View style={{ flex: 1 }}>
      <ScrollView style={s.screen} contentContainerStyle={[s.content, { paddingBottom: 110 }]}>
        <Chips value={tab} onChange={(t) => setTab(t)} options={[
          { value: 'mine' as Tab, label: 'Мои ТМЦ' },
          ...(p.operate ? [{ value: 'issued' as Tab, label: 'Выдано мной' }] : []),
          ...(p.viewTeam ? [{ value: 'team' as Tab, label: 'Команда' }] : []),
        ]} />
        <Chips value={activeOnly} onChange={setActiveOnly} options={[
          { value: true, label: 'На руках' },
          { value: false, label: 'Вся история' },
        ]} />
        <SearchBox value={q} onChangeText={setQ} placeholder="ТМЦ, сотрудник, инвентарный №" />
        {filtered.length ? (
          <Button title="Печать списка" icon="⎙" variant="ghost" onPress={() => {
            const title = tab === 'mine' ? 'ТМЦ на руках' : tab === 'team' ? 'ТМЦ, выданные команде' : 'ТМЦ, выданные под ответственность';
            setFormJob({ title, variants: [{ build: (ctx) => custodyListForm(filtered, title, {
              ...ctx, subtitle: `${tab === 'mine' ? `Сотрудник: ${user?.full_name ?? ''}` : `Выдал: ${user?.full_name ?? ''}`} · ${activeOnly ? 'только на руках' : 'вся история'}${q.trim() ? ` · отбор «${q.trim()}»` : ''}`,
            }) }] });
          }} />
        ) : null}

        {pending && pending.length ? (
          <Section title="Возвраты ждут проведения">
            <View style={{ borderRadius: 12, overflow: 'hidden' }}>
              {pending.map((r) => (
                <Pressable key={r.id} style={s.row} onPress={() => router.push({ pathname: '/doc/[id]', params: { id: String(r.id) } })}>
                  <Badge text="↩" tone="warn" />
                  <View style={{ flex: 1 }}>
                    <Text style={s.rowTitle}>{r.number} · по {r.base_doc_number}</Text>
                    <Text style={s.rowSub}>Выдавал: {r.issuer_name} · строк: {r.lines}</Text>
                  </View>
                  <Text style={s.rowRight}>›</Text>
                </Pressable>
              ))}
            </View>
          </Section>
        ) : null}

        {groups.length ? groups.map(([title, list]) => (
          <Section key={title} title={`${title} · ${list.length}`}>
            <View style={{ borderRadius: 12, overflow: 'hidden' }}>
              {list.map((k) => {
                const on = selected.includes(k.id);
                const canSelect = k.status === 'held';
                return (
                  <Pressable key={k.id} style={[s.row, on && { backgroundColor: colors.primarySoft }]}
                    onPress={() => router.push({ pathname: '/custody/[id]', params: { id: String(k.id) } })}
                    onLongPress={canSelect ? () => toggle(k.id) : undefined}>
                    {canSelect ? (
                      <Pressable hitSlop={10} onPress={() => toggle(k.id)}>
                        <Text style={{ fontSize: 22, color: on ? colors.primary : colors.muted }}>{on ? '☑' : '☐'}</Text>
                      </Pressable>
                    ) : <View style={{ width: 22 }} />}
                    <View style={{ flex: 1 }}>
                      <Text style={s.rowTitle}>{k.item_name} · {formatQty(k.qty)} {k.unit}</Text>
                      <Text style={s.rowSub}>
                        {k.code} · {k.issued_at.slice(0, 16)}
                        {tab === 'team' ? ` · выдал ${k.issued_by_name}` : ''}
                        {k.returned_at ? `\nвозврат ${k.returned_at.slice(0, 16)} (${k.returned_by_name}) · ${CONDITION_LABEL[k.return_condition ?? 'ok']}${k.return_comment ? ` · «${k.return_comment}»` : ''}` : ''}
                      </Text>
                    </View>
                    <Badge text={CUSTODY_STATUS_LABEL[k.status]} tone={STATUS_TONE[k.status]} />
                  </Pressable>
                );
              })}
            </View>
          </Section>
        )) : <Empty text={tab === 'mine' ? 'На вас ничего не числится' : 'Выдач нет'} />}
        {user ? <Muted>Отметьте ☐ ТМЦ для возврата или откройте карточку. Инвентарный QR можно отсканировать.</Muted> : null}
      </ScrollView>

      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 12, paddingBottom: 28, flexDirection: 'row', gap: 8,
        backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border }}>
        <Button title="Скан QR" icon="⌗" variant="secondary" style={{ flex: 1 }} onPress={() => setScan(true)} />
        {selected.length ? (
          <Button title={`Вернуть (${selected.length})`} variant="success" style={{ flex: 2 }}
            onPress={() => router.push({ pathname: '/return', params: { ids: selected.join(',') } })} />
        ) : (
          <Button title="Выбрать всё на руках" variant="ghost" style={{ flex: 2 }} disabled={!held.length}
            onPress={() => setSelected(held.map((k) => k.id))} />
        )}
      </View>
      <Scanner visible={scan} title="Инвентарный QR" onClose={() => setScan(false)} onScan={async (code) => {
        const r = await api.resolveScan(code);
        if (r.type !== 'custody') return false;
        setScan(false);
        router.push({ pathname: '/custody/[id]', params: { id: String(r.custody.id) } });
        return true;
      }} />
      <FormMenu job={formJob} onClose={() => setFormJob(null)} />
    </View>
  );
}
