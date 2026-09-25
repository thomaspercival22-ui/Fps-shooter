// Procedural audio. Every sound in the game is synthesised at startup with an
// OfflineAudioContext, so the game needs no audio files and works offline.
// Positional sounds get distance attenuation, stereo panning, air absorption,
// wall occlusion and speed-of-sound delay.

const SR = 44100;

function tanhCurve(k) {
  const n = 1024, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(x * k) / Math.tanh(k); }
  return c;
}

class Synth {
  constructor(dur, channels = 1) {
    this.ctx = new OfflineAudioContext(channels, Math.ceil(dur * SR), SR);
    this.out = this.ctx.createGain();
    this.out.connect(this.ctx.destination);
  }
  noise(dur, t0 = 0) {
    const len = Math.ceil(dur * SR);
    const b = this.ctx.createBuffer(1, len, SR);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const s = this.ctx.createBufferSource();
    s.buffer = b;
    s.start(t0);
    return s;
  }
  filter(type, freq, q = 0.7) {
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    return f;
  }
  /** Gain with an attack/exponential decay envelope. */
  env(t0, attack, peak, decay, dest = this.out) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, 0);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(Math.max(peak * 0.0005, 1e-5), t0 + attack + decay);
    g.connect(dest);
    return g;
  }
  osc(type, f0, f1, t0, dur) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    o.start(t0); o.stop(t0 + dur + 0.05);
    return o;
  }
  chain(...nodes) { for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]); return nodes[nodes.length - 1]; }
  drive(k, dest = this.out) {
    const w = this.ctx.createWaveShaper();
    w.curve = tanhCurve(k);
    w.connect(dest);
    return w;
  }
  echo(src, times, dest = this.out) {
    for (const [t, g, lp] of times) {
      const d = this.ctx.createDelay(3); d.delayTime.value = t;
      const f = this.filter('lowpass', lp);
      const gg = this.ctx.createGain(); gg.gain.value = g;
      src.connect(d); d.connect(f); f.connect(gg); gg.connect(dest);
    }
  }
  render() { return this.ctx.startRendering(); }
}

// ---------------- recipes ----------------
function gunshot(p) {
  const dur = p.long ? 2.4 : 1.6;
  const s = new Synth(dur);
  s.out.gain.value = p.gain ?? 0.9;
  const bus = s.drive(p.drive ?? 2.6);
  const dry = s.ctx.createGain(); dry.connect(bus);
  // 1 supersonic crack / muzzle blast transient
  s.chain(s.noise(0.08), s.filter('highpass', p.crackHp ?? 1800), s.env(0, 0.0006, p.crack ?? 1, 0.045, dry));
  // 2 blast body with closing lowpass
  const lp = s.filter('lowpass', p.lp0 ?? 6000, 0.8);
  lp.frequency.setValueAtTime(p.lp0 ?? 6000, 0);
  lp.frequency.exponentialRampToValueAtTime(p.lp1 ?? 450, 0.14);
  s.chain(s.noise(0.6), lp, s.env(0, 0.0015, p.body ?? 0.95, p.bodyDecay ?? 0.22, dry));
  // 3 low-frequency boom
  s.chain(s.osc('sine', p.f0 ?? 140, p.f1 ?? 42, 0, 0.14), s.env(0, 0.002, p.boom ?? 0.8, p.boomDecay ?? 0.2, dry));
  // 4 mechanical action
  if (p.mech !== false) {
    s.chain(s.noise(0.03, 0.012), s.filter('bandpass', p.mechF ?? 3200, 5), s.env(0.012, 0.001, 0.25, 0.02, dry));
    s.chain(s.noise(0.03, 0.05), s.filter('bandpass', (p.mechF ?? 3200) * 0.7, 6), s.env(0.05, 0.001, 0.15, 0.025, dry));
  }
  // 5 reverberant tail + slap-back echoes off the buildings
  const tail = s.filter('lowpass', p.tailLp ?? 900);
  s.chain(s.noise(dur), tail, s.env(0.008, 0.03, p.tail ?? 0.2, p.tailDecay ?? 1.1, bus));
  s.echo(dry, [[0.13, 0.18, 2500], [0.29, 0.12, 1500], [0.52, 0.07, 900], [0.8, 0.04, 700]], bus);
  return s.render();
}

