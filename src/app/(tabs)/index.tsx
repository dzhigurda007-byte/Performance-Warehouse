import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { PlacePicker } from '../../components/pickers';
import { Scanner } from '../../components/Scanner';
import { Badge, Muted, Section, colors, s, showError, useFocusLoad } from '../../components/ui';
import type { DocMode, DocType } from '../../core/types';
import { useApi, useBackend, usePerms } from '../../lib/backend';
import { openScanned } from '../../lib/navigation';

function Tile({ icon, title, subtitle, onPress, tone = colors.primary, badge }: {
  icon: string; title: string; subtitle: string; onPress: () => void; tone?: string; badge?: string;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.card, { flexDirection: 'row', gap: 14, alignItems: 'center' },
      pressed && { opacity: 0.85 }]}>
      <View style={{ width: 48, height: 48, borderRadius: 12, backgroundColor: tone + '1A', alignItems: 'center',
        justifyContent: 'center' }}>
        <Text style={{ fontSize: 24, color: tone }}>{icon}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 17, fontWeight: '600', color: colors.text }}>{title}</Text>
        <Muted>{subtitle}</Muted>
      </View>
      {badge ? <Badge text={badge} tone="warn" /> : null}
    </Pressable>
  );
}

export default function HomeScreen() {
  const api = useApi();
  const { user } = useBackend();
  const p = usePerms();
  const [lookup, setLookup] = useState(false);
  const [moveScan, setMoveScan] = useState(false);
  const [moveBoxId, setMoveBoxId] = useState<number | null>(null);

  const [stats] = useFocusLoad(async () => {
    if (!p.operate) return null;
    const [docs, returns] = await Promise.all([
      api.listDocuments({ status: 'draft' }),
      p.custody ? api.pendingReturnReceipts() : Promise.resolve([]),
    ]);
    const tasks = docs.filter((d) => d.type === 'receipt' && d.plan_count > 0).length;
    return { drafts: docs.length - tasks, returns: returns.length, tasks };
  }, [api, p.operate, p.custody]);

  if (!p.takeForSelf) return <Redirect href={p.custody ? '/custody' : '/more'} />;

  async function newDoc(type: DocType, mode: DocMode) {
    try {
      const id = await api.createDocument(type, mode);
      router.push({ pathname: '/doc/[id]', params: { id: String(id) } });
    } catch (e) {
      showError(e);
    }
  }

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      <Muted>{user?.full_name}</Muted>

      {p.operate && stats && (stats.drafts > 0 || stats.returns > 0) ? (
        <Section title="Требует внимания">
          {stats.returns > 0 ? (
            <Tile icon="↩" title="Возвраты ждут проведения" tone={colors.warn} badge={String(stats.returns)}
              subtitle="Приходные ордера по возвращённым ТМЦ" onPress={() => router.push({ pathname: '/documents', params: { filter: 'returns' } })} />
          ) : null}
          {stats.drafts > 0 ? (
            <Tile icon="✎" title="Черновики документов" badge={String(stats.drafts)}
              subtitle="Не проведены" onPress={() => router.push({ pathname: '/documents', params: { filter: 'drafts' } })} />
          ) : null}
        </Section>
      ) : null}

      {p.operate ? (
        <Section title="Поступление">
          <Tile icon="☑" title="Задания на приёмку" tone={colors.success} badge={stats?.tasks ? String(stats.tasks) : undefined}
            subtitle="Сканировать ШК по заданию: красный — меньше, зелёный — сошлось, жёлтый — больше"
            onPress={() => router.push({ pathname: '/documents', params: { filter: 'tasks' } })} />
          <Tile icon="↓" title="Приходный ордер (без задания)" tone={colors.success}
            subtitle="Сканировать ШК на ТСД / телефоне → в буферную ячейку" onPress={() => newDoc('receipt', 'fact')} />
          <Tile icon="☰" title="Новое задание на приёмку" tone={colors.success}
            subtitle="Составить на ПК: что и сколько ожидается" onPress={() => newDoc('receipt', 'plan')} />
          <Tile icon="⊞" title="Задание на приёмку из Excel" tone={colors.success}
            subtitle="Файл: Артикул, Наименование, Количество" onPress={() => router.push({ pathname: '/import', params: { kind: 'receipt' } })} />
        </Section>
      ) : null}

      <Section title="Расход и выдача">
        {p.operate ? (
          <>
            <Tile icon="↑" title="Расходный ордер (заявка)" tone={colors.danger}
              subtitle="Что выдать — система подберёт, откуда взять" onPress={() => newDoc('issue', 'plan')} />
            <Tile icon="⌗" title="Расходный ордер по факту" tone={colors.warn}
              subtitle="Сканировать короб / ячейку / товар и изымать" onPress={() => newDoc('issue', 'fact')} />
          </>
        ) : (
          <Tile icon="⌗" title="Взять ТМЦ со склада" tone={colors.warn}
            subtitle={p.custody ? 'ТМЦ будут числиться на вас' : 'Выдача выключена администратором'}
            onPress={() => (p.custody ? newDoc('issue', 'fact') : Alert.alert('Недоступно', 'Выдача ТМЦ выключена в настройках'))} />
        )}
      </Section>

      <Section title="Инструменты">
        {p.operate ? (
          <>
            <Tile icon="⇄" title="Перемещение товара" subtitle="Весь товар или часть по одному ШК в другую ячейку"
              onPress={() => router.push('/move')} />
            <Tile icon="▣" title="Переместить короб" subtitle="Сканировать короб и выбрать новую ячейку"
              onPress={() => setMoveScan(true)} />
          </>
        ) : null}
        <Tile icon="⌕" title="Что это? (сканер)" subtitle="QR ячейки, короба, товара или инвентарный номер"
          onPress={() => setLookup(true)} />
      </Section>

      <Scanner visible={lookup} onClose={() => setLookup(false)} title="Поиск по коду"
        onScan={async (code) => {
          const r = await api.resolveScan(code);
          if (r.type === 'none') return false;
          setLookup(false);
          openScanned(r);
          return true;
        }} />
      <Scanner visible={moveScan} onClose={() => setMoveScan(false)} title="Перемещение короба" hint="Отсканируйте QR короба"
        onScan={async (code) => {
          const r = await api.resolveScan(code);
          if (r.type !== 'box') return false;
          setMoveScan(false);
          setMoveBoxId(r.box.id);
          return true;
        }} />
      <PlacePicker visible={moveBoxId !== null} cellOnly title="Куда переместить короб" onClose={() => setMoveBoxId(null)}
        onPick={async (pl) => {
          const boxId = moveBoxId!;
          setMoveBoxId(null);
          try {
            await api.moveBox(boxId, pl.cellId!);
            Alert.alert('Готово', `Короб перемещён в ${pl.label}`);
          } catch (e) {
            showError(e);
          }
        }} />
    </ScrollView>
  );
}
