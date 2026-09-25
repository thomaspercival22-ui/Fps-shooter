// Persistent user settings (stored on the device).

const KEY = 'dustfall.settings.v1';

/**
 * Phones and tablets get tighter memory budgets: mobile browsers kill a tab
 * that uses far less memory than a desktop GPU has (iOS around 1-1.5 GB).
 */
export const MOBILE = (() => {
  try {
    return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
      || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform))
      || matchMedia('(pointer: coarse)').matches;
  } catch { return false; }
})();

export const DEFAULTS = {
  quality: MOBILE ? 'high' : 'ultra', // ultra | high | medium | low | auto (dynamic resolution)
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
  gfx: 3,                 // settings revision (graphics defaults)
};

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = { ...DEFAULTS, ...JSON.parse(raw) };
      // revision 2 forced Ultra on every device; phones go back to their safe default once
      if (s.gfx !== 3) { if (s.gfx !== 2 || MOBILE) s.quality = DEFAULTS.quality; s.gfx = 3; }
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
  if (MOBILE) return q === 'ultra' ? 2048 : q === 'high' || q === 'auto' ? 1024 : 512;
  return q === 'ultra' ? 8192 : q === 'high' || q === 'auto' ? 2048 : 1024;
}
/** Texture cap for small props (they rarely fill much of the screen). */
export function propTextureCap(q = settings.quality) {
  return MOBILE ? Math.max(512, textureCap(q) / 2) : textureCap(q);
}
/** Cube face size of the sky background (a 4096 face would cost 400 MB). */
export function skyFaceSize(q = settings.quality) {
  if (MOBILE) return q === 'ultra' || q === 'high' ? 1024 : 768;
  return q === 'ultra' ? 2048 : q === 'low' ? 768 : 1024;
}