function explosion(flash = false) {
  const dur = flash ? 2.2 : 3.6;
  const s = new Synth(dur);
  s.out.gain.value = 1;
  const bus = s.drive(flash ? 4 : 3.2);
  if (flash) {
    s.chain(s.noise(0.2), s.filter('highpass', 900), s.env(0, 0.0008, 1.2, 0.12, bus));
    s.chain(s.noise(1), s.filter('lowpass', 3000), s.env(0, 0.002, 0.9, 0.35, bus));
    s.chain(s.osc('sine', 110, 40, 0, 0.3), s.env(0, 0.002, 0.9, 0.3, bus));
  } else {
    s.chain(s.noise(0.15), s.filter('highpass', 700), s.env(0, 0.001, 0.8, 0.08, bus));
    const lp = s.filter('lowpass', 2500, 0.7);
    lp.frequency.setValueAtTime(2500, 0); lp.frequency.exponentialRampToValueAtTime(140, 1.2);
    s.chain(s.noise(dur), lp, s.env(0, 0.004, 1.3, 1.6, bus));
    s.chain(s.osc('sine', 70, 24, 0, 1.2), s.env(0, 0.004, 1.2, 1.1, bus));
    // debris crackle
    for (let i = 0; i < 26; i++) {
      const t = 0.15 + Math.random() * 1.6;
      s.chain(s.noise(0.02, t), s.filter('bandpass', 1500 + Math.random() * 2500, 3), s.env(t, 0.001, 0.08 + Math.random() * 0.12, 0.02, bus));
    }
  }
  const tail = s.filter('lowpass', 500);
  s.chain(s.noise(dur), tail, s.env(0.02, 0.1, flash ? 0.3 : 0.5, dur * 0.6, bus));
  return s.render();
}

function clicks(list, dur = 0.5) {
  // list: [time, freq, q, gain, decay, thumpFreq?]
  const s = new Synth(dur);
  for (const [t, f, q, g, d, th] of list) {
    s.chain(s.noise(d + 0.02, t), s.filter('bandpass', f, q), s.env(t, 0.0008, g, d));
    if (th) s.chain(s.osc('sine', th, th * 0.6, t, 0.06), s.env(t, 0.001, g * 0.6, 0.05));
  }
  return s.render();
}

function scrape(t0, dur, f0, f1, g, s) {
  const bp = s.filter('bandpass', f0, 2.5);
  bp.frequency.setValueAtTime(f0, t0); bp.frequency.linearRampToValueAtTime(f1, t0 + dur);
  s.chain(s.noise(dur + 0.05, t0), bp, s.env(t0, dur * 0.3, g, dur * 0.8));
}

