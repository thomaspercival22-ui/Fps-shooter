// Material regions of the sculpted weapons, shared by the build tool
// (src/gunparts.js) and the weapon shader (src/gunmaterial.js).
export const G = {
  ANOD: 0,     // black hard-anodised aluminium (receivers, rails, optics)
  STEEL: 1,    // black nitrided / phosphated steel (barrels, pins, levers)
  POLY: 2,     // black glass-filled polymer
  FDE: 3,      // flat dark earth Cerakote / polymer
  RUBBER: 4,   // black rubber (butt pads, buttons, eyecups)
  BRIGHT: 5,   // bright nickel-boron / polished steel (bolt carrier, bolt)
  BRASS: 6,
  CAN: 7,      // suppressor high-temperature Cerakote
  OD: 8,       // OD green Cerakote (sniper chassis)
  SHELL: 9,    // red shotgun hull
  BLACK: 10,   // flat black paint / dark recesses
  WHITE: 11,   // white index marks and sight dots
  POLYTEX: 12, // stippled black polymer (grip panels)
  FDETEX: 13,  // textured FDE polymer (magazine grip panels)
  KNURL: 14,   // knurled black steel / aluminium (turret caps, collars)
  GRAY: 15,    // tungsten-grey Cerakote (sniper action, turrets)
};
export const REGION_COUNT = 16;
