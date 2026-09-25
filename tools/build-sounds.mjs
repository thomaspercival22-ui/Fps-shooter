// Builds the recorded sound set in assets/audio/ from public-domain (CC0)
// recordings on freesound.org: real gunshots (outdoors, indoors and at a
// distance), bullet impacts by material, ricochets, explosions and gun
// handling. Each source is downloaded once into .cache/sounds/, decoded in
// headless Chromium, sliced to single events, pitched/filtered/layered as
// listed in CLIPS, peak-normalised with a clean fade-out, and encoded to
// mono 48 kHz MP3 with lamejs. Writes assets/audio/sounds.json (the list the
// game loads) and assets/audio/CREDITS.md.
//   npm i -D lamejs && node tools/build-sounds.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

// lamejs's module build is broken (MPEGMode undefined); its single-file build works when run as a script
const lamejs = (() => {
  const file = createRequire(import.meta.url).resolve('lamejs/lame.all.js');
  const ctx = { console, Math, Int8Array, Int16Array, Int32Array, Float32Array, Float64Array, Uint8Array, ArrayBuffer };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(file, 'utf8'), ctx);
  return ctx.lamejs;
})();

// playwright from the project, or a global install
const { chromium } = await import('playwright').catch(() => import('/opt/node22/lib/node_modules/playwright/index.mjs'));

const ROOT = new URL('..', import.meta.url).pathname;
const CACHE = path.join(ROOT, '.cache/sounds');
const OUT = path.join(ROOT, 'assets/audio');

// freesound id: [user, preview path, title]  (all Creative Commons 0)
const SOURCES = {
  427596: ['michorvath', '427/427596_3094998-hq.mp3', 'AR15 rifle shot'],
  427597: ['michorvath', '427/427597_3094998-hq.mp3', 'AR15 rifle shot from 50 yards away'],
  427598: ['michorvath', '427/427598_3094998-hq.mp3', 'AR15 pistol shot'],
  427595: ['michorvath', '427/427595_3094998-hq.mp3', '20 gauge shotgun gunshot'],
  427592: ['michorvath', '427/427592_3094998-hq.mp3', '9mm pistol shot'],
  427599: ['michorvath', '427/427599_3094998-hq.mp3', 'AR15 pistol load and chamber'],
  427603: ['michorvath', '427/427603_3094998-hq.mp3', 'Rifle clip empty'],
  427593: ['michorvath', '427/427593_3094998-hq.mp3', '9mm pistol load and chamber'],
  828790: ['areniporgen', '828/828790_15072041-hq.mp3', 'SIG Sauer P226 (Suppressed)'],
  828786: ['areniporgen', '828/828786_15072041-hq.mp3', 'Glock 19X'],
  815698: ['modusmogulus', '815/815698_15956618-hq.mp3', 'AR15 Indoors (open windows)'],
  855654: ['serøutōnin--deprivəd', '855/855654_7157894-hq.mp3', 'An automatic rifle being shot once // punchy sounding'],
  855655: ['serøutōnin--deprivəd', '855/855655_7157894-hq.mp3', 'An automatic rifle being shot once // metallic and punchy'],
  855841: ['serøutōnin--deprivəd', '855/855841_7157894-hq.mp3', 'An AK-47 being shot // metallic kalashnikov report'],
  855842: ['serøutōnin--deprivəd', '855/855842_7157894-hq.mp3', 'An AK-47 being shot // punchy kalashnikov report'],
  410552: ['straget', '410/410552_7707368-hq.mp3', 'Rifle kaliber 6.5-55 (forest)'],
  410551: ['straget', '410/410551_7707368-hq.mp3', 'Shotgun kaliber 20 (forest)'],
  377789: ['johanwestling', '377/377789_4817223-hq.mp3', 'gun_9mm_15m_in_front_m10'],
  402789: ['acidsnowflake', '402/402789_7111288-hq.mp3', 'Small pistol gunshot indoors'],
  752629: ['modusmogulus', '752/752629_15956618-hq.mp3', 'Grenade Open Field High Quality 2'],
  752628: ['modusmogulus', '752/752628_15956618-hq.mp3', 'Flashbang Open Field High Quality'],
  752630: ['modusmogulus', '752/752630_15956618-hq.mp3', 'Explosion And Schrapnel Fly-by'],
  423301: ['u1769092', '423/423301_8202639-hq.mp3', 'VisceralBulletImpacts'],
  789388: ['modusmogulus', '789/789388_15956618-hq.mp3', 'Bullet impact ground (subsonic) SFX'],
  399550: ['BorekPL', '399/399550_3223478-hq.mp3', 'bullet hits the car'],
  267893: ['coolguy244e', '267/267893_4657534-hq.mp3', 'Bullet Hit Metal'],
  351371: ['wilhellboy', '351/351371_4603244-hq.mp3', 'HeavyBulletPing'],
  116645: ['Woodingp', '116/116645_596857-hq.mp3', 'bullets hit EDIT'],
  30932: ['aust_paul', '30/30932_15696-hq.mp3', 'bullet ricochet'],
  148840: ['cedarstudios', '148/148840_2676248-hq.mp3', 'ricochet'],
  319226: ['worthahep88', '319/319226_3443504-hq.mp3', 'Single rock hitting wood'],
  319228: ['worthahep88', '319/319228_3443504-hq.mp3', 'Single Rock hitting wood 2'],
  319223: ['worthahep88', '319/319223_3443504-hq.mp3', 'Single Rock Hitting wood 3'],
  319222: ['worthahep88', '319/319222_3443504-hq.mp3', 'Single Rock hit Dirt'],
  319229: ['worthahep88', '319/319229_3443504-hq.mp3', 'Single Rock hit dirt 2'],
  276938: ['gladkiy', '276/276938_2364707-hq.mp3', 'breaking_glass_mirror_Rode_NTG3'],
  565182: ['BlondPanda', '565/565182_8927049-hq.mp3', 'Distant Indoor Glass Breaking'],
};