function charge() {
  const s = new Synth(0.5);
  scrape(0, 0.12, 900, 1600, 0.35, s);
  s.chain(s.noise(0.05, 0.19), s.filter('bandpass', 2400, 4), s.env(0.19, 0.001, 0.8, 0.04));
  s.chain(s.osc('sine', 260, 140, 0.19, 0.06), s.env(0.19, 0.001, 0.5, 0.06));
  return s.render();
}
function bolt(back) {
  const s = new Synth(0.45);
  if (back) {
    s.chain(s.noise(0.04, 0), s.filter('bandpass', 2600, 5), s.env(0, 0.001, 0.5, 0.03));
    scrape(0.05, 0.14, 1300, 800, 0.4, s);
  } else {
    scrape(0, 0.12, 800, 1400, 0.35, s);
    s.chain(s.noise(0.04, 0.13), s.filter('bandpass', 2900, 5), s.env(0.13, 0.001, 0.7, 0.035));
    s.chain(s.noise(0.04, 0.22), s.filter('bandpass', 2100, 5), s.env(0.22, 0.001, 0.5, 0.03));
  }
  return s.render();
}
function brass(pitch = 1) {
  const s = new Synth(0.35);
  const fs = [4200, 6100, 7700, 9400].map((f) => f * pitch * (0.95 + Math.random() * 0.1));
  fs.forEach((f, i) => s.chain(s.osc('sine', f, f, 0, 0.3), s.env(0, 0.001, 0.12 / (i + 1), 0.12 + Math.random() * 0.1)));
  s.chain(s.noise(0.02), s.filter('highpass', 5000), s.env(0, 0.0005, 0.15, 0.01));
  return s.render();
}
function footstep() {
  const s = new Synth(0.22);
  // gravel crunch: a cluster of tiny noise grains
  for (let i = 0; i < 14; i++) {
    const t = Math.random() * 0.09;
    s.chain(s.noise(0.012, t), s.filter('bandpass', 700 + Math.random() * 2200, 1.5), s.env(t, 0.0008, 0.12 + Math.random() * 0.2, 0.008 + Math.random() * 0.012));
  }
  s.chain(s.noise(0.1), s.filter('lowpass', 350), s.env(0, 0.004, 0.45, 0.06));
  return s.render();
}
/** Bullet impact on a material: each has its own transient, body and debris. */
function impact(kind) {
  const s = new Synth(0.7);
  const R = (a, b) => a + Math.random() * (b - a);
  const debris = (n, t0, t1, f, vol, q = 2) => {
    for (let i = 0; i < n; i++) { const t = R(t0, t1); s.chain(s.noise(0.012, t), s.filter('bandpass', f * R(0.7, 1.4), q), s.env(t, 0.0005, vol * R(0.4, 1), R(0.006, 0.02))); }
  };
  if (kind === 'metal') {
    // hard "tank": sharp click, then inharmonic ringing partials of a steel sheet
    s.chain(s.noise(0.02), s.filter('highpass', 3000), s.env(0, 0.0003, 0.9, 0.012));
    [870, 1430, 2310, 3170, 4480].forEach((f, i) => s.chain(s.osc('sine', f * R(0.94, 1.06), f * R(0.97, 1.0), 0, 0.6), s.env(0, 0.0008, 0.3 / (i + 1.3), R(0.25, 0.5))));
    s.chain(s.osc('triangle', R(180, 260), 120, 0, 0.12), s.env(0, 0.001, 0.35, 0.09));
  } else if (kind === 'wood') {
    // dull knock with splintering
    s.chain(s.osc('sine', R(360, 460), 170, 0, 0.09), s.env(0, 0.001, 0.7, 0.07));
    s.chain(s.noise(0.08), s.filter('bandpass', R(700, 1000), 1.8), s.env(0, 0.0008, 0.7, 0.05));
    debris(6, 0.01, 0.09, 2600, 0.12, 3);
  } else if (kind === 'flesh') {
    s.chain(s.osc('sine', 130, 60, 0, 0.12), s.env(0, 0.002, 0.9, 0.09));
    s.chain(s.noise(0.1), s.filter('lowpass', 600), s.env(0, 0.001, 0.8, 0.07));
  } else if (kind === 'sand') {
    // soft thump, sand spray hiss
    s.chain(s.osc('sine', 110, 55, 0, 0.08), s.env(0, 0.002, 0.5, 0.06));
    s.chain(s.noise(0.25), s.filter('lowpass', 1600), s.env(0, 0.002, 0.55, 0.09));
    s.chain(s.noise(0.3, 0.02), s.filter('bandpass', 5000, 0.8), s.env(0.02, 0.01, 0.1, 0.18));
  } else if (kind === 'glass') {
    s.chain(s.noise(0.02), s.filter('highpass', 4000), s.env(0, 0.0003, 0.9, 0.01));
    [3200, 4700, 6100].forEach((f) => s.chain(s.osc('sine', f * R(0.9, 1.1), f, 0, 0.3), s.env(0, 0.0006, 0.15, 0.12)));
    debris(22, 0.02, 0.45, 6000, 0.2, 5); // shards tinkling down
  } else if (kind === 'rubber') {
    s.chain(s.osc('sine', 150, 90, 0, 0.1), s.env(0, 0.002, 0.8, 0.07));
    s.chain(s.noise(0.05), s.filter('lowpass', 900), s.env(0, 0.001, 0.4, 0.03));
  } else if (kind === 'plaster') {
    // softer crack, crumbling plaster
    s.chain(s.noise(0.05), s.filter('bandpass', 1500, 1), s.env(0, 0.0006, 0.8, 0.04));
    s.chain(s.osc('sine', 240, 110, 0, 0.06), s.env(0, 0.001, 0.4, 0.05));
    s.chain(s.noise(0.35, 0.02), s.filter('bandpass', 2400, 1.2), s.env(0.02, 0.02, 0.12, 0.22));
    debris(8, 0.03, 0.3, 2200, 0.1);
  } else if (kind === 'water') {
    s.chain(s.noise(0.2), s.filter('bandpass', 1200, 0.9), s.env(0, 0.001, 0.6, 0.12));
    s.chain(s.osc('sine', 900, 1700, 0.01, 0.06), s.env(0.01, 0.003, 0.25, 0.05)); // bubble "plip"
  } else { // concrete / masonry
    s.chain(s.noise(0.06), s.filter('bandpass', 2200, 1.2), s.env(0, 0.0005, 0.9, 0.03));
    s.chain(s.osc('sine', 300, 120, 0, 0.05), s.env(0, 0.001, 0.35, 0.04));
    debris(9, 0.02, 0.25, 3000, 0.1);
  }
  return s.render();
}

