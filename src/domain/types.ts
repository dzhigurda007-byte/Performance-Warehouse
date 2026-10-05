export type DocType = 'receipt' | 'issue' | 'move';
export type DocMode = 'plan' | 'fact';
export type DocStatus = 'draft' | 'posted';

export interface User {
  id: number;
  login: string;
  full_name: string;
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
  cell_id: number | null; // ячейка (для короба — ячейка, где он лежит)
  box_id: number | null;
  box_code: string | null;
  address: string | null; // «СКЛ / A / 01»
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
  posted_by_name: string | null;
  posted_at: string | null;
  lines_count: number;
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
}

/** Место хранения: ячейка или короб. */
export type Place = { cellId: number; boxId?: null } | { boxId: number; cellId?: null };
