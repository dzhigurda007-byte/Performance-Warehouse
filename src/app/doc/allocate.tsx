import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Badge, Button, Card, Empty, Muted, SearchBox, Section, colors, notify, s, showError, useFocusLoad } from '../../components/ui';
import { formatQty, parseQty } from '../../core/codes';
import { ROLE_LABEL } from '../../core/roles';
import type { Allocation } from '../../core/types';
import { useApi, useBackend } from '../../lib/backend';

type Grid = Record<string, string>; // `${itemId}:${userId}` -> qty text

/**
 * Выдача под ответственность нескольким получателям.
 * Пример: 10 лопат и 10 пар перчаток → 10 разнорабочим по 1 лопате и 1 паре.
 */
export default function AllocateScreen() {
  const api = useApi();
  const { user } = useBackend();
  const id = Number(useLocalSearchParams<{ id: string }>().id);
  const [data] = useFocusLoad(async () => ({
    doc: await api.getDocument(id),
    lines: await api.listLines(id),
    users: await api.recipients(),
    allocs: await api.listAllocations(id),
  }), [api, id]);
  const [selected, setSelected] = useState<number[]>([]);
  const [grid, setGrid] = useState<Grid>({});
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);

  const items = useMemo(() => {
    const m = new Map<number, { item_id: number; name: string; unit: string; total: number }>();
    for (const l of data?.lines ?? []) {
      const cur = m.get(l.item_id) ?? { item_id: l.item_id, name: l.item_name, unit: l.unit, total: 0 };
      cur.total = Math.round((cur.total + l.qty) * 1000) / 1000;
      m.set(l.item_id, cur);
    }
    return [...m.values()];
  }, [data?.lines]);

  useEffect(() => {
    if (!data?.allocs.length) return;
    setSelected([...new Set(data.allocs.map((a) => a.user_id))]);
    const g: Grid = {};
    for (const a of data.allocs) g[`${a.item_id}:${a.user_id}`] = formatQty(a.qty);
    setGrid(g);
  }, [data?.allocs]);

  if (!data || !user) return null;
  const people = data.users.filter((u) => selected.includes(u.id));
  const filtered = data.users.filter((u) => !q.trim() || `${u.full_name} ${u.login} ${u.department_name ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()));

  const val = (itemId: number, userId: number) => parseQty(grid[`${itemId}:${userId}`] ?? '') ?? 0;
  const sumFor = (itemId: number) => Math.round(people.reduce((a, u) => a + val(itemId, u.id), 0) * 1000) / 1000;
  const allOk = items.length > 0 && people.length > 0 && items.every((it) => sumFor(it.item_id) === it.total);

  function toggle(uid: number) {
    setSelected((s0) => (s0.includes(uid) ? s0.filter((x) => x !== uid) : [...s0, uid]));
  }

  /** Поровну: целые штуки, остаток — первым по списку. */
  function evenly() {
    if (!people.length) return notify('Выберите получателей');
    const g: Grid = {};
    for (const it of items) {
      const n = people.length;
      const whole = Number.isInteger(it.total);
      const base = whole ? Math.floor(it.total / n) : Math.round((it.total / n) * 1000) / 1000;
      let rest = whole ? it.total - base * n : Math.round((it.total - base * n) * 1000) / 1000;
      people.forEach((u, i) => {
        let qv = base;
        if (whole && rest > 0) { qv += 1; rest -= 1; } else if (!whole && i === 0) qv = Math.round((qv + rest) * 1000) / 1000;
        if (qv > 0) g[`${it.item_id}:${u.id}`] = formatQty(qv);
      });
    }
    setGrid(g);
  }

  async function postIt() {
    const list: Allocation[] = [];
    for (const it of items) for (const u of people) {
      const v = val(it.item_id, u.id);
      if (v > 0) list.push({ item_id: it.item_id, user_id: u.id, qty: v });
    }
    setBusy(true);
    try {
      await api.setAllocations(id, list);
      await api.postIssue(id, 'custody');
      notify('Выдано', `${data!.doc.number}: ТМЦ записаны на ${people.length} чел. Распечатайте инвентарные QR в документе.`);
      router.back();
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1 }}>
      <ScrollView style={s.screen} contentContainerStyle={[s.content, { paddingBottom: 120 }]} keyboardShouldPersistTaps="handled">
        <Muted>{data.doc.number}: выберите получателей и распределите ТМЦ. Можно выдать себе или сотрудникам с ролью ниже вашей.</Muted>

        <Section title={`Получатели · выбрано ${people.length}`}>
          <SearchBox value={q} onChangeText={setQ} placeholder="ФИО, логин, отдел" />
          <View style={{ borderRadius: 12, overflow: 'hidden' }}>
            {filtered.length ? filtered.map((u) => {
              const on = selected.includes(u.id);
              return (
                <Pressable key={u.id} onPress={() => toggle(u.id)}
                  style={[s.row, on && { backgroundColor: colors.primarySoft }]}>
                  <Text style={{ fontSize: 20, width: 26, color: on ? colors.primary : colors.muted }}>{on ? '☑' : '☐'}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={s.rowTitle}>{u.full_name}{u.id === user.id ? ' (я)' : ''}</Text>
                    <Text style={s.rowSub}>{ROLE_LABEL[u.role]}{u.department_name ? ` · ${u.department_name}` : ''}</Text>
                  </View>
                </Pressable>
              );
            }) : <Empty text="Нет доступных получателей" />}
          </View>
        </Section>

        <Section title="Распределение" action={
          <Button title="Поровну" variant="secondary" style={{ minHeight: 34, marginVertical: 0 }} onPress={evenly} />
        }>
          {items.map((it) => {
            const sum = sumFor(it.item_id);
            const ok = sum === it.total;
            return (
              <Card key={it.item_id}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontWeight: '700', color: colors.text, flex: 1 }}>{it.name}</Text>
                  <Badge text={`${formatQty(sum)} из ${formatQty(it.total)} ${it.unit}`} tone={ok ? 'success' : 'warn'} />
                </View>
                {people.map((u) => (
                  <View key={u.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
                    <Text style={{ flex: 1, color: colors.text }}>{u.full_name}</Text>
                    <TextInput value={grid[`${it.item_id}:${u.id}`] ?? ''} keyboardType="decimal-pad" placeholder="0"
                      placeholderTextColor={colors.muted}
                      onChangeText={(t) => setGrid({ ...grid, [`${it.item_id}:${u.id}`]: t })}
                      style={[s.input, { width: 90, textAlign: 'center', paddingVertical: 6 }]} />
                  </View>
                ))}
                {!people.length ? <Muted>Сначала выберите получателей</Muted> : null}
              </Card>
            );
          })}
        </Section>
      </ScrollView>
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 12, paddingBottom: 28,
        backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border }}>
        <Button title={allOk ? `Выдать (${people.length} чел.)` : 'Распределите всё количество'} variant="success"
          disabled={!allOk} busy={busy} onPress={postIt} />
      </View>
    </View>
  );
}
