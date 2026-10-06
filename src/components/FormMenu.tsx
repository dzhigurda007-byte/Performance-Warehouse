import { Platform } from 'react-native';
import { ActionMenu } from './ActionMenu';
import { showError } from './ui';
import type { FormContext, PrintableForm } from '../lib/docForms';
import { useApi, useBackend } from '../lib/backend';
import { printForm, saveForm } from '../lib/print';

export interface FormJob {
  title: string;
  subtitle?: string;
  /** Варианты печатной формы (например «Ведомость» / «Ведомость с местами хранения»). */
  variants: { label?: string; build: (ctx: FormContext) => Promise<PrintableForm> | PrintableForm }[];
}

/**
 * Меню печати документа: «Печать» (только сама форма, без окна программы) и
 * «Сохранить файл» (телефон — PDF для отправки; ПК — отдельная вкладка, из неё PDF).
 */
export function FormMenu({ job, onClose }: { job: FormJob | null; onClose: () => void }) {
  const api = useApi();
  const { user } = useBackend();

  async function context(): Promise<FormContext> {
    const org = await api.settings().then((s) => s.orgName).catch(() => '');
    return { org, printedBy: user?.full_name };
  }

  const run = (v: FormJob['variants'][number], save: boolean) => async () => {
    try {
      const form = await v.build(await context());
      await (save ? saveForm(form) : printForm(form));
    } catch (e) {
      showError(e);
    }
  };

  const saveLabel = Platform.OS === 'web' ? 'Открыть отдельным документом (PDF)' : 'Сохранить PDF-файл / отправить';
  const actions = (job?.variants ?? []).flatMap((v) => [
    { label: `${v.label ? v.label + ': ' : ''}Печать`, onPress: run(v, false) },
    { label: `${v.label ? v.label + ': ' : ''}${saveLabel}`, onPress: run(v, true) },
  ]);
  return <ActionMenu visible={!!job} title={job?.title} subtitle={job?.subtitle} actions={actions} onClose={onClose} />;
}
