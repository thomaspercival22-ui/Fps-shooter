// Persistent user settings (stored on the device).

const KEY = 'dustfall.settings.v1';

export const DEFAULTS = {
  quality: 'auto',        // auto | low | medium | high
  lookSens: 1.0,
  adsSens: 0.75,
  fov: 90,                // horizontal field of view
  invertY: false,
  aimAssist: true,
  gyro: 'off',            // off | ads | always
  gyroSens: 1.0,
  volume: 0.9,
  voices: true,           // enemy radio callouts via speech synthesis
  showFps: false,
  primary: 'm4',
  difficulty: 'regular',
  controlsOpacity: 0.85,
  onscreen: 'auto',       // auto | always (on-screen joystick + buttons)
};

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch { /* storage unavailable */ }
  return { ...DEFAULTS };
}

export const settings = load();

export function saveSettings() {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* ignore */ }
}

export function getBest() {
  try { return JSON.parse(localStorage.getItem('dustfall.best') || 'null'); } catch { return null; }
}
export function setBest(v) {
  try { localStorage.setItem('dustfall.best', JSON.stringify(v)); } catch { /* ignore */ }
}