// One clip = layers mixed together. Layer: { src, at (s), len (s), rate, gain (linear), off (s), hp / lp (Hz) }.
// Clip options: peak (normalised level), fade (fraction of the clip faded out at the end).
const L = (src, at, len, o = {}) => ({ src, at, len, ...o });
const CLIPS = {
  // ---- player / enemy guns, outdoors (the recordings carry their own open-air tail) ----
  shot_m4_0: [L(427596, 0.07, 1.1)],
  shot_m4_1: [L(855655, 0.01, 0.95)],
  shot_m4_2: [L(855654, 0.0, 0.75)],
  // suppressed 5.56: the pop of a suppressed shot, the bullet's supersonic crack and the bolt carrier cycling
  shot_m4s_0: [L(828790, 0.768, 0.5, { rate: 0.9 }), L(427598, 0.03, 0.006, { gain: 0.5, hp: 1500 }), L(427599, 4.235, 0.12, { gain: 0.45, off: 0.02 })],
  shot_m4s_1: [L(828790, 1.468, 0.5, { rate: 0.87 }), L(427596, 0.07, 0.006, { gain: 0.5, hp: 1500 }), L(427599, 4.235, 0.12, { gain: 0.42, off: 0.022, rate: 1.04 })],
  shot_m4s_2: [L(828790, 0.768, 0.5, { rate: 0.94 }), L(427598, 0.03, 0.006, { gain: 0.45, hp: 1800 }), L(427599, 4.235, 0.12, { gain: 0.5, off: 0.019, rate: 0.97 })],
  shot_ak_0: [L(855841, 0.01, 1.0)],
  shot_ak_1: [L(855842, 0.01, 1.1)],
  shot_ak_2: [L(855841, 0.01, 1.0, { rate: 0.96 })],
  shot_pistol_0: [L(828786, 0.005, 0.9)],
  shot_pistol_1: [L(427592, 0.125, 0.9)],
  shot_pistol_2: [L(828786, 0.005, 0.9, { rate: 1.04 })],
  shot_shotgun_0: [L(427595, 0.055, 1.25, { rate: 0.94 })],
  shot_shotgun_1: [L(410551, 0.695, 1.5, { rate: 0.95 })],
  shot_shotgun_2: [L(427595, 0.055, 1.25, { rate: 0.9 })],
  // the forest throws back a clear echo half a second later: keep the roll, drop the echo
  shot_sniper_0: [L(410552, 0.575, 2.2, { duck: [0.47, 0.98, -15] })],
  shot_sniper_1: [L(427596, 0.07, 1.6, { rate: 0.8 })],
  shot_sniper_2: [L(410552, 0.575, 2.2, { rate: 0.94, duck: [0.5, 1.04, -15] })],
  shot_dmr_0: [L(410552, 0.575, 1.5, { rate: 1.04, duck: [0.45, 0.94, -15] })],
  shot_dmr_1: [L(855655, 0.01, 1.1, { rate: 0.9 })],
  shot_dmr_2: [L(427596, 0.07, 1.2, { rate: 0.88 })],
  shot_lmg_0: [L(427596, 0.07, 0.8, { rate: 0.94 })],
  shot_lmg_1: [L(855655, 0.01, 0.8, { rate: 0.93 })],
  shot_lmg_2: [L(855842, 0.01, 0.8, { rate: 0.97 })],
  // ---- indoors (office floor): the room is in the recording ----
  shotIn_rifle_0: [L(815698, 1.005, 0.75)],
  shotIn_rifle_1: [L(815698, 4.963, 0.75)],
  shotIn_rifle_2: [L(815698, 7.27, 0.75)],
  shotIn_rifle_3: [L(815698, 10.727, 0.75)],
  shotIn_rifle_4: [L(815698, 13.057, 0.75)],
  shotIn_pistol_0: [L(402789, 1.25, 0.8)],
  shotIn_pistol_1: [L(402789, 1.25, 0.8, { rate: 1.05 })],
  // ---- far away (50 yards and beyond) ----
  shotFar_rifle_0: [L(427597, 0.585, 2.2)],
  shotFar_rifle_1: [L(427597, 0.585, 2.2, { rate: 0.94 })],
  shotFar_pistol_0: [L(377789, 0.62, 1.3)],
  shotFar_pistol_1: [L(377789, 6.868, 1.3)],
  shotFar_pistol_2: [L(377789, 10.742, 1.3)],
  // ---- explosions ----
  explosion_0: [L(752630, 0.42, 3.6)],
  explosion_1: [L(752629, 0.0, 3.8)],
  flashbang_0: [L(752628, 0.0, 1.1, { duck: [0.42, 1.1, -18] })],
  // ---- bullet impacts by material ----
  imp_metal0: [L(267893, 0.252, 0.55)],
  imp_metal1: [L(399550, 0.112, 0.5)],
  imp_metal2: [L(399550, 3.666, 0.45)],
  imp_metal3: [L(116645, 0.264, 0.6)],
  imp_metal4: [L(351371, 0.035, 0.38)],
  imp_wood0: [L(319226, 0.165, 0.2)],
  imp_wood1: [L(319228, 0.085, 0.18)],
  imp_wood2: [L(319223, 0.035, 0.09)],
  imp_sand0: [L(789388, 0.0, 0.7)],
  imp_sand1: [L(319222, 0.282, 0.25, { gain: 2 }), L(789388, 0.33, 0.35, { gain: 0.35 })],
  imp_sand2: [L(319229, 0.33, 0.25, { gain: 2 }), L(789388, 0.43, 0.3, { gain: 0.35 })],
  imp_glass0: [L(565182, 0.035, 1.2)],
  imp_glass1: [L(276938, 1.86, 1.4)],
  imp_flesh0: [L(423301, 0.175, 0.2)],
  imp_flesh1: [L(423301, 0.522, 0.2)],
  imp_flesh2: [L(423301, 1.2, 0.22)],
  imp_flesh3: [L(423301, 1.58, 0.2)],
  imp_flesh4: [L(423301, 1.902, 0.22)],
  rico_0: [L(30932, 0.02, 0.45)],
  rico_1: [L(30932, 0.985, 0.55)],
  rico_2: [L(30932, 1.62, 0.55)],
  rico_3: [L(148840, 0.028, 0.35)],
  rico_4: [L(148840, 0.432, 0.38)],
  // ---- gun handling ----
  magOut: [L(427599, 0.792, 0.16)],
  magIn: [L(427599, 2.022, 0.2)],
  charge: [L(427599, 4.232, 0.28)],
  slide: [L(427593, 1.528, 0.34)],
  dry: [L(427603, 0.055, 0.14)],
};
const PEAK = { explosion_0: 0.98, explosion_1: 0.98, flashbang_0: 0.98 };