/** Ricochet: the deformed bullet tumbling away with a falling whine. */
function ricochet() {
  const s = new Synth(0.9);
  const f0 = 2600 + Math.random() * 1600, f1 = 500 + Math.random() * 400, dur = 0.5 + Math.random() * 0.3;
  s.chain(s.noise(0.02), s.filter('highpass', 2500), s.env(0, 0.0003, 0.8, 0.015)); // strike
  const o = s.osc('sawtooth', f0, f1, 0.01, dur);
  const lfo = s.osc('sine', 18 + Math.random() * 10, 18, 0.01, dur); // tumbling wobble
  const lg = s.ctx.createGain(); lg.gain.value = 120; s.chain(lfo, lg); lg.connect(o.frequency);
  s.chain(o, s.filter('bandpass', 2000, 1.5), s.env(0.01, 0.02, 0.35, dur));
  s.chain(s.noise(dur), s.filter('bandpass', 2400, 4), s.env(0.01, 0.03, 0.12, dur));
  return s.render();
}
function whiz() {
  const s = new Synth(0.4);
  const bp = s.filter('bandpass', 3000, 3);
  bp.frequency.setValueAtTime(3400, 0); bp.frequency.exponentialRampToValueAtTime(700, 0.3);
  const g = s.ctx.createGain();
  g.gain.setValueAtTime(0, 0); g.gain.linearRampToValueAtTime(0.9, 0.08); g.gain.exponentialRampToValueAtTime(0.001, 0.32);
  g.connect(s.out);
  s.chain(s.noise(0.4), bp, g);
  s.chain(s.noise(0.01), s.filter('highpass', 3000), s.env(0.02, 0.0004, 0.9, 0.008));
  return s.render();
}
function grunt(f0, dur, formants, gain = 0.5) {
  const s = new Synth(dur + 0.2);
  const o = s.osc('sawtooth', f0, f0 * 0.75, 0, dur);
  const vib = s.ctx.createOscillator(); vib.frequency.value = 7; const vg = s.ctx.createGain(); vg.gain.value = f0 * 0.03;
  vib.connect(vg); vg.connect(o.frequency); vib.start(0);
  const env = s.ctx.createGain();
  env.gain.setValueAtTime(0, 0); env.gain.linearRampToValueAtTime(gain, 0.03); env.gain.setValueAtTime(gain, dur * 0.5); env.gain.exponentialRampToValueAtTime(0.001, dur);
  env.connect(s.out);
  for (const [f, q, g] of formants) {
    const bp = s.filter('bandpass', f, q);
    const gg = s.ctx.createGain(); gg.gain.value = g;
    o.connect(bp); bp.connect(gg); gg.connect(env);
  }
  // breath noise
  s.chain(s.noise(dur), s.filter('bandpass', 1500, 1), s.env(0, 0.02, 0.05, dur));
  return s.render();
}
function tone(list, dur) {
  const s = new Synth(dur);
  for (const [t, f, g, d, type] of list) s.chain(s.osc(type || 'sine', f, f, t, d), s.env(t, 0.001, g, d));
  return s.render();
}
async function wind() {
  const dur = 8;
  const s = new Synth(dur + 1);
  const lp = s.filter('lowpass', 420, 0.5);
  const lfo = s.ctx.createOscillator(); lfo.frequency.value = 0.13;
  const lg = s.ctx.createGain(); lg.gain.value = 220;
  lfo.connect(lg); lg.connect(lp.frequency); lfo.start(0);
  const g = s.ctx.createGain(); g.gain.value = 0.35;
  s.chain(s.noise(dur + 1), lp, g, s.out);
  const hp = s.filter('bandpass', 1800, 4);
  const g2 = s.ctx.createGain(); g2.gain.value = 0.02;
  s.chain(s.noise(dur + 1), hp, g2, s.out);
  const buf = await s.render();
  // crossfade the last second into the start for a seamless loop
  const d = buf.getChannelData(0), n = SR;
  const out = new AudioBuffer({ length: dur * SR, sampleRate: SR, numberOfChannels: 1 });
  const o = out.getChannelData(0);
  for (let i = 0; i < dur * SR; i++) o[i] = d[i];
  for (let i = 0; i < n; i++) { const t = i / n; o[i] = d[i] * t + d[dur * SR + i] * (1 - t); }
  return out;
}

