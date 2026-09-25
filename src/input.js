// Input: touch controls (floating joystick, drag-to-look, buttons, gyro aim)
// and keyboard + mouse (pointer lock) for desktop.
import { settings } from './settings.js';

const DEG = Math.PI / 180;

export class Input {
  constructor(game) {
    this.game = game;
    this.moveX = 0; this.moveY = 0;
    this.sprint = false;
    this.lookDX = 0; this.lookDY = 0;
    this.fire = false;
    this.ads = false;
    this.jump = false;
    this.upHeld = false; this.downHeld = false; // held buttons (drone altitude)
    this.events = new Set(); // one-shot actions: reload, swap, crouch, frag, flash, pause
    this.hasTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    this.touchMode = this.hasTouch || settings.onscreen === 'always';
    this.keys = new Set();
    this.mouseDown = false; this.rmb = false;
    this.pointers = new Map();
    this.stick = { id: null, cx: 0, cy: 0, x: 0, y: 0 };
    this.gyroOn = false;
    this.enabled = false;
    document.body.classList.toggle('desktop', !this.touchMode);
    this._bindTouch();
    this._bindDesktop();
  }

  consume(name) { if (this.events.has(name)) { this.events.delete(name); return true; } return false; }

  takeLook() { const d = [this.lookDX, this.lookDY]; this.lookDX = 0; this.lookDY = 0; return d; }

  reset() {
    this.moveX = this.moveY = 0; this.fire = false; this.sprint = false;
    this.lookDX = this.lookDY = 0; this.events.clear(); this.jump = false; this.upHeld = this.downHeld = false;
    this.pointers.clear(); this.stick.id = null; this.mouseDown = false;
    document.getElementById('stick').classList.remove('active', 'sprint');
    document.querySelectorAll('.tbtn.pressed').forEach((b) => b.classList.remove('pressed'));
    this._knob(0, 0);
  }

