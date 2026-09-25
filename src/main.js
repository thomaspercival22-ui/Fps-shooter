// Entry point: loading, menus, settings, and starting the game.
import * as THREE from 'three';
import { loadAssets } from './assets.js';
import { AudioEngine, Voices } from './audio.js';
import { Game } from './game.js';
import { settings, saveSettings, getBest } from './settings.js';
import { WEAPONS, DIFFICULTY } from './config.js';

const $ = (id) => document.getElementById(id);
const show = (id, on = true) => $(id).classList.toggle('hidden', !on);

// Offline support: cache everything with a service worker.
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

async function boot() {
  const canvas = $('game');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: settings.quality !== 'low', powerPreference: 'high-performance', stencil: false });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setPixelRatio(1);
  renderer.setSize(window.innerWidth, window.innerHeight, false);

  const fill = $('load-fill'), text = $('load-text');
  let pa = 0, pb = 0;
  const progress = () => { fill.style.width = `${Math.round((pa * 0.75 + pb * 0.25) * 100)}%`; };
  const audio = new AudioEngine();
  audio.setVolume(settings.volume);
  const voices = new Voices();
  voices.enabled = false; // enemy chatter is never spoken aloud
  text.textContent = 'Loading textures and models...';
  const [assets] = await Promise.all([
    loadAssets(renderer, (p) => { pa = p; progress(); }),
    audio.generate((p) => { pb = p; progress(); }),
  ]);
  text.textContent = 'Building the compound...';
  await new Promise((r) => setTimeout(r, 30));
  const game = new Game(renderer, assets, audio, voices);
  // warm up shaders so the first seconds of play don't stutter
  renderer.compile(game.scene, game.camera);
  renderer.compile(game.weapons.scene, game.weapons.camera);
  window.__game = game;
  setupUI(game);
  show('loading', false);
  show('menu', true);
}

function setupUI(game) {
  const { audio, input } = game;
  const click = () => { audio.unlock(); audio.play('ui', { vol: 0.5 }); };

  // ---- loadout ----
  const primaries = ['m4', 'm1014', 'sniper'];
  const pc = $('primary-choices');
  const renderPrimaries = () => {
    pc.innerHTML = '';
    for (const k of primaries) {
      const b = document.createElement('button');
      b.className = 'choice' + (settings.primary === k ? ' sel' : '');
      b.innerHTML = `<b>${WEAPONS[k].name}</b><span>${WEAPONS[k].desc}</span>`;
      b.onclick = () => { click(); settings.primary = k; saveSettings(); renderPrimaries(); };
      pc.appendChild(b);
    }
  };
  const dc = $('difficulty-choices');
  const renderDiff = () => {
    dc.innerHTML = '';
    for (const [k, d] of Object.entries(DIFFICULTY)) {
      const b = document.createElement('button');
      b.className = 'choice' + (settings.difficulty === k ? ' sel' : '');
      b.innerHTML = `<b>${d.name}</b><span>${d.desc}</span>`;
      b.onclick = () => { click(); settings.difficulty = k; saveSettings(); renderDiff(); };
      dc.appendChild(b);
    }
  };
  const tc = $('time-choices');
  const renderTime = () => {
    tc.innerHTML = '';
    for (const [k, name, desc] of [['day', 'Day', 'Desert sun, long sightlines'], ['night', 'Night', 'Moonlight · use NVG & thermal']]) {
      const b = document.createElement('button');
      b.className = 'choice' + (settings.time === k ? ' sel' : '');
      b.innerHTML = `<b>${name}</b><span>${desc}</span>`;
      b.onclick = () => { click(); settings.time = k; saveSettings(); renderTime(); };
      tc.appendChild(b);
    }
  };
  renderPrimaries(); renderDiff(); renderTime();
  const showBest = () => {
    const b = getBest();
    $('best-score').textContent = b ? `BEST ${b.score} · WAVE ${b.wave} · ${DIFFICULTY[b.difficulty]?.name || ''}` : '';
  };
  showBest();
  $('btn-loadout').onclick = () => { click(); $('panel-loadout').scrollIntoView?.({ behavior: 'smooth' }); $('panel-loadout').animate?.([{ outline: '2px solid #d9b35c' }, { outline: '2px solid transparent' }], 700); };

  // ---- deploy ----
  const deploy = async () => {
    click();
    await enterFullscreen(input.touchMode);
    keepAwake();
    if (settings.gyro !== 'off') input.enableGyro();
    show('menu', false); show('gameover', false);
    game.start();
    if (!input.touchMode) $('game').requestPointerLock?.();
  };
  $('btn-deploy').onclick = deploy;
  $('btn-retry').onclick = deploy;

  // ---- screens ----
  let settingsReturn = 'menu';
  $('btn-settings').onclick = () => { click(); settingsReturn = 'menu'; buildSettings(game); show('menu', false); show('settings'); };
  $('btn-pause-settings').onclick = () => { click(); settingsReturn = 'pause'; buildSettings(game); show('pause', false); show('settings'); };
  $('btn-settings-close').onclick = () => { click(); show('settings', false); show(settingsReturn); };
  $('btn-howto').onclick = () => { click(); show('menu', false); show('howto'); };
  // home-screen shortcut
  const standalone = matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches || navigator.standalone;
  if (standalone) show('btn-install', false);
  $('btn-install').onclick = async () => {
    click();
    if (installPrompt) {
      installPrompt.prompt();
      const r = await installPrompt.userChoice.catch(() => null);
      if (r && r.outcome === 'accepted') show('btn-install', false);
      installPrompt = null;
    } else { show('menu', false); show('install'); }
  };
  $('btn-install-close').onclick = () => { click(); show('install', false); show('menu'); };
  $('btn-howto-close').onclick = () => { click(); show('howto', false); show('menu'); };
  $('btn-resume').onclick = () => {
    click(); show('pause', false); game.resume();
    if (!input.touchMode) $('game').requestPointerLock?.();
  };
  $('btn-quit').onclick = () => { click(); show('pause', false); game.quit(); showBest(); show('menu'); };
  $('btn-go-menu').onclick = () => { click(); show('gameover', false); game.quit(); showBest(); show('menu'); };
  game.onPause = () => show('pause');
  game.onGameOver = (s) => {
    $('go-title').textContent = s.isBest ? 'NEW BEST' : 'K.I.A.';
    $('go-stats').innerHTML = [
      ['Score', `<span class="hl">${s.score}</span>`], ['Wave reached', s.wave], ['Kills', s.kills], ['Headshots', s.headshots],
      ['Grenade kills', s.grenadeKills], ['Accuracy', `${s.accuracy}%`], ['Longest kill', `${s.longest} m`], ['Time', `${Math.floor(s.time / 60)}:${String(s.time % 60).padStart(2, '0')}`],
    ].map(([a, b]) => `<span>${a}</span><span>${b}</span>`).join('');
    show('gameover');
  };
}

