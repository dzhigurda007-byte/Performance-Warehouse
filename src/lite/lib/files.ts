import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

/** Отправить текстовый файл (резервную копию) через системное меню «Поделиться»: почта, мессенджер, Диск, «Файлы». */
export async function shareTextFile(fileName: string, text: string, mimeType = 'application/json') {
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([text], { type: mimeType }));
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return;
  }
  const f = new File(Paths.cache, fileName);
  if (f.exists) f.delete();
  f.create();
  f.write(text);
  if (!(await Sharing.isAvailableAsync())) throw new Error(`Файл сохранён: ${f.uri}`);
  await Sharing.shareAsync(f.uri, { mimeType, dialogTitle: fileName });
}

/** Выбрать файл на телефоне и прочитать как текст. */
export async function pickTextFile(): Promise<{ name: string; text: string } | null> {
  const res = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'text/plain', '*/*'], copyToCacheDirectory: true });
  if (res.canceled || !res.assets?.length) return null;
  const a = res.assets[0];
  const text = Platform.OS === 'web' && a.file ? await a.file.text() : await new File(a.uri).text();
  return { name: a.name, text };
}
