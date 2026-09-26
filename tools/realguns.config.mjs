// Per-gun settings for tools/build-realguns.mjs.
//
// Coordinates in the rules are the source model's own (after `rotate`), before
// scaling; `origin` is the model point that becomes gun-space (0, 0, 0): on the
// bore line, level with the sight window. `scale` brings the model to real
// size (checked against the published dimensions of a part named below).
// Every rule gets one island of triangles: { mat, path, c: centre, s: size, min, max, tris }.

const box = (i, [x0, y0, z0], [x1, y1, z1]) => i.c[0] >= x0 && i.c[0] <= x1 && i.c[1] >= y0 && i.c[1] <= y1 && i.c[2] >= z0 && i.c[2] <= z1;

export const GUNS = {
  // Daniel Defense MK18 with an EOTech EXPS3: the player's carbine ('m4')
  m4: {
    title: 'Daniel Defense MK18 with EOTech EXPS3',
    uid: '087e59e5677445cbb4feb183c5428117',
    credit: { title: '( FREE ) Daniel Defense MK18 ( MIL SPEC +® )', author: 'nixo_design', url: 'https://sketchfab.com/3d-models/087e59e5677445cbb4feb183c5428117', license: 'CC BY 4.0' },
    // EXPS3: 97 x 74 x 58 mm; in the model 0.109 x 0.085 x 0.069
    scale: 0.865,
    origin: [0.003, 0.274, 0.024],
    // the G33 magnifier and its flip mount sit behind the EOTech: the game has no magnifier, and it would block the sight
    drop: (i) => (i.c[2] > 0.06 && i.c[1] > 0.29 && /scope2|scope_blue|Plastic__1__56|Glass_Basic_White__[12]|Hard_Rough_Plastic_Black__2|uv[1-4]__/.test(i.mat))
      || box(i, [-0.03, 0.315, 0.085], [0.03, 0.36, 0.14]) // the mount's hinge pin, lever and screws
      || /Emissive_White/.test(i.mat), // the painted reticle disc: the game draws a holographic one
    parts: [
      ['mag', (i) => /Paint_Textured_Black__4/.test(i.mat) && i.c[1] < 0.2 && i.c[2] > -0.1 && i.c[2] < 0.04],
      // ambidextrous T-handle and its latch at the rear of the upper
      ['charge', (i) => box(i, [-0.05, 0.285, 0.12], [0.05, 0.32, 0.2]) && /^(mk18__1__1__1__2__1|Hard_Rough_Plastic_Black__1)$/.test(i.mat)],
      // dust cover over the ejection port (right side) and the bolt carrier behind it
      ['dust', (i) => box(i, [0.008, 0.26, -0.01], [0.03, 0.29, 0.03]) && i.s[2] > 0.08],
      ['bcg', (i) => box(i, [0.005, 0.27, 0.03], [0.03, 0.29, 0.09]) && i.s[2] > 0.2],
      // the EXPS3 and its mount: swapped for the night-vision scope when that optic is chosen
      ['optic', (i) => /\/Layer_0[56]\//.test(i.path)],
    ],
    // the dust cover hinges along its bottom edge
    pivots: { dust: (b) => [b.max[0], b.min[1], 0] },
    anchors: {
      muzzle: [0.003, 0.274, -0.453],     // flash hider tip (the suppressor goes over it)
      window: [0.003, 0.363, 0.024],      // centre of the EXPS3 window
      grip: [0.0, 0.14, 0.175],           // middle of the pistol grip, where the palm wraps
      handguard: [0.0, 0.265, -0.17],     // under the handguard, where the support hand sits
      magwell: [0.0, 0.2, -0.012],        // mouth of the magwell
      eject: [0.02, 0.275, 0.012],        // ejection port
      chargeHandle: [0.0, 0.308, 0.178],
    },
    // SureFire SOCOM556-RC2 (172 mm) over the flash hider
    attach: [{
      uid: '3a3c123f94a446589873b1d4df53c83c', select: (i) => /Socom_4/.test(i.path), rotate: [['y', 90]],
      part: 'supp', at: 'muzzle', length: 0.172, overlap: 0.045,
      credit: { title: 'Suppressors 10 Pack', author: 'TheWarVet', url: 'https://sketchfab.com/3d-models/3a3c123f94a446589873b1d4df53c83c', license: 'CC BY 4.0' },
    }],
    ratio: 0.08, hq: 1, error: 0.0012,
  },

  // Glock 17 (Gen 3): the sidearm. Modelled muzzle +Z, turned round; the slide is its own group in the source.
  glock: {
    title: 'Glock 17',
    uid: '0c7e4441d9a1432f9abb61911c95a8a2',
    credit: { title: '[ FREE ] Rigged Semi-Auto Pistol G17', author: 'nixo_design', url: 'https://sketchfab.com/3d-models/0c7e4441d9a1432f9abb61911c95a8a2', license: 'CC BY 4.0' },
    rotate: [['y', 180]],
    // slide 186 mm; in the model 2.584
    scale: 0.072,
    origin: [0.0, 2.11, 0.138],
    parts: [
      ['slide', (i) => /slide rig/.test(i.path)],
      ['mag', (i) => /magazine/.test(i.path)],
    ],
    anchors: {
      muzzle: [0.0, 2.11, -1.39],
      window: [0.0, 2.27, 0.0],          // sight line (front sight dot height)
      grip: [0.0, 1.25, 0.8],
      magwell: [0.0, 0.4, 1.0],
      eject: [-0.15, 2.2, 0.3],
    },
    ratio: 0.15, hq: 1, error: 0.0008,
  },

  // Benelli M4 Super 90 (M1014) with a side saddle
  m1014: {
    title: 'Benelli M4 Super 90',
    uid: 'a4cb85ebf36c40f9af47dd3e38d340a2',
    credit: { title: 'Shotgun BENELLI M4 Super 90 14"', author: 'drcrazzie', url: 'https://sketchfab.com/3d-models/a4cb85ebf36c40f9af47dd3e38d340a2', license: 'CC BY 4.0' },
    // 18.5" barrel, stock extended: 1.02 m; in the model 5.06 (its saddle shells are drawn a little small)
    scale: 0.2,
    origin: [0.035, 0.446, -0.58],
    parts: [
      // the rearmost saddle shell is the one the left hand carries to the loading port
      ['loose', (i) => i.c[0] < -0.1 && i.s[1] > 0.2 && i.c[2] > -0.52 && i.c[2] < -0.48],
      ['charge', (i) => box(i, [0.08, 0.38, -0.7], [0.13, 0.47, -0.6])],
    ],
    pivots: { loose: (b) => [0, 1, 2].map((a) => (b.min[a] + b.max[a]) / 2) },
    anchors: {
      muzzle: [0.072, 0.446, -3.58],
      window: [0.007, 0.58, -0.36],      // ghost ring
      grip: [0.0, -0.03, 0.05],
      handguard: [0.035, 0.286, -1.74],  // forend
      magwell: [0.035, 0.25, -0.55],     // loading port
      eject: [0.1, 0.45, -0.55],
      chargeHandle: [0.104, 0.424, -0.652],
    },
    ratio: 0.3, hq: 1, error: 0.0008,
  },

  // USMC M40A5 (Remington 700 action, McMillan A5 stock, Schmidt & Bender scope): stands in for the MK13.
  // Modelled at an angle: the barrel runs along (0.527, 0.170, 0.833), turned onto -Z.
  sniper: {
    title: 'M40A5 sniper rifle',
    uid: 'f724d89f40db46b0afce2b57ac6d4823',
    credit: { title: 'USMC M40A5 Sniper', author: 'Urpo', url: 'https://sketchfab.com/3d-models/f724d89f40db46b0afce2b57ac6d4823', license: 'CC BY 4.0' },
    rotate: [['y', 147.7], ['x', -9.8], ['z', -42]],
    // 1124 mm overall; in the model 2.0
    scale: 0.562, origin: [-0.014, 0.037, 0.2],
    parts: [
      ['mag', (i) => box(i, [-0.05, -0.1, 0.18], [0.02, -0.03, 0.3]) && i.s[2] < 0.14],
    ],
    // the bolt is part of the receiver mesh: its handle (out to the right) and shroud (at the back) are cut out
    split: [['bolt', (i) => box(i, [-0.02, -0.02, 0.25], [0.04, 0.06, 0.35]) && i.tris > 1000, (c) => (c[0] > 0.022 && c[2] > 0.33) || c[2] > 0.395]],
    anchors: {
      muzzle: [-0.014, 0.037, -1.0],
      window: [-0.016, 0.136, 0.401],    // scope axis at the ocular
      grip: [-0.014, -0.088, 0.517],
      handguard: [-0.014, -0.025, -0.092],
      magwell: [-0.016, -0.04, 0.243],
      eject: [0.02, 0.04, 0.3],
      boltHandle: [0.058, 0.02, 0.4],
    },
    ratio: 0.5, hq: 1, error: 0.0006,
  },
};