/** One-second seamless loop of FPV motors and prop wash (integer frequencies loop cleanly). */
/** Steady rain: pink noise hiss plus thousands of tiny droplet ticks (seamless 4 s loop). */
function rainLoop() {
  const n = SR * 4;
  const buf = new AudioBuffer({ length: n, sampleRate: SR, numberOfChannels: 1 });
  const d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0526;
    d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.05;
  }
  for (let k = 0; k < 9000; k++) {
    const at = (Math.random() * n) | 0, len = 40 + ((Math.random() * 120) | 0), a = 0.05 + Math.random() * 0.25, f = 0.25 + Math.random() * 0.6;
    for (let j = 0; j < len && at + j < n; j++) d[at + j] += Math.sin(j * f) * a * Math.exp(-j / (len * 0.25));
  }
  const f = 4000;
  for (let i = 0; i < f; i++) { const k = i / f; d[i] = d[i] * k + d[n - f + i] * (1 - k); }
  return buf;
}
/** Thunder: a sharp crack that rolls into a long, low rumble. */
function thunder() {
  const s = new Synth(7);
  s.chain(s.noise(0.3), s.filter('lowpass', 2500), s.env(0, 0.005, 0.5, 0.25));
  for (let i = 0; i < 6; i++) { const t = 0.1 + Math.random() * 2.5; s.chain(s.noise(3), s.filter('lowpass', 160 + Math.random() * 160), s.env(t, 0.3, 0.6 + Math.random() * 0.6, 2 + Math.random() * 2)); }
  return s.render();
}
function droneLoop() {
  const n = SR;
  const buf = new AudioBuffer({ length: n, sampleRate: SR, numberOfChannels: 1 });
  const d = buf.getChannelData(0);
  const saw = (x) => 2 * (x - Math.floor(x + 0.5));
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    lp += (Math.random() * 2 - 1 - lp) * 0.08;
    d[i] = 0.26 * saw(211 * t) + 0.18 * saw(422 * t + 0.3) + 0.12 * saw(633 * t + 0.1) + 0.1 * saw(197 * t + 0.6)
      + 0.14 * Math.sin(2 * Math.PI * 106 * t) + 0.35 * lp * (0.8 + 0.2 * Math.sin(2 * Math.PI * 7 * t));
  }
  const f = 2000;
  for (let i = 0; i < f; i++) { const k = i / f; d[i] = d[i] * k + d[n - f + i] * (1 - k); }
  return buf;
}

