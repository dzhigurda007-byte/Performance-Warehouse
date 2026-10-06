export type DocType = 'receipt' | 'issue' | 'move';
export type PostMode = 'writeoff' | 'custody';
export type DocSource = 'manual' | 'scan' | 'excel' | 'return';
export type DocMode = 'plan' | 'fact';
export type DocStatus = 'draft' | 'posted';

export type { Role } from './roles';
import type { Role } from './roles';

export interface User {
  id: number;
  login: string;
  full_name: string;
}

export interface UserRow extends User {
  role: Role;
  department_id: number | null;
  department_name: string | null;
  supervisor_id: number | null;
  supervisor_name: string | null;
  position: string | null;
  active: number;
  created_at: string;
}

export interface Department {
  id: number;
  name: string;
  parent_id: number | null;
  head_id: number | null;
  head_name: string | null;
  members: number;
}

export interface Invite {
  id: number;
  token: string;
  role: Role;
  department_id: number | null;
  department_name: string | null;
  supervisor_id: number | null;
  supervisor_name: string | null;
  created_by_name: string;
  created_at: string;
  expires_at: string | null;
  max_uses: number;
  uses: number;
  revoked: number;
}

export interface ItemGroup {
  id: number;
  name: string;
  parent_id: number | null;
  items: number;
}

export interface Warehouse {
  id: number;
  code: string;
  name: string;
  address: string | null;
}

export interface Rack {
  id: number;
  warehouse_id: number;
  code: string;
  name: string | null;
}

export interface Cell {
  id: number;
  rack_id: number;
  code: string;
  is_buffer: number;
}

/** Ячейка с полным адресом «Склад / Стеллаж / Ячейка». */
export interface CellAddress extends Cell {
  rack_code: string;
  warehouse_id: number;
  warehouse_code: string;
  warehouse_name: string;
  address: string;
}

export interface Box {
  id: number;
  code: string;
  name: string | null;
  cell_id: number | null;
  created_at: string;
}

export interface Item {
  id: number;
  sku: string;
  name: string;
  unit: string;
  barcode: string | null;
  description: string | null;
  group_id: number | null;
  track_units: number;
}

/** Строка остатка с адресом хранения. */
export interface StockRow {
  id: number;
  item_id: number;
  sku: string;
  item_name: string;
  unit: string;
  qty: number;
  first_in_at: string;
  received_at: string; // дата приёмки партии
  is_buffer: number | null;
  cell_id: number | null; // ячейка (для короба — ячейка, где он лежит)
  box_id: number | null;
  box_code: string | null;
  address: string | null; // «СКЛ / A / 01»
}

/** Партия в отчёте «Остатки»: + группа номенклатуры и склад. */
export interface StockReportRow extends StockRow {
  group_id: number | null;
  warehouse_id: number | null;
  barcode: string | null;
}

export interface StockReportFilter {
  warehouseId?: number | null;
  search?: string;
  /** Дата приёмки партии, включительно, ГГГГ-ММ-ДД. */
  dateFrom?: string | null;
  dateTo?: string | null;
}

export interface DocumentRow {
  id: number;
  type: DocType;
  mode: DocMode;
  number: string;
  doc_date: string;
  status: DocStatus;
  partner: string | null;
  recipient: string | null;
  comment: string | null;
  created_by: number;
  created_by_name: string;
  posted_by: number | null;
  posted_by_name: string | null;
  posted_at: string | null;
  lines_count: number;
  post_mode: PostMode | null;
  source: DocSource;
  base_doc_id: number | null;
  base_doc_number: string | null;
  warehouse_id: number | null;
  warehouse_name: string | null;
  /** Позиций в задании (0 — обычный ордер). */
  plan_count: number;
  /** Сколько всего по заданию и сколько уже принято / отобрано. */
  plan_qty: number;
  lines_qty: number;
  /** Кладовщик, взявший задание в работу. */
  assignee_id: number | null;
  assignee_name: string | null;
  assigned_at: string | null;
}

export interface DocLine {
  id: number;
  doc_id: number;
  item_id: number;
  sku: string;
  item_name: string;
  unit: string;
  barcode: string | null;
  qty: number;
  cell_id: number | null;
  box_id: number | null;
  box_code: string | null;
  to_cell_id: number | null;
  address: string | null;
  to_address: string | null;
  received_at: string | null;
  custody_id: number | null;
  custody_code: string | null;
  condition: ReturnCondition | null;
  note: string | null;
  accept: number;
}

export type ReturnCondition = 'ok' | 'dirty' | 'repair' | 'broken' | 'lost';

export const CONDITION_LABEL: Record<ReturnCondition, string> = {
  ok: 'Без повреждений',
  dirty: 'Грязное',
  repair: 'Требует ремонта',
  broken: 'Сломано окончательно',
  lost: 'Утеряно',
};

/** При этих отметках ТМЦ не возвращается в остатки, а списывается. */
export const CONDITION_NOT_ACCEPTED: ReturnCondition[] = ['broken', 'lost'];

export type CustodyStatus = 'held' | 'returned' | 'closed' | 'written_off' | 'lost';

export const CUSTODY_STATUS_LABEL: Record<CustodyStatus, string> = {
  held: 'На руках',
  returned: 'Возвращено, ждёт прихода',
  closed: 'Принято на склад',
  written_off: 'Списано',
  lost: 'Утеряно',
};

export interface CustodyRow {
  id: number;
  code: string;
  item_id: number;
  sku: string;
  item_name: string;
  unit: string;
  qty: number;
  holder_id: number;
  holder_name: string;
  holder_role: Role;
  issued_by: number;
  issued_by_name: string;
  issue_doc_id: number;
  issue_doc_number: string;
  issued_at: string;
  status: CustodyStatus;
  return_condition: ReturnCondition | null;
  return_comment: string | null;
  returned_by_name: string | null;
  returned_at: string | null;
  return_doc_id: number | null;
  return_doc_number: string | null;
}

export interface Allocation {
  item_id: number;
  user_id: number;
  qty: number;
}

export interface MoveRow {
  id: number;
  doc_id: number | null;
  doc_number: string | null;
  doc_type: DocType | null;
  item_id: number;
  sku: string;
  item_name: string;
  unit: string;
  qty: number;
  box_code: string | null;
  address: string | null;
  user_name: string;
  recipient: string | null;
  created_at: string;
  kind: string | null;
  received_at: string | null;
}

/** Место хранения: ячейка или короб. */
export type Place = { cellId: number; boxId?: null } | { boxId: number; cellId?: null };