async function source(id) {
  const file = path.join(CACHE, `${id}.mp3`);
  if (!fs.existsSync(file)) {
    const r = await fetch(`https://cdn.freesound.org/previews/${SOURCES[id][1]}`);
    if (!r.ok) throw new Error(`download ${id}: ${r.status}`);
    fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  }
  return fs.readFileSync(file).toString('base64');
}

fs.mkdirSync(CACHE, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });
const used = [...new Set(Object.values(CLIPS).flat().map((l) => l.src))];
const data = {};
for (const id of used) data[id] = await source(id);

const browser = await chromium.launch();
const page = await browser.newPage();
const pcm = await page.evaluate(async ({ data, CLIPS, PEAK }) => {
  const SR = 48000, ac = new OfflineAudioContext(1, 1, SR), src = {};
  for (const [id, b64] of Object.entries(data)) {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const buf = await ac.decodeAudioData(bytes.buffer);
    const x = new Float32Array(buf.length);
    for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < x.length; i++) x[i] += d[i] / buf.numberOfChannels; }
    src[id] = x;
  }
  const onePole = (y, f, high) => { const a = Math.exp(-2 * Math.PI * f / SR); let s = 0; for (let i = 0; i < y.length; i++) { s = a * s + (1 - a) * y[i]; if (high) y[i] -= s; else y[i] = s; } };
  const out = {};
  for (const [name, layers] of Object.entries(CLIPS)) {
    const total = Math.max(...layers.map((l) => (l.off || 0) + l.len / (l.rate || 1)));
    const y = new Float32Array(Math.ceil(total * SR) + 1);
    for (const l of layers) {
      const x = src[l.src], rate = l.rate || 1, s0 = Math.max(0, Math.round((l.at - 0.003) * SR));
      const n = Math.ceil(l.len / rate * SR), seg = new Float32Array(n);
      for (let i = 0; i < n; i++) { const p = s0 + i * rate, i0 = Math.floor(p), f = p - i0; seg[i] = i0 + 1 < x.length ? x[i0] * (1 - f) + x[i0 + 1] * f : 0; }
      if (l.duck) {
        // smooth gain dip over [t0, t1] seconds after the slice start (a 40 ms ramp either side)
        const [t0, t1, db] = l.duck, g = Math.pow(10, db / 20), r = 0.04;
        for (let i = 0; i < n; i++) { const t = i / SR; const w = Math.min(Math.max(0, (t - t0 + r) / r), 1, Math.max(0, (t1 + r - t) / r)); seg[i] *= 1 + (g - 1) * w; }
      }
      if (l.hp) onePole(seg, l.hp, true);
      if (l.lp) onePole(seg, l.lp, false);
      // short fade-in so a slice never starts with a click; layer tails fade out
      const fi = Math.min(n, 48), fo = Math.floor(n * 0.2);
      for (let i = 0; i < fi; i++) seg[i] *= i / fi;
      for (let i = 0; i < fo; i++) seg[n - 1 - i] *= i / fo;
      const o = Math.round((l.off || 0) * SR), g = l.gain ?? 1;
      for (let i = 0; i < n && o + i < y.length; i++) y[o + i] += seg[i] * g;
    }
    // remove DC, normalise, fade the tail out along an exponential
    onePole(y, 20, true);
    let pk = 0; for (const v of y) pk = Math.max(pk, Math.abs(v));
    const k = (PEAK[name] ?? 0.95) / (pk || 1), fo = Math.floor(y.length * 0.35);
    for (let i = 0; i < y.length; i++) {
      const r = i > y.length - fo ? (y.length - i) / fo : 1;
      y[i] = Math.max(-1, Math.min(1, y[i] * k * r * r));
    }
    const i16 = new Int16Array(y.length); for (let i = 0; i < y.length; i++) i16[i] = y[i] * 32767;
    const u8 = new Uint8Array(i16.buffer); let bin = '';
    for (let i = 0; i < u8.length; i += 32768) bin += String.fromCharCode(...u8.subarray(i, i + 32768));
    out[name] = btoa(bin);
  }
  return out;
}, { data, CLIPS, PEAK }).catch(async (e) => { await browser.close(); throw e; });
await browser.close();

