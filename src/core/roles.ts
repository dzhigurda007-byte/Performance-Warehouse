/**
 * Роли и иерархия подчинённости:
 *   Администратор → Руководитель → Кладовщик → Сотрудник → Разнорабочий
 */
export type Role = 'admin' | 'manager' | 'storekeeper' | 'employee' | 'worker';

export const ROLES: Role[] = ['admin', 'manager', 'storekeeper', 'employee', 'worker'];

export const ROLE_RANK: Record<Role, number> = {
  admin: 5,
  manager: 4,
  storekeeper: 3,
  employee: 2,
  worker: 1,
};

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Администратор',
  manager: 'Руководитель',
  storekeeper: 'Кладовщик',
  employee: 'Сотрудник',
  worker: 'Разнорабочий',
};

export const ROLE_HINT: Record<Role, string> = {
  admin: 'Полные права, настройки системы, пользователи и отделы',
  manager: 'Полный функционал склада, приглашает сотрудников по ссылке',
  storekeeper: 'Полный функционал склада, выдаёт ТМЦ нижестоящим',
  employee: 'Может брать ТМЦ со склада на себя',
  worker: 'Получает ТМЦ от кладовщика, возвращает их',
};

export function isRole(v: unknown): v is Role {
  return typeof v === 'string' && (ROLES as string[]).includes(v);
}

export const rank = (r: Role) => ROLE_RANK[r] ?? 0;

/** Права. Одно место, где описано, кто что может. */
export const can = {
  /** Настройки, отделы, удаление складов — руководитель и администратор («полные права»). */
  administer: (r: Role) => rank(r) >= ROLE_RANK.manager,
  /** Разработка: сведения о базе, резервные копии, служебные операции — только администратор. */
  develop: (r: Role) => r === 'admin',
  /** Высылать ссылки-приглашения. */
  invite: (r: Role) => rank(r) >= ROLE_RANK.manager,
  /** Пригласить пользователя с ролью target. */
  inviteRole: (r: Role, target: Role) =>
    r === 'admin' ? true : rank(r) >= ROLE_RANK.manager && rank(target) < rank(r),
  /** Склад: структура, номенклатура, приход, перемещение, списание, проведение. */
  operate: (r: Role) => rank(r) >= ROLE_RANK.storekeeper,
  /** Номенклатура (справочник товаров и групп): видеть вкладку, заводить и править товары. */
  manageItems: (r: Role) => rank(r) >= ROLE_RANK.manager,
  /** Видеть остатки склада (запросы) — все: разнорабочему нужно знать, где взять товар по заданию. */
  viewStock: (r: Role) => rank(r) >= ROLE_RANK.worker,
  /** Вкладка «Остатки» и история — сотрудник и выше. */
  stockTab: (r: Role) => rank(r) >= ROLE_RANK.employee,
  /** Брать ТМЦ со склада на себя (выдача себе). */
  takeForSelf: (r: Role) => rank(r) >= ROLE_RANK.employee,
  /** Выдать ТМЦ пользователю с ролью target (себе — всегда, если можно брать). */
  issueTo: (r: Role, target: Role, self: boolean) =>
    self ? rank(r) >= ROLE_RANK.employee : rank(r) >= ROLE_RANK.storekeeper && (r === 'admin' || rank(target) < rank(r)),
  /** Видеть выдачи подчинённых и всей команды. */
  viewTeam: (r: Role) => rank(r) >= ROLE_RANK.manager,
  /** Управлять сотрудниками (роль ниже своей). */
  manageUsers: (r: Role) => rank(r) >= ROLE_RANK.manager,
};
