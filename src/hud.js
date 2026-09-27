// Heads-up display: ammo, health, crosshair, hit markers, damage direction,
// grenade warnings, minimap, kill feed, enemy radio chatter, scope overlay,
// flashbang whiteout and banners.
import { settings } from './settings.js';

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor(game) {
    this.game = game;
    this.el = {
      hud: $('hud'), ammoMag: $('ammo-mag'), ammoRes: $('ammo-res'), ammo: $('ammo'), weapon: $('weapon-name'), reload: $('reload-hint'),
      healthFill: $('health-fill'), healthNum: $('health-num'), cross: $('crosshair'), hit: $('hitmarker'),
      dmg: $('dmg-indicators'), gren: $('grenade-indicators'), killfeed: $('killfeed'), radio: $('radio'),
      banner: $('banner'), bannerT: $('banner-title'), bannerS: $('banner-sub'), wave: $('wave-label'), hostiles: $('hostiles'),
      score: $('score'), pickup: $('pickup-msg'), scope: $('scope'), fps: $('fps'), frag: $('frag-count'), flash: $('flash-count'),
      btnFrag: $('btn-frag'), btnFlash: $('btn-flash'), vignette: $('vignette'),
      osd: $('osd'), osdMsg: $('osd-msg'), osdBat: $('osd-bat'), osdTime: $('osd-time'), osdRssi: $('osd-rssi'), osdAlt: $('osd-alt'),
      osdSpd: $('osd-spd'), osdHome: $('osd-home'), osdArmed: $('osd-armed'), osdHorizon: $('osd-horizon'), modeLabel: $('mode-label'),
      droneCount: $('drone-count'), btnDrone: $('btn-drone'), btnNvg: $('btn-nvg'), btnThermal: $('btn-thermal'),
      objWarn: $('obj-warn'), range: $('range-readout'), scopeData: $('scope-data'), btnZoom: $('btn-zoom'), zeroLabel: $('zero-label'),
      scopeMark: $('scope-mark'),
    };
    this.mark = null;
    this.rangeT = 0;
    this.rangeText = '';
    this.cross = [...this.el.cross.querySelectorAll('.ch')];
    this.damageCanvas = $('damage-overlay');
    this.dctx = this.damageCanvas.getContext('2d');
    this.minimap = $('minimap');
    this.mctx = this.minimap.getContext('2d');
    this.scopeCanvas = $('scope-reticle');
    this.after = $('afterimage');
    this.actx = this.after.getContext('2d');
    this.white = document.createElement('div');
    Object.assign(this.white.style, { position: 'fixed', inset: '0', background: '#fff', opacity: '0', pointerEvents: 'none', zIndex: '7' });
    document.body.appendChild(this.white);
    // chaos mode: a pie in the face
    this.creamEl = document.createElement('canvas');
    this.creamEl.width = 480; this.creamEl.height = 270;
    Object.assign(this.creamEl.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', opacity: '0', pointerEvents: 'none', zIndex: '6' });
    document.body.appendChild(this.creamEl);
    this.creamT = 0;
    this.hitT = 0;
    this.hurtT = 0;
    this.suppressT = 0;
    this.flashT = 0; this.flashDur = 1; this.flashK = 0;
    this.bannerT = 0;
    this.pickupT = 0;
    this.indicators = [];
    this.last = {};
    this.mapImage = null;
    this.frame = 0;
    this.fpsAcc = 0; this.fpsN = 0;
    this.spread = 0;
  }

  show(on) { this.creamT = 0; this.creamEl.style.opacity = '0'; this.el.hud.classList.toggle('hidden', !on); document.getElementById('touch').classList.toggle('hidden', !on || !this.game.input.touchMode);
    document.getElementById('pause-hint').classList.toggle('hidden', this.game.input.touchMode); }

  resize(w, h) {
    this.damageCanvas.width = Math.ceil(w / 3); this.damageCanvas.height = Math.ceil(h / 3);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.scopeCanvas.width = w * dpr; this.scopeCanvas.height = h * dpr; this.scopeDpr = dpr;
    this.after.width = Math.ceil(w / 2); this.after.height = Math.ceil(h / 2);
    this._drawScope();
    this.last.dmgDraw = -1;
  }

  buildMinimap(level) {
    const S = 4, R = level.bounds + 4;
    const c = document.createElement('canvas');
    c.width = c.height = Math.ceil(R * 2 * S);
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgba(40,36,28,0.55)';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = 'rgba(220,210,190,0.75)';
    for (const b of level.minimap) ctx.fillRect((b.x0 + R) * S, (b.z0 + R) * S, Math.max(1.5, (b.x1 - b.x0) * S), Math.max(1.5, (b.z1 - b.z0) * S));
    // resupply marker
    ctx.fillStyle = '#7fd46a';
    ctx.fillRect((level.resupply.x + R) * S - 5, (level.resupply.z + R) * S - 5, 10, 10);
    this.mapImage = { c, S, R };
  }

  // ---------------- drone / vision modes ----------------
  droneMode(on) {
    document.body.classList.toggle('drone', on);
    this.el.osd.classList.toggle('hidden', !on);
  }
  osdMessage(text, dur = 1.5) {
    this.el.osdMsg.textContent = text;
    this.el.osdMsg.style.opacity = 1;
    this.osdMsgT = dur;
  }
  _updateOSD(dt) {
    const g = this.game, d = g.drone, e = this.el;
    if (this.osdMsgT > 0) { this.osdMsgT -= dt; if (this.osdMsgT <= 0) e.osdMsg.style.opacity = 0; }
    if (!d.active) return;
    if (this.frame % 4) return;
    const volts = (14.0 + d.battery * 2.8 - Math.min(0.6, d.speed / 40)).toFixed(1);
    e.osdBat.textContent = `${volts}V  ${Math.round(d.battery * 100)}%`;
    const t = Math.floor(d.flightT);
    e.osdTime.textContent = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
    const rssi = Math.round(d.signal * 99);
    e.osdRssi.textContent = `RSSI ${String(rssi).padStart(2, '0')} ${'▮'.repeat(Math.ceil(d.signal * 5))}${'▯'.repeat(5 - Math.ceil(d.signal * 5))}`;
    e.osdAlt.textContent = `ALT ${Math.round(d.pos.y)}m`;
    e.osdSpd.textContent = `${Math.round(d.speed * 3.6)} KM/H`;
    e.osdHome.textContent = `HOME ${Math.round(Math.hypot(d.pos.x - d.home.x, d.pos.z - d.home.z))}m`;
    const armed = d.armed;
    if (this.last.armed !== armed) { e.osdArmed.textContent = armed ? 'ARMED' : 'ARMING...'; e.osdArmed.classList.toggle('armed', armed); this.last.armed = armed; }
    e.osdHorizon.style.transform = `translateY(${(d.pitch + d.bodyPitch * 0.35) * 160}px) rotate(${-d.bodyRoll * 0.9}rad)`;
  }

  // ---------------- events ----------------
  onFire() { this.spreadKick = 1; }
  malfunction() { this.pickup('MALFUNCTION'); this.game.audio.play('dry', { vol: 0.8 }); }

  hitMarker(kind) {
    const h = this.el.hit;
    h.className = kind === 'kill' ? 'kill' : kind === 'head' ? 'head' : kind === 'civ' ? 'civ' : '';
    this.hitT = kind === 'kill' ? 0.45 : 0.22;
    h.style.opacity = 1;
    this.game.audio.play(kind === 'kill' ? 'kill' : kind === 'head' ? 'hitHead' : 'hit', { vol: kind === 'hit' || kind === 'civ' ? 0.4 : 0.55 });
  }

  damageFrom(x, z) {
    const el = document.createElement('div');
    el.className = 'dmg-ind';
    this.el.dmg.appendChild(el);
    this.indicators.push({ el, x, z, t: 1.6 });
  }

  /** Chaos mode: cream all over the view, sliding off over a few seconds. */
  cream() {
    const c = this.creamEl, ctx = c.getContext('2d'), W = c.width, H = c.height;
    ctx.clearRect(0, 0, W, H);
    const R = (a, b) => a + Math.random() * (b - a);
    // whipped cream: lumpy splats of overlapping dollops, each with drips running down
    for (let k = 0; k < 4; k++) {
      const cx = R(0.12, 0.88) * W, cy = R(0.1, 0.7) * H, size = R(0.1, 0.19) * W;
      ctx.fillStyle = '#fbf6e8';
      ctx.shadowColor = 'rgba(120,100,70,0.45)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 4;
      for (let i = 0; i < 4; i++) {
        const x = cx + R(-0.25, 0.25) * size, drop = R(0.3, 1.1) * size, w = R(0.05, 0.1) * size;
        ctx.beginPath(); ctx.roundRect(x - w, cy, w * 2, drop, w); ctx.fill();
      }
      for (let i = 0; i < 14; i++) {
        const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * size * 0.55, r = R(0.18, 0.38) * size;
        ctx.beginPath(); ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.8, r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.shadowColor = 'transparent';
      // a glossy highlight on the top left of the dollops
      for (let i = 0; i < 5; i++) {
        const x = cx + R(-0.4, 0.2) * size, y = cy + R(-0.4, 0.1) * size, r = R(0.08, 0.16) * size;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
    }
    // a few specks of pastry
    ctx.fillStyle = '#c98a45';
    for (let i = 0; i < 16; i++) { ctx.beginPath(); ctx.arc(R(0, W), R(0, H), R(1, 3), 0, Math.PI * 2); ctx.fill(); }
    this.creamT = 3.2;
    this.creamEl.style.transform = 'translateY(0)';
  }

  hurt(amount) { this.hurtT = Math.min(1.5, this.hurtT + amount / 30); }
  suppress(k) { this.suppressT = Math.min(1, this.suppressT + k * 0.6); }

  radio(name, text) {
    const el = document.createElement('div');
    el.className = 'radio-line';
    el.innerHTML = `<i>${name}:</i>`;
    el.appendChild(document.createTextNode(text));
    const ms = Math.max(3300, text.length * 65);
    el.style.animationDuration = `${ms / 1000 - 0.1}s`;
    this.el.radio.appendChild(el);
    setTimeout(() => el.remove(), ms);
    while (this.el.radio.children.length > 4) this.el.radio.firstChild.remove();
  }

  /** Something a hostile said within earshot. */
  overheard(text, shout = false) {
    const el = document.createElement('div');
    el.className = 'radio-line overheard' + (shout ? ' shout' : '');
    el.innerHTML = `<i>${shout ? 'HOSTILE' : 'OVERHEARD'}</i>`;
    el.appendChild(document.createTextNode(shout ? text : `“${text}”`));
    const ms = Math.max(3300, text.length * 70);
    el.style.animationDuration = `${ms / 1000 - 0.1}s`;
    this.el.radio.appendChild(el);
    setTimeout(() => el.remove(), ms);
    while (this.el.radio.children.length > 4) this.el.radio.firstChild.remove();
  }

  killfeed(html) {
    const el = document.createElement('div');
    el.className = 'kf';
    el.innerHTML = html;
    this.el.killfeed.prepend(el);
    setTimeout(() => el.remove(), 4100);
    while (this.el.killfeed.children.length > 5) this.el.killfeed.lastChild.remove();
  }

  banner(title, sub = '', dur = 2.6) {
    this.el.bannerT.textContent = title;
    this.el.bannerS.textContent = sub;
    this.el.banner.classList.remove('hidden');
    this.bannerT = dur;
  }

  pickup(text) { this.el.pickup.textContent = text; this.el.pickup.style.opacity = 1; this.pickupT = 1.8; }

  setWave(n, hostiles) {
    const w = `WAVE ${n}`;
    if (this.last.wave !== w) { this.el.wave.textContent = w; this.last.wave = w; }
    const h = `HOSTILES ${hostiles}`;
    if (this.last.hostiles !== h) { this.el.hostiles.textContent = h; this.last.hostiles = h; }
  }
  /** Mission objective line (replaces the wave counter); null returns to the wave display. */
  setObjective(title, line = '', warn = '') {
    if (title === null) { this.last.wave = this.last.hostiles = null; if (this.last.warn) { this.el.objWarn.textContent = ''; this.last.warn = ''; } return; }
    if (this.last.wave !== title) { this.el.wave.textContent = title; this.last.wave = title; }
    if (this.last.hostiles !== line) { this.el.hostiles.textContent = line; this.last.hostiles = line; }
    if (this.last.warn !== warn) { this.el.objWarn.textContent = warn; this.last.warn = warn; }
  }
  /** Laser rangefinder reading, shown under the crosshair and in the scope. */
  rangeReadout(text) {
    this.rangeText = text; this.rangeT = 6;
    this.el.range.textContent = `RNG ${text}`;
    this.el.range.style.opacity = 1;
  }

  setScore(s) { if (this.last.score !== s) { this.el.score.textContent = s; this.last.score = s; } }

  /** Flashbang whiteout; call captureAfterimage right after the next render. */
  flash(strength, dur) {
    this.flashK = Math.max(this.flashK, strength);
    this.flashDur = dur; this.flashT = dur;
    this.captureNext = true;
  }
  captureAfterimage(canvas) {
    if (!this.captureNext) return;
    this.captureNext = false;
    try {
      this.actx.globalAlpha = 1;
      this.actx.drawImage(canvas, 0, 0, this.after.width, this.after.height);
    } catch { /* ignore */ }
  }

  // ---------------- per frame ----------------
  update(dt) {
    const g = this.game, w = g.weapons, p = g.player, c = w.cur, d = c.def, e = this.el;
    this.frame++;
    // ammo
    const mag = String(c.ammo);
    let res;
    if (c.mags) {
      // one pip per magazine in the pouches: full, partial
      const full = c.mags.filter((n) => n >= d.mag).length, part = c.mags.length - full;
      res = c.mags.length ? `${'▮'.repeat(full)}${'▯'.repeat(part)}` : 'NO MAGS';
    } else res = `/ ${c.reserve}`;
    if (this.last.mag !== mag) { e.ammoMag.textContent = mag; this.last.mag = mag; }
    if (this.last.res !== res) { e.ammoRes.textContent = res; this.last.res = res; }
    const wn = d.auto ? `${d.name} · ${w.fireMode === 'semi' ? 'SEMI' : 'AUTO'}` : d.name;
    if (this.last.wn !== wn) { e.weapon.textContent = wn; this.last.wn = wn; }
    const low = c.ammo <= Math.ceil(d.mag * 0.25);
    if (this.last.low !== low) { e.ammo.classList.toggle('low', low); this.last.low = low; }
    const hint = c.jammed ? 'MALFUNCTION · TAP RELOAD' : c.ammo === 0 && c.reserve > 0 ? 'RELOAD' : '';
    if (this.last.nr !== hint) { e.reload.textContent = hint; e.reload.classList.toggle('hidden', !hint); this.last.nr = hint; }
    if (this.last.frag !== w.frags) { e.frag.textContent = w.frags; e.btnFrag.classList.toggle('empty', w.frags <= 0); this.last.frag = w.frags; }
    if (this.last.flashN !== w.flashes) { e.flash.textContent = w.flashes; e.btnFlash.classList.toggle('empty', w.flashes <= 0); this.last.flashN = w.flashes; }
    // health
    const hp = Math.ceil(p.health);
    if (this.last.hp !== hp) {
      e.healthFill.style.width = `${hp}%`;
      e.healthNum.textContent = hp;
      e.healthFill.classList.toggle('low', hp < 35);
      this.last.hp = hp;
    }
    // crosshair
    const vfov = g.camera.fov * Math.PI / 180;
    const moving = Math.min(1, p.horizSpeed / 4);
    let spreadDeg = d.hipSpread + d.moveSpread * moving + (p.grounded ? 0 : 3);
    if (p.crouched) spreadDeg *= 0.75;
    this.spreadKick = Math.max(0, (this.spreadKick || 0) - dt * 5);
    spreadDeg += this.spreadKick * d.recoilPitch * 2;
    const target = Math.tan(spreadDeg * Math.PI / 180) / Math.tan(vfov / 2) * (window.innerHeight / 2);
    this.spread += (target - this.spread) * Math.min(1, dt * 14);
    const s = Math.max(4, this.spread);
    const hide = w.adsT > 0.4 || p.sprinting || !p.alive || w.throwing;
    const op = hide ? '0' : '1';
    if (this.last.cop !== op) { e.cross.style.opacity = op; this.last.cop = op; }
    if (!hide && Math.abs((this.last.cs || 0) - s) > 0.3) {
      this.last.cs = s;
      this.cross[0].style.transform = `translateY(${-s - 9}px)`;
      this.cross[1].style.transform = `translateY(${s}px)`;
      this.cross[2].style.transform = `translateX(${-s - 9}px)`;
      this.cross[3].style.transform = `translateX(${s}px)`;
    }
    const onEnemy = g.aimTarget && g.aimTarget.onCross;
    if (this.last.onEnemy !== !!onEnemy) { e.cross.classList.toggle('enemy', !!onEnemy); this.last.onEnemy = !!onEnemy; }
    // hit marker
    if (this.hitT > 0) { this.hitT -= dt; e.hit.style.opacity = Math.max(0, Math.min(1, this.hitT * 6)); }
    // scope
    const scoped = w.isScoped;
    if (this.last.scoped !== scoped) { e.scope.classList.toggle('hidden', !scoped); this.last.scoped = scoped; }
    const kind = scoped ? `${w.def.scope}|${g.night}|${w.scopeZoom}|${Math.round(g.camera.fov * 100)}` : this.last.scopeKind;
    if (scoped && this.last.scopeKind !== kind) { this.last.scopeKind = kind; this._drawScope(); }
    if (this.mark) this._placeMark(scoped);
    // sniper data: magnification, zero, last range, wind (the Kestrel on the stock)
    if (this.rangeT > 0) { this.rangeT -= dt; if (this.rangeT <= 0) this.el.range.style.opacity = 0; }
    const hasZoom = !!d.zooms;
    if (this.last.hasZoom !== hasZoom) { document.body.classList.toggle('has-zoom', hasZoom); this.last.hasZoom = hasZoom; }
    if (hasZoom) {
      const zl = `${w.scopeZoom}x`;
      if (this.last.zl !== zl) { e.btnZoom.textContent = zl; this.last.zl = zl; }
      const zr = String(w.zero);
      if (this.last.zr !== zr) { e.zeroLabel.innerHTML = `ZERO<br><b>${zr}</b>`; this.last.zr = zr; }
    }
    if (scoped && this.frame % 6 === 0) {
      let txt = `${w.scopeZoom}x`;
      if (d.zeroable) txt += ` · ZERO ${w.zero} m`;
      if (this.rangeT > 0) txt += ` · RNG ${this.rangeText}`;
      const wd = g.ballistics.wind, ws = Math.hypot(wd.x, wd.z);
      if (ws > 0.2) {
        // clock direction the wind comes from, relative to where the scope points
        const fwdA = Math.atan2(-Math.sin(p.yaw), -Math.cos(p.yaw)), fromA = Math.atan2(-wd.x, -wd.z);
        let rel = fromA - fwdA; while (rel < 0) rel += Math.PI * 2;
        const clock = ((Math.round((Math.PI * 2 - rel) / (Math.PI / 6)) + 11) % 12) + 1;
        txt += ` · WIND ${ws.toFixed(1)} m/s from ${clock}:00`;
      }
      if (this.last.sd !== txt) { e.scopeData.textContent = txt; this.last.sd = txt; }
    } else if (!scoped && this.last.sd) { e.scopeData.textContent = ''; this.last.sd = ''; }
    // damage direction indicators
    const yaw = p.yaw;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    for (let i = this.indicators.length - 1; i >= 0; i--) {
      const ind = this.indicators[i];
      ind.t -= dt;
      if (ind.t <= 0) { ind.el.remove(); this.indicators.splice(i, 1); continue; }
      const dx = ind.x - p.pos.x, dz = ind.z - p.pos.z;
      const ang = Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz);
      ind.el.style.transform = `rotate(${ang}rad)`;
      ind.el.style.opacity = Math.min(1, ind.t);
    }
    // grenade warnings
    this._grenadeIndicators(fx, fz, rx, rz);
    // damage / low health overlay
    this.hurtT = Math.max(0, this.hurtT - dt * 0.9);
    this.suppressT = Math.max(0, this.suppressT - dt * 1.2);
    const lowK = Math.max(0, 1 - p.health / 60);
    const dmgK = Math.min(1, this.hurtT + lowK * 0.8);
    const q = Math.round(dmgK * 40);
    if (q !== this.last.dmgDraw) { this._drawDamage(dmgK); this.last.dmgDraw = q; }
    const vig = (0.7 + this.suppressT * 0.3).toFixed(2);
    if (this.last.vig !== vig) { e.vignette.style.opacity = vig; this.last.vig = vig; }
    // pie in the face: clears from the middle out as it slides down
    if (this.creamT > 0) {
      this.creamT = Math.max(0, this.creamT - dt);
      this.creamEl.style.opacity = Math.min(1, this.creamT / 1.4).toFixed(3);
      this.creamEl.style.transform = `translateY(${((3.2 - this.creamT) * 6).toFixed(1)}vh)`;
    }
    // flashbang
    if (this.flashT > 0) {
      this.flashT -= dt;
      const t = Math.max(0, this.flashT / this.flashDur);
      const whiteA = this.flashK * Math.min(1, t * 1.6);
      this.white.style.opacity = whiteA.toFixed(3);
      this.after.style.opacity = (this.flashK * Math.min(1, t * 2.2) * 0.9).toFixed(3);
      g.flashAmount = whiteA;
      if (this.flashT <= 0) { this.flashK = 0; this.white.style.opacity = '0'; this.after.style.opacity = '0'; g.flashAmount = 0; }
    }
    // banner / pickup
    if (this.bannerT > 0) { this.bannerT -= dt; if (this.bannerT <= 0) e.banner.classList.add('hidden'); }
    if (this.pickupT > 0) { this.pickupT -= dt; if (this.pickupT <= 0) e.pickup.style.opacity = 0; }
    this._updateOSD(dt);
    const dc = String(g.drone.count);
    if (this.last.dc !== dc) { e.droneCount.textContent = dc; e.btnDrone.classList.toggle('empty', g.drone.count <= 0 && !g.drone.active); this.last.dc = dc; }
    const vm = g.viewMode + (g.thermalPalette ?? '');
    if (this.last.vm !== vm) {
      e.btnNvg.classList.toggle('on', g.viewMode === 'nvg');
      e.btnThermal.classList.toggle('on', g.viewMode === 'thermal');
      e.modeLabel.textContent = g.viewMode === 'nvg' ? 'NVG · PVS-31' : g.viewMode === 'thermal' ? `THERMAL · ${['WHITE HOT', 'BLACK HOT', 'IRONBOW'][g.thermalPalette]}` : '';
      this.last.vm = vm;
    }
    // minimap at ~20 Hz
    if (this.frame % 3 === 0) this._drawMinimap();
    // fps
    this.fpsAcc += dt; this.fpsN++;
    if (this.fpsAcc > 0.5) {
      const fps = Math.round(this.fpsN / this.fpsAcc);
      this.fpsAcc = 0; this.fpsN = 0;
      e.fps.textContent = settings.showFps ? `${fps} fps · ${g.renderScale.toFixed(2)}x` : '';
    }
  }

  _grenadeIndicators(fx, fz, rx, rz) {
    const g = this.game, p = g.player;
    const list = g.grenades.list.filter((gr) => (gr.type === 'frag' || (gr.type === 'pie' && gr.owner !== 'player')) && gr.pos.distanceTo(p.pos) < 11);
    const els = this.el.gren.children;
    while (els.length < list.length) {
      const el = document.createElement('div'); el.className = 'gren-ind'; el.innerHTML = '<span>!</span>';
      this.el.gren.appendChild(el);
    }
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      if (i >= list.length) { el.style.display = 'none'; continue; }
      const gr = list[i];
      const dx = gr.pos.x - p.pos.x, dz = gr.pos.z - p.pos.z;
      const ang = Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz);
      el.style.display = 'flex';
      el.style.transform = `rotate(${ang}rad)`;
      el.firstChild.style.transform = `rotate(${-ang}rad)`;
      el.firstChild.textContent = `${Math.round(Math.hypot(dx, dz))}m`;
    }
  }

  _drawDamage(k) {
    const c = this.damageCanvas, ctx = this.dctx;
    ctx.clearRect(0, 0, c.width, c.height);
    if (k <= 0.01) return;
    const w = c.width, h = c.height;
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * (0.55 - k * 0.25), w / 2, h / 2, Math.max(w, h) * 0.72);
    g.addColorStop(0, 'rgba(120,0,0,0)');
    g.addColorStop(0.6, `rgba(110,0,0,${0.35 * k})`);
    g.addColorStop(1, `rgba(70,0,0,${0.85 * k})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  _drawMinimap() {
    const g = this.game, p = g.player, ctx = this.mctx, M = this.mapImage;
    if (!M) return;
    const W = this.minimap.width, R = W / 2;
    const scale = 3.6; // px per metre on the minimap canvas
    ctx.clearRect(0, 0, W, W);
    ctx.save();
    ctx.beginPath(); ctx.arc(R, R, R, 0, Math.PI * 2); ctx.clip();
    ctx.translate(R, R);
    ctx.rotate(p.yaw);
    const k = scale / M.S;
    ctx.drawImage(M.c, (-p.pos.x - M.R) * scale, (-p.pos.z - M.R) * scale, M.c.width * k, M.c.height * k);
    // enemies that fired recently (unsuppressed weapons show on radar) or are in plain sight
    for (const e of g.enemies.list) {
      if (!e.alive) continue;
      const fired = g.time - e.lastFired < 2.2;
      const spotted = e.spottedByPlayer && g.time - e.spottedByPlayer < 0.6;
      if (!fired && !spotted) continue;
      const a = fired ? Math.max(0.3, 1 - (g.time - e.lastFired) / 2.2) : 0.7;
      ctx.fillStyle = `rgba(255,70,55,${a})`;
      ctx.beginPath();
      ctx.arc((e.pos.x - p.pos.x) * scale, (e.pos.z - p.pos.z) * scale, 7, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const gr of g.grenades.list) {
      ctx.fillStyle = gr.type === 'frag' ? '#ffcc33' : gr.type === 'pie' ? '#ff8fd0' : '#bde4ff';
      ctx.beginPath();
      ctx.arc((gr.pos.x - p.pos.x) * scale, (gr.pos.z - p.pos.z) * scale, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const pk of g.pickups) {
      ctx.fillStyle = pk.kind === 'health' ? '#ff8a8a' : '#9fd98a';
      ctx.fillRect((pk.x - p.pos.x) * scale - 4, (pk.z - p.pos.z) * scale - 4, 8, 8);
    }
    ctx.restore();
    // view cone + player arrow
    ctx.save();
    ctx.translate(R, R);
    const cone = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 0.9);
    cone.addColorStop(0, 'rgba(255,255,255,0.22)'); cone.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = cone;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, R * 0.9, -Math.PI / 2 - 0.6, -Math.PI / 2 + 0.6); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.moveTo(0, -11); ctx.lineTo(8, 9); ctx.lineTo(0, 4); ctx.lineTo(-8, 9); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  /** The spotter's splash mark on the reticle: {x, y} mils right/up of the crosshair when the shot broke. 'stale' dims it as the next round goes. */
  scopeMark(m) {
    const el = this.el.scopeMark;
    if (m === 'stale') { if (this.mark) el.classList.add('stale'); return; }
    this.mark = m ? { ...m, t: this.game.time } : null;
    el.className = m ? m.kind : 'hidden';
    if (!m) return;
    el.firstChild.textContent = m.label;
    this.last.markPos = '';
  }
  _placeMark(scoped) {
    const G = this.scopeGeom, m = this.mark;
    if (this.game.time - m.t > 25) { this.scopeMark(null); return; }
    if (!scoped || !G) return;
    let dx = m.x * G.mil, dy = -m.y * G.mil;
    const d = Math.hypot(dx, dy), lim = G.r * 0.92;
    if (d > lim) { dx *= lim / d; dy *= lim / d; }
    const pos = `translate(${(G.cx + dx).toFixed(1)}px,${(G.cy + dy).toFixed(1)}px)`;
    if (pos !== this.last.markPos) { this.el.scopeMark.style.transform = pos; this.last.markPos = pos; }
  }

  _drawScope() {
    const c = this.scopeCanvas, ctx = c.getContext('2d');
    const w = c.width, h = c.height, r = Math.min(w, h) * 0.47, cx = w / 2, cy = h / 2;
    ctx.clearRect(0, 0, w, h);
    if (this.game.weapons?.def.scope === 'digital') { this._drawDigitalScope(ctx, w, h, cx, cy, r); return; }
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.arc(cx, cy, r, 0, Math.PI * 2, true); ctx.fill();
    // lens edge shading
    const g = ctx.createRadialGradient(cx, cy, r * 0.8, cx, cy, r);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.85)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    // mil-dot reticle in the first focal plane: dots are exactly 1 mil apart at every magnification
    ctx.strokeStyle = '#050505'; ctx.fillStyle = '#050505';
    const fov = this.game.camera.fov * Math.PI / 180;
    const mil = Math.max(r * 0.02, (h / 2) / Math.tan(fov / 2) / 1000);
    const posts = Math.min(r * 0.95, mil * 10.5);
    const k = this.scopeDpr || 1;
    this.scopeGeom = { mil: mil / k, r: r / k, cx: cx / k, cy: cy / k };
    const thick = Math.max(2, r * 0.012), thin = Math.max(1, r * 0.0028);
    ctx.lineWidth = thick;
    ctx.beginPath();
    ctx.moveTo(cx - r, cy); ctx.lineTo(cx - posts, cy);
    ctx.moveTo(cx + posts, cy); ctx.lineTo(cx + r, cy);
    ctx.moveTo(cx, cy + posts); ctx.lineTo(cx, cy + r);
    ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy - posts);
    ctx.stroke();
    ctx.lineWidth = thin;
    ctx.beginPath();
    ctx.moveTo(cx - posts, cy); ctx.lineTo(cx + posts, cy);
    ctx.moveTo(cx, cy - posts); ctx.lineTo(cx, cy + posts);
    ctx.stroke();
    const dotR = Math.max(1.5, Math.min(mil * 0.12, r * 0.009));
    for (let i = 1; i <= 10; i++) {
      if (i * mil > posts) break;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        ctx.beginPath(); ctx.arc(cx + dx * i * mil, cy + dy * i * mil, dotR, 0, Math.PI * 2); ctx.fill();
        // half-mil hash marks
        if (mil > 14) { const hx = cx + dx * (i - 0.5) * mil, hy = cy + dy * (i - 0.5) * mil; ctx.fillRect(hx - (dy ? mil * 0.12 : thin / 2), hy - (dx ? mil * 0.12 : thin / 2), dy ? mil * 0.24 : thin, dx ? mil * 0.24 : thin); }
      }
    }
    ctx.fillStyle = 'rgba(255,40,30,0.9)';
    ctx.beginPath(); ctx.arc(cx, cy, Math.max(1.5, r * 0.006), 0, Math.PI * 2); ctx.fill();
  }

  /** Eyepiece of the digital scope: display bezel, electronic reticle and on-screen data. */
  _drawDigitalScope(ctx, w, h, cx, cy, r) {
    const night = this.game.night;
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.arc(cx, cy, r, 0, Math.PI * 2, true); ctx.fill();
    const g = ctx.createRadialGradient(cx, cy, r * 0.86, cx, cy, r);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.9)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    const ink = night ? 'rgba(220,255,225,0.92)' : 'rgba(255,70,40,0.95)';
    ctx.strokeStyle = ink; ctx.fillStyle = ink;
    const lw = Math.max(1.5, r * 0.006);
    ctx.lineWidth = lw;
    // crosshair with centre gap, stadia ticks and a chevron
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.7, cy); ctx.lineTo(cx - r * 0.05, cy);
    ctx.moveTo(cx + r * 0.05, cy); ctx.lineTo(cx + r * 0.7, cy);
    ctx.moveTo(cx, cy + r * 0.05); ctx.lineTo(cx, cy + r * 0.7);
    ctx.stroke();
    for (let i = 1; i <= 5; i++) {
      const d = i * r * 0.1, t = i % 5 === 0 ? r * 0.05 : r * 0.025;
      ctx.beginPath();
      ctx.moveTo(cx - d, cy - t / 2); ctx.lineTo(cx - d, cy + t / 2);
      ctx.moveTo(cx + d, cy - t / 2); ctx.lineTo(cx + d, cy + t / 2);
      ctx.moveTo(cx - t / 2, cy + d); ctx.lineTo(cx + t / 2, cy + d);
      ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(cx - r * 0.03, cy + r * 0.035); ctx.lineTo(cx, cy); ctx.lineTo(cx + r * 0.03, cy + r * 0.035); ctx.stroke();
    // on-screen display
    ctx.font = `600 ${Math.round(r * 0.055)}px ui-monospace, monospace`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText('3.5x', cx - r * 0.55, cy - r * 0.62);
    ctx.textAlign = 'right';
    ctx.fillText(night ? 'NIGHT  IR3' : 'DAY', cx + r * 0.55, cy - r * 0.62);
    ctx.textAlign = 'center';
    ctx.fillText('100 m', cx, cy + r * 0.8);
    // battery
    const bx = cx + r * 0.4, by = cy + r * 0.62, bw = r * 0.12, bh = r * 0.05;
    ctx.strokeRect(bx, by, bw, bh); ctx.fillRect(bx + bw, by + bh * 0.3, bw * 0.08, bh * 0.4);
    ctx.fillRect(bx + 2, by + 2, (bw - 4) * 0.75, bh - 4);
  }
}
