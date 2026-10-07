import type { Ctx } from './ctx';
import { custody } from './services/custody';
import { documents } from './services/documents';
import { history } from './services/history';
import { items } from './services/items';
import { stockQueries } from './services/stock';
import { structure } from './services/structure';
import { users } from './services/users';
import { upd } from './services/upd';
import { refs } from './services/refs';
import { can } from './roles';
import { need } from './ctx';
import type { StockReportFilter } from './types';

/**
 * Полный набор бизнес-операций. Каждая принимает контекст (база + пользователь)
 * первым аргументом. Один и тот же объект используется:
 *  - в приложении в автономном режиме (вызов напрямую, база на телефоне);
 *  - на локальном сервере (вызов по сети через POST /api/rpc).
 * Права проверяются внутри операций, поэтому одинаково работают в обоих режимах.
 */
export const api = {
  // структура склада
  listWarehouses: structure.listWarehouses,
  getWarehouse: structure.getWarehouse,
  saveWarehouse: structure.saveWarehouse,
  deleteWarehouse: structure.deleteWarehouse,
  listRacks: structure.listRacks,
  getRack: structure.getRack,
  addRack: structure.addRack,
  deleteRack: structure.deleteRack,
  addCells: structure.addCells,
  addCell: structure.addCell,
  deleteCell: structure.deleteCell,
  listCells: structure.listCells,
  getCell: structure.getCell,
  listCellsOfWarehouse: structure.listCellsOfWarehouse,
  bufferCell: structure.bufferCell,
  getBox: structure.getBox,
  findBoxByCode: structure.findBoxByCode,
  listBoxesInCell: structure.listBoxesInCell,
  createBox: structure.createBox,
  createBoxes: structure.createBoxes,
  listBoxes: structure.listBoxes,
  renameBox: structure.renameBox,
  deleteBox: structure.deleteBox,
  moveBox: structure.moveBox,

  // номенклатура
  listItems: items.list,
  getItem: items.get,
  saveItem: items.save,
  deleteItem: items.remove,
  deleteItems: items.removeMany,
  suggestSku: items.suggestSku,
  findItemByCode: items.findByCode,
  importItems: items.importRows,
  listGroups: items.listGroups,
  saveGroup: items.saveGroup,
  deleteGroup: items.deleteGroup,

  // остатки
  stockByItem: (ctx: Ctx, itemId: number) => (need(ctx, can.viewStock), stockQueries.byItem(ctx.db, itemId)),
  stockLooseInCell: (ctx: Ctx, cellId: number) => (need(ctx, can.viewStock), stockQueries.looseInCell(ctx.db, cellId)),
  stockInBox: (ctx: Ctx, boxId: number) => (need(ctx, can.viewStock), stockQueries.inBox(ctx.db, boxId)),
  stockInRack: (ctx: Ctx, rackId: number) => (need(ctx, can.viewStock), stockQueries.inRack(ctx.db, rackId)),
  stockAllInCell: (ctx: Ctx, cellId: number) => (need(ctx, can.viewStock), stockQueries.allInCell(ctx.db, cellId)),
  stockReport: (ctx: Ctx, f?: StockReportFilter) => (need(ctx, can.viewStock), stockQueries.report(ctx.db, f)),
  stockSearch: (ctx: Ctx, search: string, warehouseId?: number | null) =>
    (need(ctx, can.viewStock), stockQueries.search(ctx.db, search, warehouseId)),

  // документы
  listDocuments: documents.list,
  getDocument: documents.get,
  listLines: documents.lines,
  createDocument: documents.create,
  updateDocumentHeader: documents.updateHeader,
  deleteDocument: documents.remove,
  addLine: documents.addLine,
  addLineByCode: documents.addLineByCode,
  updateLine: documents.updateLine,
  deleteLine: documents.deleteLine,
  addIssueLineAuto: documents.addIssueLineAuto,
  createReceiptFromRows: documents.createReceiptFromRows,
  docPlan: documents.plan,
  setPlanQty: documents.setPlanQty,
  setFactQty: documents.setFactQty,
  fillFromPlan: documents.fillFromPlan,
  takeTask: documents.takeTask,
  releaseTask: documents.releaseTask,
  listAllocations: documents.allocations,
  setAllocations: documents.setAllocations,
  postReceipt: documents.postReceipt,
  postIssue: documents.postIssue,
  unpostDocument: documents.unpost,
  moveStock: documents.moveStock,
  moveMany: documents.moveMany,

  // справочники: организации, контрагенты, договоры
  listOrgs: refs.listOrgs,
  getOrg: refs.getOrg,
  defaultOrg: refs.defaultOrg,
  saveOrg: refs.saveOrg,
  deleteOrg: refs.deleteOrg,
  listParties: refs.listParties,
  getParty: refs.getParty,
  saveParty: refs.saveParty,
  deleteParty: refs.deleteParty,
  listContracts: refs.listContracts,
  getContract: refs.getContract,
  saveContract: refs.saveContract,
  deleteContract: refs.deleteContract,

  // УПД по расходному ордеру
  getUpd: upd.get,
  saveUpd: upd.save,
  updBuyers: upd.buyers,

  // выдача под ответственность
  myCustody: custody.mine,
  issuedCustody: custody.issued,
  getCustody: custody.get,
  custodyByIssueDoc: custody.byIssueDoc,
  returnCustody: custody.returnItems,
  receiptForReturned: custody.receiptForReturned,
  pendingReturnReceipts: custody.pendingReturnReceipts,

  // история и сканер
  listMoves: history.moves,
  resolveScan: history.resolveScan,

  // пользователи и настройки
  me: users.me,
  listUsers: users.list,
  recipients: users.recipients,
  updateUser: users.update,
  listDepartments: users.listDepartments,
  saveDepartment: users.saveDepartment,
  deleteDepartment: users.deleteDepartment,
  createInvite: users.createInvite,
  listInvites: users.listInvites,
  revokeInvite: users.revokeInvite,
  settings: users.settings,
  saveSettings: users.saveSettings,
};

export type CoreApi = typeof api;
export type ApiMethod = keyof CoreApi;

type Tail<T extends unknown[]> = T extends [unknown, ...infer R] ? R : never;

/** Клиентский вид API: те же функции без первого аргумента ctx. */
export type ClientApi = {
  [K in ApiMethod]: (...args: Tail<Parameters<CoreApi[K]>>) => Promise<Awaited<ReturnType<CoreApi[K]>>>;
};

export function bindApi(getCtx: () => Ctx): ClientApi {
  const out = {} as Record<string, unknown>;
  for (const k of Object.keys(api) as ApiMethod[]) {
    const fn = api[k] as (ctx: Ctx, ...a: unknown[]) => unknown;
    out[k] = async (...args: unknown[]) => fn(getCtx(), ...args);
  }
  return out as ClientApi;
}