const manifest = {};
let bytes = 0;
for (const [name, b64] of Object.entries(pcm)) {
  const buf = Buffer.from(b64, 'base64');
  const samples = new Int16Array(buf.buffer, buf.byteOffset, buf.length / 2);
  const enc = new lamejs.Mp3Encoder(1, 48000, name.startsWith('explosion') || name.startsWith('flashbang') ? 128 : 112);
  const parts = [];
  for (let i = 0; i < samples.length; i += 1152) { const m = enc.encodeBuffer(samples.subarray(i, i + 1152)); if (m.length) parts.push(Buffer.from(m)); }
  const end = enc.flush(); if (end.length) parts.push(Buffer.from(end));
  const mp3 = Buffer.concat(parts);
  fs.writeFileSync(path.join(OUT, `${name}.mp3`), mp3);
  manifest[name] = `${name}.mp3`;
  bytes += mp3.length;
}
fs.writeFileSync(path.join(OUT, 'sounds.json'), JSON.stringify(manifest, null, 1) + '\n');
const credits = ['# Recorded sounds', '', 'Every recording used here is released into the public domain (Creative Commons 0) on freesound.org. They were sliced, pitched, filtered, layered and re-encoded by `tools/build-sounds.mjs`.', ''];
for (const id of used.sort((a, b) => a - b)) credits.push(`- "${SOURCES[id][2]}" by ${SOURCES[id][0]}: https://freesound.org/s/${id}/`);
fs.writeFileSync(path.join(OUT, 'CREDITS.md'), credits.join('\n') + '\n');
console.log(`${Object.keys(manifest).length} clips, ${(bytes / 1024).toFixed(0)} KB, from ${used.length} recordings`);