function buildSettings(game) {
  const grid = $('settings-grid');
  grid.innerHTML = '';
  const apply = () => {
    saveSettings();
    game.audio.setVolume(settings.volume);
    game.voices.enabled = false;
    game.onResize();
  };
  const seg = (label, key, options, after) => {
    const row = document.createElement('div');
    row.className = 'setting';
    row.innerHTML = `<label>${label}</label>`;
    const s = document.createElement('div');
    s.className = 'seg';
    for (const [val, name] of options) {
      const b = document.createElement('button');
      b.textContent = name;
      if (settings[key] === val) b.classList.add('sel');
      b.onclick = () => {
        settings[key] = val; apply(); after?.(val);
        s.querySelectorAll('button').forEach((x) => x.classList.toggle('sel', x === b));
        game.audio.play('ui', { vol: 0.4 });
      };
      s.appendChild(b);
    }
    row.appendChild(s);
    grid.appendChild(row);
  };
  const range = (label, key, min, max, step, fmt = (v) => v.toFixed(2)) => {
    const row = document.createElement('div');
    row.className = 'setting';
    row.innerHTML = `<label>${label}<span>${fmt(settings[key])}</span></label>`;
    const r = document.createElement('input');
    r.type = 'range'; r.min = min; r.max = max; r.step = step; r.value = settings[key];
    r.oninput = () => { settings[key] = parseFloat(r.value); row.querySelector('span').textContent = fmt(settings[key]); apply(); };
    row.appendChild(r);
    grid.appendChild(row);
  };
  seg('Graphics', 'quality', [['auto', 'Auto'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High']], () => game.applyQuality());
  range('Look sensitivity', 'lookSens', 0.2, 3, 0.05);
  range('Aim (ADS) sensitivity', 'adsSens', 0.2, 2, 0.05);
  range('Field of view', 'fov', 70, 110, 1, (v) => `${v}°`);
  seg('Aim assist (touch)', 'aimAssist', [[true, 'On'], [false, 'Off']]);
  seg('Gyro aiming', 'gyro', [['off', 'Off'], ['ads', 'When aiming'], ['always', 'Always']], (v) => { if (v !== 'off') game.input.enableGyro(); });
  range('Gyro sensitivity', 'gyroSens', 0.2, 3, 0.05);
  seg('Invert look', 'invertY', [[false, 'Off'], [true, 'On']]);
  range('Volume', 'volume', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`);
  seg('On-screen joystick & buttons', 'onscreen', [['auto', 'Auto'], ['always', 'Always']], (v) => game.input.setTouchMode(game.input.hasTouch || v === 'always'));
  seg('Show FPS', 'showFps', [[false, 'Off'], [true, 'On']]);
}

async function enterFullscreen(touch) {
  if (!touch) return;
  try {
    const el = document.documentElement;
    if (!document.fullscreenElement && el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
  } catch { /* iOS Safari has no fullscreen API; installed PWA is fullscreen anyway */ }
  try { await screen.orientation?.lock?.('landscape'); } catch { /* not supported */ }
}

// Android/Chrome offers a native install prompt; keep it for the menu button.
let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; });
window.addEventListener('appinstalled', () => { installPrompt = null; $('btn-install')?.classList.add('hidden'); });

let wakeLock = null;
async function keepAwake() {
  try {
    if ('wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch { /* ignore */ }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && window.__game?.state === 'playing') keepAwake(); });

boot().catch((e) => {
  console.error(e);
  $('error-text').textContent = String(e && e.stack || e);
  show('error');
});
