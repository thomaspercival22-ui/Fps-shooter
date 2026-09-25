// Game tuning data. Distances in metres, speeds in m/s, times in seconds,
// angles in degrees unless noted.

export const PLAYER = {
  radius: 0.32,
  standHeight: 1.78,
  crouchHeight: 1.15,
  eyeStand: 1.64,
  eyeCrouch: 1.02,
  walkSpeed: 4.3,
  sprintSpeed: 6.6,
  crouchSpeed: 2.2,
  adsSpeedMul: 0.6,
  jumpVelocity: 4.6,
  stepHeight: 0.42,
  maxHealth: 100,
  regenDelay: 4.5,
  regenRate: 22,
  gravity: 9.81 * 1.35,
};

// Player weapons. Dimensions for the models live in gunmodels.js.
export const WEAPONS = {
  m4: {
    name: 'M4A1', slot: 'primary', desc: '5.56mm carbine · holo sight',
    auto: true, rpm: 800, mag: 30, reserve: 150, chamber: true,
    damage: 34, headMul: 3.4, limbMul: 0.8, falloffStart: 45, falloffEnd: 120, minDamageMul: 0.7,
    velocity: 880, pellets: 1, penetration: 1.0,
    hipSpread: 2.6, adsSpread: 0.12, moveSpread: 2.2,
    recoilPitch: 0.42, recoilYaw: 0.2, recoilRecover: 7, viewKick: 1,
    adsZoom: 1.35, adsTime: 0.2, reloadTime: 2.2, emptyReloadTime: 2.75, drawTime: 0.45,
    sound: 'm4', tracerEvery: 3, shell: 'rifle', jam: 1 / 320, heatPerShot: 0.016,
  },
  m1014: {
    name: 'M1014', slot: 'primary', desc: '12ga semi-auto shotgun',
    auto: false, rpm: 300, mag: 7, reserve: 42, chamber: true,
    damage: 17, headMul: 1.8, limbMul: 0.8, falloffStart: 10, falloffEnd: 35, minDamageMul: 0.3,
    velocity: 400, pellets: 9, pelletSpread: 2.2, penetration: 0.3,
    hipSpread: 1.4, adsSpread: 0.5, moveSpread: 1.0,
    recoilPitch: 3.2, recoilYaw: 0.8, recoilRecover: 9, viewKick: 2.4,
    adsZoom: 1.15, adsTime: 0.22, shellReload: true, reloadStart: 0.45, reloadPerShell: 0.5, reloadEnd: 0.35,
    drawTime: 0.5, sound: 'shotgun', tracerEvery: 0, shell: 'shotgun', jam: 1 / 260, heatPerShot: 0.05,
  },
  sniper: {
    name: 'MK13 .300', slot: 'primary', desc: 'Bolt-action sniper · 8x scope',
    auto: false, rpm: 45, mag: 5, reserve: 30, chamber: false, bolt: true,
    damage: 125, headMul: 3, limbMul: 0.85, falloffStart: 200, falloffEnd: 400, minDamageMul: 0.9,
    velocity: 850, pellets: 1, penetration: 2.5,
    hipSpread: 6, adsSpread: 0.0, moveSpread: 5,
    recoilPitch: 4.5, recoilYaw: 0.6, recoilRecover: 6, viewKick: 3,
    adsZoom: 8, scope: true, adsTime: 0.32, reloadTime: 3.0, emptyReloadTime: 3.4, drawTime: 0.6,
    boltTime: 0.95, sound: 'sniper', tracerEvery: 1, shell: 'rifle', jam: 1 / 700, heatPerShot: 0.08,
  },
  glock: {
    name: 'G17', slot: 'secondary', desc: '9mm pistol',
    auto: false, rpm: 480, mag: 17, reserve: 85, chamber: true,
    damage: 30, headMul: 3.4, limbMul: 0.8, falloffStart: 18, falloffEnd: 60, minDamageMul: 0.6,
    velocity: 375, pellets: 1, penetration: 0.5,
    hipSpread: 2.0, adsSpread: 0.3, moveSpread: 1.4,
    recoilPitch: 1.5, recoilYaw: 0.35, recoilRecover: 10, viewKick: 1.3,
    adsZoom: 1.2, adsTime: 0.14, reloadTime: 1.55, emptyReloadTime: 1.85, drawTime: 0.3,
    sound: 'pistol', tracerEvery: 0, shell: 'pistol', jam: 1 / 450, heatPerShot: 0.012,
  },
};

export const GRENADES = {
  frag: { fuse: 3.2, radius: 9, damage: 170, throwSpeed: 15.5 },
  flash: { fuse: 1.6, radius: 22, throwSpeed: 16.5 },
  startFrag: 2, startFlash: 2, maxFrag: 3, maxFlash: 3,
};

// Enemy archetypes.
export const ENEMY_TYPES = {
  rifleman: {
    name: 'Rifleman', hp: 100, speed: 3.9, walk: 1.6, weapon: 'rifle',
    rpm: 650, mag: 30, reload: 2.6, burst: [3, 7], burstPause: [0.25, 0.7],
    damage: 13, velocity: 800, spread: 1.6, range: 70, preferDist: [12, 32],
    grenadeChance: 0.5, flashChance: 0.35, sound: 'ak', kit: 'olive', tracer: 3,
  },
  assaulter: {
    name: 'Assaulter', hp: 115, speed: 4.6, walk: 1.8, weapon: 'shotgun',
    rpm: 110, mag: 8, reload: 3.0, burst: [1, 2], burstPause: [0.45, 0.8], pellets: 8,
    damage: 7.5, velocity: 380, spread: 3.6, range: 22, preferDist: [3, 10],
    grenadeChance: 0.2, flashChance: 0.6, sound: 'shotgun', kit: 'black', tracer: 0, aggressive: true,
  },
  marksman: {
    name: 'Marksman', hp: 90, speed: 3.6, walk: 1.5, weapon: 'dmr',
    rpm: 110, mag: 10, reload: 2.8, burst: [1, 1], burstPause: [1.3, 2.4],
    damage: 34, velocity: 820, spread: 0.45, range: 110, preferDist: [28, 60],
    grenadeChance: 0.1, flashChance: 0.0, sound: 'dmr', kit: 'tan', tracer: 1, glint: true,
  },
  heavy: {
    name: 'Heavy', hp: 190, armor: 0.55, speed: 3.0, walk: 1.3, weapon: 'lmg',
    rpm: 720, mag: 100, reload: 4.5, burst: [8, 16], burstPause: [0.5, 1.0],
    damage: 11, velocity: 820, spread: 2.4, range: 70, preferDist: [14, 35],
    grenadeChance: 0.25, flashChance: 0.1, sound: 'lmg', kit: 'heavy', tracer: 3,
  },
};

export const DIFFICULTY = {
  recruit:  { name: 'Recruit',  desc: 'Forgiving',       dmg: 0.55, spread: 1.5, react: 1.5, grenade: 0.5, maxAlive: 5 },
  regular:  { name: 'Regular',  desc: 'Balanced',        dmg: 0.75, spread: 1.1, react: 1.0, grenade: 1.0, maxAlive: 7 },
  veteran:  { name: 'Veteran',  desc: 'Smart & deadly',  dmg: 1.2,  spread: 0.8, react: 0.7, grenade: 1.4, maxAlive: 9 },
  realism:  { name: 'Realism',  desc: 'One bad peek, you die', dmg: 1.8, spread: 0.65, react: 0.55, grenade: 1.6, maxAlive: 10 },
};

export const SCORE = { kill: 100, headshot: 60, grenadeKill: 80, stunnedKill: 40, waveBase: 400 };
