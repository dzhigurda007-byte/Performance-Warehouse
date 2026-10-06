import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { Platform } from 'react-native';
import { readSheet } from 'read-excel-file/universal';
import type { ImportRow } from '../core/services/items';
import { rowsFromSheet, type Cell, type ExcelKind } from './excelRows';

/** Выбрать файл .xlsx и прочитать первый лист. */
export async function pickExcel(kind: ExcelKind = 'items'): Promise<{ name: string; rows: ImportRow[] } | null> {
  const res = await DocumentPicker.getDocumentAsync({
    type: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel', '*/*'],
    copyToCacheDirectory: true,
  });
  if (res.canceled || !res.assets?.length) return null;
  const asset = res.assets[0];
  if (!/\.xlsx$/i.test(asset.name)) throw new Error('Нужен файл Excel в формате .xlsx (Файл → Сохранить как → Книга Excel)');
  const buffer = Platform.OS === 'web' && asset.file ? await asset.file.arrayBuffer() : await new File(asset.uri).arrayBuffer();
  const sheet = (await readSheet(buffer)) as Cell[][];
  return { name: asset.name, rows: rowsFromSheet(sheet, kind) };
}
