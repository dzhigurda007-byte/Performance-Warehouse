import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { Vibration } from 'react-native';
import { kv } from './storage';

/** Звук сканирования: короткий писк — код принят, двойной низкий — ошибка. Включается в окне сканера. */
let enabled = true;
let loaded = false;
let ok: AudioPlayer | null = null;
let err: AudioPlayer | null = null;

async function init() {
  if (loaded) return;
  loaded = true;
  try {
    enabled = (await kv.get('pw.sound')) !== '0';
    // звук слышен и в беззвучном режиме iPhone, не прерывает музыку
    await setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'mixWithOthers' });
    ok = createAudioPlayer(require('../../assets/sounds/scan-ok.wav'));
    err = createAudioPlayer(require('../../assets/sounds/scan-error.wav'));
  } catch {
    // без звука — не критично
  }
}
void init();

export const scanSound = {
  get enabled() {
    return enabled;
  },
  async setEnabled(v: boolean) {
    enabled = v;
    await kv.set('pw.sound', v ? '1' : '0').catch(() => undefined);
  },
  play(kind: 'ok' | 'error') {
    if (!enabled) return;
    Vibration.vibrate(kind === 'ok' ? 40 : [0, 80, 60, 80]);
    const p = kind === 'ok' ? ok : err;
    if (!p) return;
    try {
      p.seekTo(0).catch(() => undefined);
      p.play();
    } catch {
      // ignore
    }
  },
  ready: init,
};
