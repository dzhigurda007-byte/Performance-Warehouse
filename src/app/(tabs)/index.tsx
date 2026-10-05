import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { PlacePicker } from '../../components/pickers';
import { Scanner } from '../../components/Scanner';
import { Button, Card, Muted, Section, colors, s, showError, useFocusLoad } from '../../components/ui';
import * as repo from '../../db/repo';
import { parseScan } from '../../domain/codes';
import type { DocMode, DocType } from '../../domain/types';
import { useAuth, useUser } from '../../lib/auth-context';

function Tile({ icon, title, subtitle, onPress, tone = colors.primary }: {
  icon: string; title: string; subtitle: string; onPress: () => void; tone?: string;
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
    </Pressable>
  );
}

export default function HomeScreen() {
  const db = useSQLiteContext();
  const user = useUser();
  const { signOut } = useAuth();
  const [lookup, setLookup] = useState(false);
  const [moveScan, setMoveScan] = useState(false);
  const [moveBoxId, setMoveBoxId] = useState<number | null>(null);

  const [stats] = useFocusLoad(async () => {
    const r = await db.getFirstAsync<{ items: number; drafts: number; boxes: number; cells: number }>(`
      SELECT (SELECT COUNT(*) FROM items) AS items,
        (SELECT COUNT(*) FROM documents WHERE status = 'draft') AS drafts,
        (SELECT COUNT(*) FROM boxes) AS boxes,
        (SELECT COUNT(*) FROM cells) AS cells`);
    return r;
  }, []);

  async function newDoc(type: DocType, mode: DocMode) {
    try {
      const id = await repo.createDocument(db, type, mode, user.id);
      router.push({ pathname: '/doc/[id]', params: { id: String(id) } });
    } catch (e) {
      showError(e);
    }
  }

  async function onLookup(code: string) {
    const r = await repo.resolveScan(db, parseScan(code));
    if (r.type === 'none') return false;
    setLookup(false);
    if (r.type === 'cell') router.push({ pathname: '/cell/[id]', params: { id: String(r.cell.id) } });
    if (r.type === 'box') router.push({ pathname: '/box/[id]', params: { id: String(r.box.id) } });
    if (r.type === 'item') router.push({ pathname: '/item/[id]', params: { id: String(r.item.id) } });
    return true;
  }

  async function onMoveScan(code: string) {
    const r = await repo.resolveScan(db, parseScan(code));
    if (r.type !== 'box') return false;
    setMoveScan(false);
    setMoveBoxId(r.box.id);
    return true;
  }

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      <Card style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 17, fontWeight: '700', color: colors.text }}>{user.full_name}</Text>
          <Muted>@{user.login}</Muted>
        </View>
        <Button title="Выйти" variant="ghost" onPress={() =>
          Alert.alert('Выход', 'Выйти из аккаунта?', [{ text: 'Отмена' }, { text: 'Выйти', onPress: signOut }])} />
      </Card>

      {stats ? (
        <Muted>
          Товаров: {stats.items} · Ячеек: {stats.cells} · Коробов: {stats.boxes} · Черновиков: {stats.drafts}
        </Muted>
      ) : null}

      <Section title="Поступление">
        <Tile icon="↓" title="Приходный ордер" tone={colors.success}
          subtitle="Принять ТМЦ и разместить по ячейкам / коробам" onPress={() => newDoc('receipt', 'plan')} />
      </Section>

      <Section title="Выдача">
        <Tile icon="↑" title="Расходный ордер (заявка)" tone={colors.danger}
          subtitle="Указать, что выдать, — система подберёт, откуда взять (FIFO)" onPress={() => newDoc('issue', 'plan')} />
        <Tile icon="⌗" title="Расход по факту" tone={colors.warn}
          subtitle="Сканировать короб / товар и изымать фактически" onPress={() => newDoc('issue', 'fact')} />
      </Section>

      <Section title="Инструменты">
        <Tile icon="⌕" title="Что это? (сканер)" subtitle="Отсканировать QR ячейки, короба или товара"
          onPress={() => setLookup(true)} />
        <Tile icon="⇄" title="Переместить короб" subtitle="Сканировать короб и выбрать новую ячейку"
          onPress={() => setMoveScan(true)} />
      </Section>

      <Scanner visible={lookup} onClose={() => setLookup(false)} onScan={onLookup} title="Поиск по коду" />
      <Scanner visible={moveScan} onClose={() => setMoveScan(false)} onScan={onMoveScan}
        title="Перемещение" hint="Отсканируйте QR короба" />
      <PlacePicker
        visible={moveBoxId !== null}
        cellOnly
        title="Куда переместить короб"
        onClose={() => setMoveBoxId(null)}
        onPick={async (p) => {
          const boxId = moveBoxId!;
          setMoveBoxId(null);
          try {
            await repo.moveBox(db, boxId, p.cellId!, user.id);
            Alert.alert('Готово', `Короб перемещён в ${p.label}`);
          } catch (e) {
            showError(e);
          }
        }}
      />
    </ScrollView>
  );
}
