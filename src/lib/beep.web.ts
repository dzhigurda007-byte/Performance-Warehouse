/** Звук сканирования в браузере (ПК): короткий писк — принято, двойной низкий — ошибка. */
let enabled = true;
try {
  enabled = localStorage.getItem('pw.sound') !== '0';
} catch {
  // ignore
}
let ctx: AudioContext | null = null;

function tone(freq: number, start: number, ms: number) {
  if (!ctx) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.frequency.value = freq;
  o.type = 'sine';
  g.gain.setValueAtTime(0.0001, ctx.currentTime + start);
  g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + start + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + ms / 1000);
  o.connect(g).connect(ctx.destination);
  o.start(ctx.currentTime + start);
  o.stop(ctx.currentTime + start + ms / 1000 + 0.02);
}

export const scanSound = {
  get enabled() {
    return enabled;
  },
  async setEnabled(v: boolean) {
    enabled = v;
    try {
      localStorage.setItem('pw.sound', v ? '1' : '0');
    } catch {
      // ignore
    }
  },
  play(kind: 'ok' | 'error') {
    if (!enabled) return;
    try {
      ctx ??= new AudioContext();
      if (kind === 'ok') tone(2400, 0, 90);
      else {
        tone(420, 0, 130);
        tone(330, 0.19, 180);
      }
    } catch {
      // ignore
    }
  },
  ready: async () => undefined,
};
