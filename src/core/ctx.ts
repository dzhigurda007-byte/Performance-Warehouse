import { BusinessError, type DB } from './db';
import { ROLE_LABEL, type Role } from './roles';

export interface SessionUser {
  id: number;
  login: string;
  full_name: string;
  role: Role;
  department_id: number | null;
  supervisor_id: number | null;
}

/** Контекст вызова бизнес-операции: база и пользователь, от чьего имени она выполняется. */
export interface Ctx {
  db: DB;
  user: SessionUser;
}

export function deny(what = 'это действие'): never {
  throw new BusinessError(`Недостаточно прав на ${what}`, 'forbidden');
}

export function need(ctx: Ctx, ok: (r: Role) => boolean, what?: string) {
  if (!ok(ctx.user.role)) deny(what ?? `роль «${ROLE_LABEL[ctx.user.role]}»`);
}

export async function loadSessionUser(db: DB, id: number): Promise<SessionUser | null> {
  return db.getFirstAsync<SessionUser>(
    'SELECT id, login, full_name, role, department_id, supervisor_id FROM users WHERE id = ? AND active = 1',
    id,
  );
}

/**
 * Является ли manager начальником user (прямым или выше по цепочке):
 * по полю «руководитель» или как глава отдела пользователя / вышестоящего отдела.
 */
export async function isSuperiorOf(db: DB, managerId: number, userId: number): Promise<boolean> {
  if (managerId === userId) return false;
  let current: number | null = userId;
  for (let depth = 0; current && depth < 20; depth++) {
    const u: { supervisor_id: number | null; department_id: number | null } | null = await db.getFirstAsync(
      'SELECT supervisor_id, department_id FROM users WHERE id = ?', current);
    if (!u) return false;
    if (u.supervisor_id === managerId) return true;
    let dep = u.department_id;
    for (let d = 0; dep && d < 20; d++) {
      const row: { head_id: number | null; parent_id: number | null } | null = await db.getFirstAsync(
        'SELECT head_id, parent_id FROM departments WHERE id = ?', dep);
      if (!row) break;
      if (row.head_id === managerId && current !== managerId) return true;
      dep = row.parent_id;
    }
    current = u.supervisor_id;
  }
  return false;
}

/** Все подчинённые (прямые и косвенные). */
export async function subordinateIds(db: DB, managerId: number): Promise<number[]> {
  const users = await db.getAllAsync<{ id: number }>('SELECT id FROM users');
  const out: number[] = [];
  for (const u of users) if (await isSuperiorOf(db, managerId, u.id)) out.push(u.id);
  return out;
}