// ---------------- engine ----------------
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.buffers = {};
    this.ready = false;
    this.listener = { x: 0, y: 0, z: 0, yaw: 0 };
    this.occlusion = null; // fn(x,y,z) -> bool
    this.voices = 0;
    this.volume = 0.9;
  }

  /** Must be called from a user gesture (browser autoplay rules). */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC({ latencyHint: 'interactive' });
      const c = this.ctx;
      this.master = c.createGain(); this.master.gain.value = this.volume;
      this.comp = c.createDynamicsCompressor();
      this.comp.threshold.value = -14; this.comp.knee.value = 8; this.comp.ratio.value = 5; this.comp.attack.value = 0.002; this.comp.release.value = 0.2;
      this.muffle = c.createBiquadFilter(); this.muffle.type = 'lowpass'; this.muffle.frequency.value = 20000; this.muffle.Q.value = 0.5;
      this.sfx = c.createGain();
      this.sfx.connect(this.muffle); this.muffle.connect(this.comp); this.comp.connect(this.master); this.master.connect(c.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }

  async generate(onProgress) {
    const R = {};
    const jobs = [];
    const add = (name, p) => jobs.push(p.then((b) => { R[name] = b; }));
    const gun = {
      m4: { crack: 1, crackHp: 2000, lp0: 6500, lp1: 520, bodyDecay: 0.2, f0: 135, f1: 45, boom: 0.8, tail: 0.22 },
      ak: { crack: 0.85, crackHp: 1600, lp0: 4800, lp1: 380, bodyDecay: 0.25, f0: 115, f1: 40, boom: 0.9, tail: 0.25, mechF: 2600 },
      pistol: { crack: 0.9, crackHp: 2500, lp0: 5200, lp1: 700, bodyDecay: 0.13, f0: 190, f1: 65, boom: 0.5, tail: 0.14, mechF: 3800 },
      shotgun: { crack: 0.85, crackHp: 1200, lp0: 3800, lp1: 260, bodyDecay: 0.34, f0: 95, f1: 34, boom: 1.1, boomDecay: 0.3, tail: 0.35, drive: 3.2 },
      sniper: { crack: 1.1, crackHp: 1500, lp0: 5500, lp1: 300, bodyDecay: 0.38, f0: 85, f1: 30, boom: 1.1, boomDecay: 0.32, tail: 0.45, tailDecay: 1.8, long: true, mech: false, drive: 3.4 },
      dmr: { crack: 1, crackHp: 1700, lp0: 5200, lp1: 360, bodyDecay: 0.3, f0: 100, f1: 34, boom: 1, tail: 0.35, tailDecay: 1.4 },
      lmg: { crack: 0.9, crackHp: 1700, lp0: 5000, lp1: 420, bodyDecay: 0.22, f0: 120, f1: 42, boom: 0.85, tail: 0.24, mechF: 2300 },
    };
    for (const [k, p] of Object.entries(gun)) for (let v = 0; v < 3; v++) {
      add(`shot_${k}_${v}`, gunshot({ ...p, lp0: p.lp0 * (0.92 + Math.random() * 0.16), f0: p.f0 * (0.94 + Math.random() * 0.12) }));
    }
    add('explosion', explosion(false));
    add('flashbang', explosion(true));
    add('dry', clicks([[0, 2600, 5, 0.6, 0.02], [0.015, 1700, 6, 0.3, 0.02]], 0.1));
    add('magOut', clicks([[0, 1800, 4, 0.5, 0.03], [0.06, 900, 3, 0.4, 0.06, 160]], 0.3));
    add('magIn', clicks([[0, 1200, 3, 0.6, 0.04, 150], [0.07, 2600, 5, 0.7, 0.03]], 0.3));
    add('magTap', clicks([[0, 700, 2, 0.6, 0.04, 120]], 0.15));
    add('charge', charge());
    add('boltBack', bolt(true));
    add('boltFwd', bolt(false));
    add('slide', clicks([[0, 2300, 4, 0.7, 0.04, 220], [0.03, 3200, 6, 0.4, 0.02]], 0.2));
    add('shellIn', clicks([[0, 1400, 3, 0.5, 0.03], [0.05, 900, 3, 0.4, 0.05, 140]], 0.2));
    add('pin', tone([[0, 2900, 0.25, 0.25], [0, 4300, 0.12, 0.2], [0.28, 3600, 0.15, 0.12], [0.3, 5200, 0.08, 0.1]], 0.6));
    add('bounce', clicks([[0, 1800, 3, 0.5, 0.03, 700]], 0.12));
    add('hit', tone([[0, 1700, 0.35, 0.03, 'triangle']], 0.08));
    add('hitHead', tone([[0, 2600, 0.35, 0.18], [0, 3900, 0.2, 0.14], [0, 1300, 0.2, 0.06, 'triangle']], 0.3));
    add('kill', tone([[0, 180, 0.6, 0.12], [0, 1200, 0.25, 0.05, 'triangle'], [0.04, 900, 0.2, 0.08, 'triangle']], 0.25));
    add('heartbeat', tone([[0, 55, 0.9, 0.12], [0, 90, 0.4, 0.08], [0.28, 50, 0.7, 0.14], [0.28, 80, 0.3, 0.1]], 0.6));
    add('ui', clicks([[0, 3000, 4, 0.4, 0.015]], 0.05));
    add('pickup', clicks([[0, 1600, 3, 0.4, 0.03], [0.06, 2100, 3, 0.4, 0.03], [0.12, 1300, 3, 0.4, 0.04, 200]], 0.3));
    add('whiz0', whiz()); add('whiz1', whiz());
    add('crack', clicks([[0, 4500, 1, 1.2, 0.006]], 0.05));
    for (let i = 0; i < 3; i++) add(`brass${i}`, brass(1 + i * 0.07));
    add('shellPlastic', clicks([[0, 900, 2, 0.35, 0.04, 300], [0.07, 700, 2, 0.2, 0.03]], 0.2));
    for (let i = 0; i < 4; i++) add(`step${i}`, footstep());
    for (const k of ['concrete', 'metal', 'wood', 'flesh', 'sand', 'glass', 'rubber', 'plaster', 'water']) { add(`imp_${k}0`, impact(k)); add(`imp_${k}1`, impact(k)); }
    for (let i = 0; i < 3; i++) add(`rico${i}`, ricochet());
    add('hurt0', grunt(118, 0.2, [[650, 5, 1], [1100, 6, 0.6], [2400, 8, 0.2]], 0.5));
    add('hurt1', grunt(105, 0.24, [[560, 5, 1], [950, 6, 0.6], [2300, 8, 0.2]], 0.5));
    add('ehurt0', grunt(128, 0.22, [[700, 5, 1], [1200, 6, 0.5]], 0.6));
    add('ehurt1', grunt(96, 0.26, [[520, 5, 1], [900, 6, 0.5]], 0.6));
    add('edeath0', grunt(110, 0.55, [[600, 5, 1], [1000, 6, 0.6], [2500, 8, 0.2]], 0.7));
    add('edeath1', grunt(92, 0.7, [[500, 5, 1], [880, 6, 0.6]], 0.7));
    add('wind', wind());
    add('droneLoop', Promise.resolve(droneLoop()));
    add('rain', Promise.resolve(rainLoop()));
    add('thunder', thunder());
    add('nvg', tone([[0, 2400, 0.05, 0.5], [0.05, 4800, 0.03, 0.45], [0, 900, 0.3, 0.03, 'triangle']], 0.6));
    add('thermal', tone([[0, 1250, 0.18, 0.06, 'square'], [0.1, 1650, 0.14, 0.06, 'square']], 0.25));
    let done = 0;
    const total = jobs.length;
    jobs.forEach((j) => j.then(() => onProgress?.(++done / total)));
    await Promise.all(jobs);
    this.buffers = R;
    this.ready = true;
  }

  get time() { return this.ctx ? this.ctx.currentTime : 0; }

  /** Non-positional sound (player's own gun, UI...). */
  play(name, { vol = 1, rate = 1, pan = 0, delay = 0, lowpass = 0 } = {}) {
    if (!this.ready || !this.ctx || this.ctx.state !== 'running') return null;
    const buf = this.buffers[name];
    if (!buf) return null;
    if (this.voices > 48) return null;
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = c.createGain(); g.gain.value = vol;
    let node = src;
    if (lowpass) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lowpass; node.connect(f); node = f; }
    node.connect(g);
    let out = g;
    if (pan) { const p = c.createStereoPanner(); p.pan.value = pan; g.connect(p); out = p; }
    out.connect(this.sfx);
    this.voices++;
    src.onended = () => { this.voices--; };
    src.start(c.currentTime + delay);
    return src;
  }

  playVariant(prefix, count, opts) {
    return this.play(`${prefix}${(Math.random() * count) | 0}`, opts);
  }

  setListener(x, y, z, yaw) { const l = this.listener; l.x = x; l.y = y; l.z = z; l.yaw = yaw; }

  /** Positional sound with distance, panning, air absorption, occlusion and sound travel time. */
  playAt(name, x, y, z, { vol = 1, ref = 3, max = 250, rate = 1, travel = false, occlude = true } = {}) {
    const l = this.listener;
    const dx = x - l.x, dy = y - l.y, dz = z - l.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > max) return null;
    let gain = vol * ref / (ref + Math.max(0, dist - ref) * 1.1);
    let lp = Math.max(900, 20000 * Math.exp(-dist / 70));
    if (occlude && this.occlusion && dist > 2 && this.occlusion(x, y, z)) { gain *= 0.5; lp *= 0.18; }
    if (gain < 0.004) return null;
    // listener faces -Z rotated by yaw; right vector = (cos yaw, -sin yaw)
    const rx = Math.cos(l.yaw), rz = -Math.sin(l.yaw);
    const pan = dist > 0.5 ? Math.max(-1, Math.min(1, (dx * rx + dz * rz) / Math.hypot(dx, dz) * 0.8)) : 0;
    return this.play(name, { vol: gain, rate, pan, lowpass: lp < 19000 ? lp : 0, delay: travel ? dist / 343 : 0 });
  }

  startAmbience() {
    if (!this.ready || !this.ctx || this.ambient) return;
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.buffers.wind; src.loop = true;
    const g = c.createGain(); g.gain.value = 0.22;
    src.connect(g); g.connect(this.sfx);
    src.start();
    this.ambient = { src, g };
  }
  stopAmbience() { if (this.ambient) { this.ambient.src.stop(); this.ambient = null; } }

  /** Named looping bed (rain); muffle() lowers it when the listener is indoors. */
  startLoop(name, vol = 0.5) {
    if (!this.ready || !this.ctx || !this.buffers[name]) { this._pendingLoop = [name, vol]; return; }
    this.loops = this.loops || {};
    if (this.loops[name]) return;
    const c = this.ctx, src = c.createBufferSource();
    src.buffer = this.buffers[name]; src.loop = true;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 12000;
    const g = c.createGain(); g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(this.sfx);
    src.start();
    this.loops[name] = { src, g, f, vol };
  }
  stopLoop(name) { const l = this.loops?.[name]; if (l) { l.src.stop(); delete this.loops[name]; } if (this._pendingLoop?.[0] === name) this._pendingLoop = null; }
  loopMuffle(name, indoors) {
    const l = this.loops?.[name];
    if (!l) { if (this._pendingLoop?.[0] === name && this.ctx?.state === 'running') this.startLoop(...this._pendingLoop); return; }
    const t = this.ctx.currentTime;
    l.f.frequency.setTargetAtTime(indoors ? 900 : 12000, t, 0.2);
    l.g.gain.setTargetAtTime(l.vol * (indoors ? 0.8 : 1), t, 0.2);
  }

  /** Ringing ears + muffled hearing (flashbangs, nearby explosions). */
  tinnitus(strength, dur) {
    if (!this.ctx || strength <= 0) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(); o.frequency.value = 3700 + Math.random() * 400;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.06 * strength, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    o.connect(g); g.connect(this.comp);
    o.start(t); o.stop(t + dur + 0.1);
    const f = this.muffle.frequency;
    f.cancelScheduledValues(t);
    f.setValueAtTime(Math.max(250, 2000 * (1 - strength)), t);
    f.exponentialRampToValueAtTime(20000, t + dur * 0.9);
  }

  /** Continuous low-health muffling (0..1). */
  setLowHealth(k) {
    if (!this.ctx) return;
    if (this.muffle.frequency.value > 19000 || k > 0) {
      const target = 20000 - k * 17000;
      this.muffle.frequency.setTargetAtTime(target, this.ctx.currentTime, 0.2);
    }
  }
}

// ---------------- enemy radio callouts (speech synthesis) ----------------
export class Voices {
  constructor() {
    this.enabled = true;
    this.synth = window.speechSynthesis || null;
    this.voice = null;
    this.last = 0;
    if (this.synth) {
      const pick = () => {
        const vs = this.synth.getVoices().filter((v) => /^en/i.test(v.lang));
        this.voice = vs.find((v) => v.localService && /male|daniel|fred|alex|david|george/i.test(v.name)) || vs.find((v) => v.localService) || null;
      };
      pick();
      this.synth.onvoiceschanged = pick;
    }
  }
  say(text, pitch = 0.8, rate = 1.15, vol = 0.6) {
    if (!this.enabled || !this.synth || !this.voice) return;
    const now = performance.now();
    if (now - this.last < 1400 || this.synth.speaking) return;
    this.last = now;
    const u = new SpeechSynthesisUtterance(text);
    u.voice = this.voice; u.pitch = pitch; u.rate = rate; u.volume = vol;
    this.synth.speak(u);
  }
  cancel() { this.synth?.cancel(); }
}
