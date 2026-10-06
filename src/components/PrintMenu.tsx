import { ActionMenu } from './ActionMenu';
import { showError } from './ui';
import { LAYOUT_LABEL, printLabels, type Label, type LabelLayout } from '../lib/print';

export interface PrintJob {
  title: string;
  subtitle?: string;
  /** Варианты: что печатать (например «Стеллаж и ячейки» / «Только стеллаж»). */
  variants: { label: string; labels: () => Promise<Label[]> | Label[] }[];
}

/** Выбор формата печати этикеток: много на листе или одна на лист. */
export function PrintMenu({ job, onClose }: { job: PrintJob | null; onClose: () => void }) {
  const actions = (job?.variants ?? []).flatMap((v) =>
    (Object.keys(LAYOUT_LABEL) as LabelLayout[]).map((layout) => ({
      label: `${v.label}: ${LAYOUT_LABEL[layout]}`,
      onPress: async () => {
        try {
          await printLabels(await v.labels(), layout);
        } catch (e) {
          showError(e);
        }
      },
    })));
  return <ActionMenu visible={!!job} title={job?.title} subtitle={job?.subtitle} actions={actions} onClose={onClose} />;
}
