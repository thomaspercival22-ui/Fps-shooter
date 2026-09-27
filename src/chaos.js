// Chaos mode: cartoon characters instead of soldiers, a rainbow sky, guns
// that shoot confetti (harmless) and cream pies, the only thing that takes
// anyone out. The pieces the other modules share live here.
import * as THREE from 'three';
import { propModel } from './props.js';

export const CHAOS = {
  pies: 5, maxPies: 8, wavePies: 3, // the player's pies: at the start, at most, and back per wave cleared
  pieDamage: 45,                    // one enemy pie in the face (times the difficulty's damage)
  pieSplash: 0.8,                   // a player's pie landing this close to a toon still gets him
  enemyPieCooldown: [3.5, 7],       // seconds between one toon's throws (divided by the difficulty's grenade rate)
  squadPieGap: 1.6,                 // and between any two toons' throws
};

// original characters (credits in assets/people/CREDITS.md), with the names the kill feed gives them
export const TOON_NAMES = {
  toonAlien: 'Zorp the Alien', toonRabbit: 'Bunz', toon0: 'Grandpa Gus', toon1: 'Doc Fizz', toon2: 'Agent Whiskers', toon3: 'Captain Whisk',
};

export const CONFETTI_COLORS = [
  [1.0, 0.18, 0.32], [1.0, 0.55, 0.1], [1.0, 0.9, 0.12], [0.2, 0.85, 0.3], [0.15, 0.6, 1.0], [0.55, 0.3, 1.0], [1.0, 0.4, 0.8], [1.0, 1.0, 1.0],
];

// what the toons shout (the radio lines of the other modes, by the same keys)
export const CHAOS_LINES = {
  contact: ['Found him! Get the pies!', 'There he is! Pie time!', 'Tag, you\'re it!'],
  frag: ['Pie incoming!', 'Eat this! Lemon meringue!', 'Special delivery!', 'Cream pie, coming through!'],
  flash: ['Glitter bomb!', 'Sparkles!'],
  hit: ['Hey! That tickles!', 'Ow, confetti in my eye!', 'Ha! Missed me... sort of!'],
  manDown: ['He got creamed!', 'Nooo, not the meringue!', 'Man down! Dessert down!'],
  reloading: ['Reloading confetti!', 'Out of sprinkles!'],
  flank: ['I\'ll sneak round with a pie!', 'Going round the back!'],
  retreat: ['Too much cream! Falling back!'],
  grenadeWarn: ['Pie! Duck!'],
  push: ['Charge! Pies at the ready!', 'Get him! Get him!'],
  lost: ['Where\'d he go? Come out and play!', 'Yoo-hoo!'],
  suppress: ['Confetti cover!', 'Party time!'],
  drone: ['Flying pie!', 'Is that a pie with propellers?'],
};

let skyTex = null;
/**
 * The rainbow sky (equirectangular): pale pink haze on the horizon, then red, orange, yellow,
 * green, blue and violet towards the zenith, with a few fat white clouds low down.
 */
export function rainbowSky() {
  if (skyTex) return skyTex;
  const W = 1024, H = 512;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  for (let y = 0; y < H; y++) {
    const elev = (0.5 - (y + 0.5) / H) * 180; // degrees above the horizon
    let col;
    if (elev < 0) col = 'hsl(330, 70%, 88%)';
    else {
      // red just clears the ridges round the compound, violet overhead
      const k = Math.min(1, Math.pow(Math.max(0, elev - 2.5) / 52, 1.1));
      const hue = k * 285, haze = Math.max(0, 1 - elev / 3);
      col = `hsl(${hue.toFixed(1)}, ${(88 - haze * 30).toFixed(1)}%, ${(62 + haze * 24).toFixed(1)}%)`;
    }
    ctx.fillStyle = col; ctx.fillRect(0, y, W, 1);
  }
  // clouds: clusters of soft white puffs between 4 and 20 degrees up
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 16; i++) {
    const cx = rnd() * W, cy = H / 2 - (4 + rnd() * 16) / 180 * H, w = 30 + rnd() * 50;
    for (let j = 0; j < 9; j++) {
      const x = cx + (rnd() - 0.5) * w * 1.6, y = cy + (rnd() - 0.7) * w * 0.22, r = w * (0.18 + rnd() * 0.22);
      for (const dx of [0, -W, W]) {
        const g = ctx.createRadialGradient(x + dx, y, 0, x + dx, y, r);
        g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.6, 'rgba(255,250,252,0.7)'); g.addColorStop(1, 'rgba(255,245,250,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x + dx, y, r, r * 0.55, 0, 0, Math.PI * 2); ctx.fill();
      }
    }
  }
  skyTex = new THREE.CanvasTexture(c);
  skyTex.colorSpace = THREE.SRGBColorSpace;
  skyTex.mapping = THREE.EquirectangularReflectionMapping;
  return skyTex;
}
/** The haze colour on the horizon (linear), for the fog. */
export const RAINBOW_HAZE = new THREE.Color().setHSL(330 / 360, 0.6, 0.86, THREE.SRGBColorSpace);

/** A paper strip: white, the particle colour tints it. */
export function confettiTexture() {
  const S = 32, c = document.createElement('canvas'); c.width = c.height = S;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(S * 0.18, S * 0.36, S * 0.64, S * 0.28);
  ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(S * 0.18, S * 0.52, S * 0.64, S * 0.12); // a fold catching less light
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A splat of whipped cream: a lumpy blob with drops thrown around it. */
export function creamTexture() {
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S;
  const ctx = c.getContext('2d'), m = S / 2;
  const blob = (x, y, r, lumps) => {
    ctx.beginPath();
    for (let i = 0; i <= 28; i++) { const a = i / 28 * Math.PI * 2, rr = r * (1 + lumps * Math.sin(a * 5 + x) * Math.cos(a * 3 + y)); ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
    ctx.fill();
  };
  ctx.fillStyle = 'rgba(250,244,228,0.96)';
  blob(m, m, S * 0.3, 0.16);
  for (let i = 0; i < 12; i++) { const a = Math.random() * Math.PI * 2, d = S * (0.28 + Math.random() * 0.17); blob(m + Math.cos(a) * d, m + Math.sin(a) * d, S * (0.02 + Math.random() * 0.04), 0.1); }
  // yellow lemon curd showing through, and a glossy highlight
  ctx.fillStyle = 'rgba(245,215,90,0.55)'; blob(m + 4, m + 3, S * 0.11, 0.25);
  const g = ctx.createRadialGradient(m - 10, m - 12, 0, m - 10, m - 12, 22);
  g.addColorStop(0, 'rgba(255,255,255,0.8)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A pie to throw or hold: the lemon meringue tart (props), centred on its middle; a plain one if it isn't loaded. */
export function pieMesh() {
  const root = new THREE.Group();
  const model = propModel('pie');
  if (model) {
    const m = model.clone();
    m.position.y = -0.085;
    m.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.userData.heat = 0.45; } });
    root.add(m);
  } else {
    const crust = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.11, 0.05, 20), new THREE.MeshStandardMaterial({ color: 0xc8904a, roughness: 0.8 }));
    const cream = new THREE.Mesh(new THREE.SphereGeometry(0.12, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xfaf3e0, roughness: 0.5 }));
    cream.position.y = 0.02; cream.scale.y = 0.6;
    root.add(crust, cream);
    root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  }
  return root;
}
