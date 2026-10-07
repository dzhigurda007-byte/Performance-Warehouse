/**
 * Печать в браузере (рабочее место на ПК). Документ печатается из отдельного
 * невидимого фрейма — иначе браузер печатает текущую страницу приложения.
 */
/** Ориентация задаётся в самой странице (@page size: A4 landscape) — браузер печатает альбомно. */
export function printHtml(html: string, _orientation: 'portrait' | 'landscape' = 'portrait'): Promise<void> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    Object.assign(frame.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' });
    document.body.appendChild(frame);
    const win = frame.contentWindow;
    const doc = frame.contentDocument ?? win?.document;
    if (!win || !doc) {
      frame.remove();
      reject(new Error('Браузер не дал открыть окно печати'));
      return;
    }
    doc.open();
    doc.write(html);
    doc.close();
    const cleanup = () => setTimeout(() => frame.remove(), 1000);
    win.addEventListener('afterprint', cleanup, { once: true });
    // Небольшая пауза, чтобы браузер разложил страницу (SVG-коды, шрифты).
    setTimeout(() => {
      try {
        win.focus();
        win.print();
        resolve();
      } catch (e) {
        frame.remove();
        reject(e instanceof Error ? e : new Error(String(e)));
      }
      setTimeout(() => frame.remove(), 60_000);
    }, 300);
  });
}

/**
 * Открыть документ отдельной страницей (вкладкой) — как печатную форму в 1С:
 * её можно распечатать или сохранить в PDF (Ctrl+P → «Сохранить как PDF»),
 * имя файла подставится из названия документа. Если браузер запретил всплывающее
 * окно — документ скачивается HTML-файлом.
 */
export async function saveHtml(html: string, fileName: string, orientation: 'portrait' | 'landscape' = 'portrait') {
  const toolbar = `<div class="pw-toolbar" style="position:sticky;top:0;left:0;background:#1f2937;color:#fff;padding:8px 12px;font:14px Arial;display:flex;gap:12px;align-items:center;z-index:9">
    <button onclick="window.print()" style="font:14px Arial;padding:6px 14px;cursor:pointer">Печать / сохранить PDF</button>
    <b style="flex:1">${fileName.replace(/[<>&]/g, '')}${orientation === 'landscape' ? ' · альбомный лист' : ''}</b></div>
    <style>@media print { .pw-toolbar { display: none !important; } } @media screen { body { max-width: ${orientation === 'landscape' ? '297mm' : '210mm'}; margin: 0 auto !important; padding: 0 10mm 10mm; background: #fff; box-shadow: 0 0 12px #0003; } html { background: #e5e7eb; } }</style>`;
  const full = html.replace(/<body([^>]*)>/i, `<body$1>${toolbar}`);
  const blob = new Blob([full], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank');
  if (!win) {
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileName.replace(/[\\/:*?"<>|]+/g, '_')}.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  setTimeout(() => URL.revokeObjectURL(url), 120_000);
}
