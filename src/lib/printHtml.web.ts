/**
 * Печать в браузере (рабочее место на ПК). Документ печатается из отдельного
 * невидимого фрейма — иначе браузер печатает текущую страницу приложения.
 */
export function printHtml(html: string): Promise<void> {
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