  // ---------------- touch ----------------
  _bindTouch() {
    const canvas = document.getElementById('game');
    const stickEl = document.getElementById('stick');
    const lookScale = () => 0.2 * DEG * settings.lookSens;

    const onDown = (e) => {
      if (!this.enabled || (e.pointerType === 'mouse' && !this.touchMode)) return;
      e.preventDefault();
      const w = window.innerWidth, h = window.innerHeight;
      if (e.clientX < w * 0.42 && e.clientY > h * 0.28 && this.stick.id === null) {
        this.stick.id = e.pointerId;
        this.stick.cx = e.clientX; this.stick.cy = e.clientY;
        stickEl.style.left = e.clientX + 'px'; stickEl.style.top = e.clientY + 'px';
        stickEl.classList.add('active');
      } else {
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, role: 'look' });
      }
    };
    const onMove = (e) => {
      if (!this.enabled || (e.pointerType === 'mouse' && !this.touchMode)) return;
      if (e.pointerId === this.stick.id) {
        const R = 58;
        let dx = e.clientX - this.stick.cx, dy = e.clientY - this.stick.cy;
        const d = Math.hypot(dx, dy);
        // drag the base along if the thumb goes far past the rim
        if (d > R * 1.6) { this.stick.cx += dx * (1 - R * 1.6 / d); this.stick.cy += dy * (1 - R * 1.6 / d); stickEl.style.left = this.stick.cx + 'px'; stickEl.style.top = this.stick.cy + 'px'; dx = e.clientX - this.stick.cx; dy = e.clientY - this.stick.cy; }
        const m = Math.min(1, Math.hypot(dx, dy) / R);
        const a = Math.atan2(dy, dx);
        this.moveX = Math.cos(a) * m; this.moveY = -Math.sin(a) * m;
        const dead = 0.12;
        if (m < dead) { this.moveX = this.moveY = 0; }
        this.sprint = Math.hypot(dx, dy) > R * 1.15 && this.moveY > 0.7;
        stickEl.classList.toggle('sprint', this.sprint);
        this._knob(Math.cos(a) * Math.min(d, R), Math.sin(a) * Math.min(d, R));
        return;
      }
      const p = this.pointers.get(e.pointerId);
      if (p) {
        const k = lookScale();
        this.lookDX += (e.clientX - p.x) * k;
        this.lookDY += (e.clientY - p.y) * k * (settings.invertY ? -1 : 1);
        p.x = e.clientX; p.y = e.clientY;
      }
    };
    const onUp = (e) => {
      if (e.pointerId === this.stick.id) {
        this.stick.id = null; this.moveX = this.moveY = 0; this.sprint = false;
        stickEl.classList.remove('active', 'sprint');
        this._knob(0, 0);
        return;
      }
      const p = this.pointers.get(e.pointerId);
      if (p) {
        if (p.role === 'fire') { this.fireCount = Math.max(0, (this.fireCount || 1) - 1); if (!this.fireCount) this.fire = false; p.btn?.classList.remove('pressed'); }
        this.pointers.delete(e.pointerId);
      }
    };
    canvas.addEventListener('pointerdown', onDown, { passive: false });
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);

    // fire buttons double as look pads
    for (const id of ['btn-fire', 'btn-fire2']) {
      const el = document.getElementById(id);
      el.addEventListener('pointerdown', (e) => {
        if (!this.enabled) return;
        e.preventDefault(); e.stopPropagation();
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, role: 'fire', btn: el });
        this.fireCount = (this.fireCount || 0) + 1;
        this.fire = true;
        el.classList.add('pressed');
      });
    }
    const tap = (id, fn) => {
      const el = document.getElementById(id);
      el.addEventListener('pointerdown', (e) => {
        if (!this.enabled) return;
        e.preventDefault(); e.stopPropagation();
        el.classList.add('pressed');
        fn(el);
      });
      const up = () => el.classList.remove('pressed');
      el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('pointerleave', up);
    };
    tap('btn-ads', (el) => { this.ads = !this.ads; el.classList.toggle('on', this.ads); });
    tap('btn-reload', () => this.events.add('reload'));
    tap('btn-jump', () => { this.jump = true; this.upHeld = true; });
    tap('btn-crouch', () => { this.events.add('crouch'); this.downHeld = true; });
    for (const [id, key] of [['btn-jump', 'upHeld'], ['btn-crouch', 'downHeld']]) {
      const el = document.getElementById(id);
      const off = () => { this[key] = false; };
      el.addEventListener('pointerup', off); el.addEventListener('pointercancel', off); el.addEventListener('pointerleave', off);
    }
    tap('btn-nvg', () => this.events.add('nvg'));
    tap('btn-thermal', () => this.events.add('thermal'));
    tap('btn-drone', () => this.events.add('drone'));
    tap('btn-swap', () => this.events.add('swap'));
    tap('btn-frag', () => this.events.add('frag'));
    tap('btn-flash', () => this.events.add('flash'));
    tap('btn-pause', () => this.events.add('pause'));
    document.getElementById('weapon-box').addEventListener('pointerdown', (e) => { if (this.enabled && this.touchMode) { e.preventDefault(); this.events.add('swap'); } });
  }

  /** Show / hide the on-screen joystick and buttons. */
  setTouchMode(on) {
    this.touchMode = on;
    document.body.classList.toggle('desktop', !on);
    if (this.game.state === 'playing') this.game.hud.show(true);
  }

  _knob(x, y) { document.getElementById('stick-knob').style.transform = `translate(${x}px, ${y}px)`; }

  setAdsButton(on) {
    this.ads = on;
    document.getElementById('btn-ads').classList.toggle('on', on);
  }

  // ---------------- gyro ----------------
  async enableGyro() {
    if (this.gyroOn) return true;
    try {
      if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
        const r = await DeviceMotionEvent.requestPermission();
        if (r !== 'granted') return false;
      }
    } catch { return false; }
    window.addEventListener('devicemotion', (e) => {
      if (!this.enabled || settings.gyro === 'off' || !e.rotationRate) return;
      if (settings.gyro === 'ads' && !(this.game.weapons && this.game.weapons.adsT > 0.5)) return;
      const rr = e.rotationRate; // deg/s
      const dt = (e.interval || 16) > 1 ? (e.interval || 16) / 1000 : e.interval || 0.016;
      const angle = (screen.orientation && screen.orientation.angle) ?? window.orientation ?? 90;
      // In landscape the screen's vertical axis is the device x axis (beta)
      // and the screen's horizontal axis is the device y axis (gamma).
      let dx, dy;
      if (angle === 90) { dx = -rr.beta; dy = rr.gamma; }
      else if (angle === -90 || angle === 270) { dx = rr.beta; dy = -rr.gamma; }
      else { dx = -rr.gamma; dy = -rr.beta; }
      const k = DEG * dt * settings.gyroSens;
      this.lookDX += dx * k;
      this.lookDY += dy * k * (settings.invertY ? -1 : 1);
    });
    this.gyroOn = true;
    return true;
  }

  // ---------------- desktop ----------------
  _bindDesktop() {
    const canvas = document.getElementById('game');
    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if (e.repeat) return;
      this.keys.add(e.code);
      switch (e.code) {
        case 'KeyR': this.events.add('reload'); break;
        case 'KeyQ': this.events.add('swap'); break;
        case 'Digit1': this.events.add('slot1'); break;
        case 'Digit2': this.events.add('slot2'); break;
        case 'KeyC': case 'ControlLeft': this.events.add('crouch'); this.downHeld = true; break;
        case 'KeyG': this.events.add('frag'); break;
        case 'KeyF': this.events.add('flash'); break;
        case 'KeyN': this.events.add('nvg'); break;
        case 'KeyT': this.events.add('thermal'); break;
        case 'KeyV': this.events.add('drone'); break;
        case 'Space': this.jump = true; this.upHeld = true; e.preventDefault(); break;
        case 'Escape': case 'KeyP': this.events.add('pause'); break;
      }
      this._keysToMove();
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code); this._keysToMove();
      if (e.code === 'Space') this.upHeld = false;
      if (e.code === 'KeyC' || e.code === 'ControlLeft') this.downHeld = false;
    });
    window.addEventListener('blur', () => { this.keys.clear(); this._keysToMove(); this.mouseDown = false; if (!this.touchMode) this.fire = false; });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled || this.touchMode) return;
      if (document.pointerLockElement !== canvas) { canvas.requestPointerLock?.(); return; }
      if (e.button === 0) { this.fire = true; this.mouseDown = true; }
      if (e.button === 2) { this.ads = true; }
    });
    window.addEventListener('mouseup', (e) => {
      if (this.touchMode) return;
      if (e.button === 0) { this.fire = false; this.mouseDown = false; }
      if (e.button === 2) this.ads = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (!this.enabled || document.pointerLockElement !== canvas) return;
      const k = 0.1 * DEG * settings.lookSens;
      this.lookDX += e.movementX * k;
      this.lookDY += e.movementY * k * (settings.invertY ? -1 : 1);
    });
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement !== canvas && this.enabled && !this.touchMode) this.events.add('pause');
    });
  }

  _keysToMove() {
    if (this.touchMode && this.stick.id !== null) return;
    const k = this.keys;
    this.moveX = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    this.moveY = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    if (this.moveX && this.moveY) { this.moveX *= Math.SQRT1_2; this.moveY *= Math.SQRT1_2; }
    this.sprint = k.has('ShiftLeft') || k.has('ShiftRight');
  }
}
