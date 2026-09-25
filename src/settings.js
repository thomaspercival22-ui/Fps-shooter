// Persistent user settings (stored on the device).

const KEY = 'dustfall.settings.v1';

export const DEFAULTS = {
  quality: 'ultra',       // ultra | high | medium | low | auto (dynamic resolution)
  lookSens: 1.0,
  adsSens: 0.75,
  fov: 90,                // horizontal field of view
  invertY: false,
  aimAssist: true,
  gyro: 'off',            // off | ads | always
  gyroSens: 1.0,
  volume: 0.9,
  voices: false,          // enemy callouts are never spoken aloud
  showFps: false,
  primary: 'm4',
  difficulty: 'regular',
  controlsOpacity: 0.85,
  onscreen: 'auto',       // auto | always (on-screen joystick + buttons)
  time: 'day',            // mission time: day | night
  weather: 'clear',       // clear | rain
  optic: 'holo',          // M4 optic: holo | nv (digital night vision scope)
  gfx: 2,                 // settings revision (graphics defaults)
};

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = { ...DEFAULTS, ...JSON.parse(raw) };
      // the high-end graphics update makes Ultra the default once
      if (s.gfx !== 2) { s.quality = 'ultra'; s.gfx = 2; }
      return s;
    }
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

/** Largest texture size loaded for a graphics preset (bigger ones are scaled down at load). */
export function textureCap(q = settings.quality) {
  return q === 'ultra' ? 8192 : q === 'high' || q === 'auto' ? 2048 : 1024;
}
