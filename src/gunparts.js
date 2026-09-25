// Sculpted weapon parts (build time only; see tools/build-guns.mjs). Every
// gun is a list of rigid parts modelled from machined, extruded and turned
// shapes with real dimensions. Gun space: x right, y up, bore on y = 0,
// muzzle towards -z; profiles are written as [forward, up] etc. (metres).
import { Part, extrudeX, extrudeY, extrudeZ, lathe, box, cyl, sphere, capsule, slot, rotate, intersect, mirrorX, fillet, rrect, circle, ngon, arc } from './hardsurface.js';
import { G } from './gunregions.js';

const { PI, cos, sin } = Math;
const FWD = [0, 0, 1], UP = [0, 1, 0], RIGHT = [1, 0, 0];

/** MIL-STD-1913 rail from f0 to f1 whose base sits at yBase; recoil slots every 10.01 mm. */
function picatinny(p, f0, f1, yBase = 0.0165, region = G.ANOD, firstSlot = null) {
  const top = 0.029;
  const half = fillet([[-0.0077, yBase], [0.0077, yBase], [0.0077, 0.0228], [0.0106, 0.0257], [0.0106, 0.0270], [0.0093, top], [-0.0093, top], [-0.0106, 0.0270], [-0.0106, 0.0257], [-0.0077, 0.0228]],
    [0, 0, 0.0004, 0.0003, 0.0003, 0.0005, 0.0005, 0.0003, 0.0003, 0.0004], 3);
  p.add(extrudeZ(half, f0, f1, 0.0005), region, 0.0006);
  const s0 = firstSlot ?? f0 + 0.006;
  for (let f = s0; f < f1 - 0.004; f += 0.01001) p.sub(box([0, top, f], [0.0125, 0.003, 0.00262], 0.00035), 0.0003);
}

/** Socket-head cap screw seen end-on, axis along 'x' | 'y' | 'z'. */
function screw(p, axis, c, r, region = G.STEEL, depth = 0.0015) {
  p.add(cyl(axis, c, r, depth / 2, 0.00025), region, 0.0003);
  const hex = axis === 'x' ? [c[0] + Math.sign(c[0] || 1) * depth / 2, c[1], c[2]] : axis === 'y' ? [c[0], c[1] + depth / 2, c[2]] : [c[0], c[1], c[2] + depth / 2];
  p.sub(cyl(axis, hex, r * 0.45, depth * 0.45, 0.0001), 0.0001);
}

// =====================================================================
// M4A1 carbine: flat-top upper, billet-style lower, 13" M-LOK handguard,
// QD suppressor, SOPMOD-style stock, EXPS3 holographic sight, PEQ, light.
// =====================================================================
function m4Upper() {
  const p = new Part('upper', { cell: 0.00028, tris: 26000 });
  // receiver body: side profile intersected with the front section
  const side = fillet([[-0.105, -0.0065], [0.0605, -0.0065], [0.0605, -0.0135], [0.079, -0.0135], [0.079, -0.0065], [0.0855, -0.0065], [0.0855, 0.0172], [-0.105, 0.0172]], [0.0006, 0.001, 0.001, 0.0015, 0.001, 0.0008, 0.0008, 0.0008], 3);
  const front = fillet([[-0.0133, -0.0135], [0.0133, -0.0135], [0.0133, 0.0135], [0.0098, 0.0178], [-0.0098, 0.0178], [-0.0133, 0.0135]], [0.0022, 0.0022, 0.0028, 0.001, 0.001, 0.0028], 4);
  p.add(intersect(extrudeX(side, -0.0133, 0.0133, 0.0006), extrudeZ(front, -0.106, 0.086, 0.0006), 0.0005), G.ANOD);
  // rear takedown lug
  p.add(extrudeX(fillet([[-0.1, -0.006], [-0.085, -0.006], [-0.087, -0.0135], [-0.1, -0.0135]], 0.0012), -0.0045, 0.0045, 0.0006), G.ANOD, 0.001);
  // forward-assist housing blended into the right side, knob with a ribbed face
  p.add(cyl('z', [0.0118, 0.0112, -0.064], 0.0072, 0.02, 0.0012), G.ANOD, 0.0035);
  p.add(cyl('z', [0.0118, 0.0112, -0.0885], 0.0058, 0.0045, 0.0009), G.STEEL, 0.0004);
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * PI;
    p.sub(rotate(box([0.0118, 0.0112, -0.0932], [0.0065, 0.00045, 0.0008], 0.0002), [0, 0, a], [0.0118, 0.0112, -0.0932]), 0.0002);
  }
  // brass deflector behind the ejection port
  p.add(extrudeY(fillet([[-0.004, 0.0128], [-0.024, 0.0128], [-0.024, 0.0172], [-0.012, 0.0188], [-0.005, 0.0182]], 0.0012), 0.003, 0.0172, 0.0008), G.ANOD, 0.0025);
  // ejection port with its hinge knuckles and pin
  p.sub(box([0.0134, 0.012, 0.026], [0.0062, 0.0074, 0.0268], 0.0008), 0.0004);
  p.add(cyl('z', [0.0141, 0.0045, 0.026], 0.0013, 0.0295, 0.0002), G.STEEL, 0.0003);
  for (const f of [-0.0015, 0.0535]) p.add(box([0.0135, 0.0045, f], [0.0012, 0.0022, 0.0022], 0.0007), G.ANOD, 0.001);
  // charging-handle channel at the top rear
  p.sub(box([0, 0.0185, -0.1], [0.0052, 0.0065, 0.008], 0.0006), 0.0004);
  // the receiver front ring the barrel nut threads onto
  p.add(cyl('z', [0, 0, 0.088], 0.0165, 0.004, 0.0008), G.ANOD, 0.0008);
  // side "gas key" lightening pocket (left side, above the bolt-catch cut)
  p.sub(box([-0.0133, 0.007, -0.03], [0.0006, 0.0045, 0.03], 0.0008), 0.0004);
  picatinny(p, -0.1055, 0.0855, 0.0165, G.ANOD, -0.101);
  return p;
}

function m4BCG() {
  // nickel-boron bolt carrier seen through the ejection port: carrier body,
  // forward-assist serrations on the right, bolt head with the extractor
  const p = new Part('bcg', { anim: 'bcg', cell: 0.00028, tris: 4000, lod: false });
  p.add(cyl('z', [0, 0.0005, -0.03], 0.0118, 0.066, 0.0008), G.BRIGHT);
  for (let i = 0; i < 11; i++) p.sub(box([0.0118, 0.0035, 0.004 + i * 0.0026], [0.0014, 0.0045, 0.0006], 0.0002), 0.0002);
  p.add(cyl('z', [0, 0.0005, 0.041], 0.0092, 0.006, 0.0006), G.BRIGHT, 0.0006);
  p.add(box([0.0088, 0.0015, 0.04], [0.0012, 0.0025, 0.007], 0.0004), G.STEEL, 0.0004);
  p.sub(cyl('x', [0.0118, 0.004, 0.012], 0.0022, 0.004, 0.0003), 0.0003); // cam-pin window
  return p;
}

function m4DustCover() {
  // spring-loaded dust cover, hinged along the bottom edge of the port
  const p = new Part('dust', { anim: 'dust', pivot: [0.0141, 0.0045, 0], cell: 0.00022, tris: 2500 });
  const sect = fillet([[0.0133, 0.0052], [0.0149, 0.0052], [0.0151, 0.012], [0.0146, 0.0196], [0.0131, 0.0196]], 0.0005);
  p.add(extrudeZ(sect, -0.0005, 0.0525, 0.0004), G.ANOD);
  p.add(box([0.0154, 0.0122, 0.024], [0.0007, 0.0028, 0.0022], 0.0006), G.ANOD, 0.0008); // detent bump
  for (const f of [0.006, 0.046]) p.add(box([0.0151, 0.0122, f], [0.0004, 0.0055, 0.0009], 0.0003), G.ANOD, 0.0006);
  p.add(cyl('z', [0.0141, 0.0045, 0.026], 0.0017, 0.0235, 0.0003), G.ANOD, 0.0008);
  return p;
}

function m4ChargingHandle() {
  // ambidextrous charging handle: wide latch wings behind the upper
  const p = new Part('charge', { anim: 'charge', cell: 0.00024, tris: 4000 });
  const plan = fillet([[-0.093, -0.0048], [-0.093, 0.0048], [-0.112, 0.0048], [-0.114, 0.0105], [-0.117, 0.0215], [-0.1245, 0.0235], [-0.1265, 0.019], [-0.1265, -0.019], [-0.1245, -0.0235], [-0.117, -0.0215], [-0.114, -0.0105], [-0.112, -0.0048]],
    [0.0005, 0.0005, 0.002, 0.003, 0.002, 0.002, 0.003, 0.003, 0.002, 0.002, 0.003, 0.002], 4);
  p.add(extrudeY(plan, 0.0152, 0.0228, 0.0012), G.ANOD);
  for (const s of [-1, 1]) for (let i = 0; i < 4; i++) p.sub(box([s * (0.012 + i * 0.0025), 0.0228, -0.1215], [0.0005, 0.0012, 0.004], 0.0002), 0.0002);
  return p;
}

function m4Lower() {
  const p = new Part('lower', { cell: 0.00028, tris: 26000 });
  // receiver body
  const side = fillet([[-0.106, -0.0068], [0.078, -0.0068], [0.0795, -0.02], [0.0765, -0.057], [0.0725, -0.0605], [0.0, -0.0605], [-0.003, -0.057], [-0.003, -0.0405],
    [-0.032, -0.0405], [-0.036, -0.041], [-0.078, -0.041], [-0.098, -0.03], [-0.106, -0.022]], [0.0008, 0.0012, 0.004, 0.003, 0.002, 0.002, 0.0015, 0.001, 0.001, 0.0015, 0.004, 0.004, 0.003], 4);
  const front = fillet([[-0.0125, -0.066], [0.0125, -0.066], [0.0125, -0.0068], [-0.0125, -0.0068]], [0.0015, 0.0015, 0.0008, 0.0008], 3);
  p.add(intersect(extrudeX(side, -0.0125, 0.0125, 0.0007), extrudeZ(front, -0.107, 0.081, 0.0005), 0.0004), G.ANOD);
  // magwell walls (wider than the body) and the flared lip
  p.add(extrudeX(fillet([[0.0005, -0.0135], [0.0775, -0.0135], [0.0765, -0.057], [0.0725, -0.0605], [0.0005, -0.0605]], [0.002, 0.003, 0.004, 0.002, 0.002], 4), -0.0142, 0.0142, 0.0008), G.ANOD, 0.0018);
  const lipO = fillet(rrect(0.0385, 0, 0.0845, 0.0322, 0.004, 5), 0);
  p.add(extrudeY([lipO], -0.0655, -0.0575, 0.0012), G.ANOD, 0.004);
  p.sub(box([0, -0.035, 0.0375], [0.0121, 0.033, 0.0345], 0.0012), 0.0006); // magazine channel
  p.sub(extrudeY([fillet(rrect(0.0375, 0, 0.078, 0.0282, 0.004, 5), 0)], -0.07, -0.059, 0.0), 0.0012); // flared mouth
  // front of the magwell: a bevel scallop for the support hand
  p.sub(cyl('x', [0, -0.033, 0.094], 0.017, 0.02, 0.0005), 0.003);
  // receiver-extension boss around the buffer tube threads
  p.add(cyl('z', [0, 0.0, -0.1025], 0.0165, 0.0045, 0.0015), G.ANOD, 0.003);
  // takedown / pivot pins: heads on the left, ends on the right
  for (const f of [0.07, -0.093]) {
    p.add(cyl('x', [-0.0133, -0.0095, f], 0.0043, 0.0012, 0.0006), G.STEEL, 0.0003);
    p.add(cyl('x', [0.0129, -0.0095, f], 0.0027, 0.0006, 0.0003), G.STEEL, 0.0002);
  }
  // hammer and trigger pins
  for (const f of [-0.012, -0.034]) for (const s of [-1, 1]) p.add(cyl('x', [s * 0.0126, -0.0265, f], 0.0019, 0.0004, 0.00015), G.STEEL, 0.0002);
  // bolt catch (left): paddle with ribs
  const bc = fillet([[0.0005, -0.0085], [0.0105, -0.0085], [0.0125, -0.0115], [0.0115, -0.0165], [0.005, -0.024], [0.0005, -0.024]], 0.0012, 3);
  p.add(extrudeX(bc, -0.0159, -0.0126, 0.0006), G.STEEL, 0.0005);
  for (let i = 0; i < 4; i++) p.sub(box([-0.0159, -0.0105 - i * 0.0014, 0.007], [0.0004, 0.00035, 0.004], 0.0001), 0.0001);
  // magazine release (right) inside its fence
  p.add(cyl('x', [0.0138, -0.0275, -0.0025], 0.0049, 0.0013, 0.0007), G.STEEL, 0.0004);
  for (let i = 0; i < 5; i++) p.sub(box([0.0152, -0.0275, -0.0025 + (i - 2) * 0.0016], [0.0003, 0.004, 0.00035], 0.0001), 0.0001);
  p.add(extrudeX(fillet([[0.0045, -0.018], [0.0045, -0.037], [-0.0055, -0.037], [-0.0055, -0.035], [0.0025, -0.035], [0.0025, -0.02]], 0.0006, 2), 0.0118, 0.0158, 0.0006), G.ANOD, 0.0012);
  // selector: pivot barrel and lever on the left, stub on the right, SAFE/FIRE marks
  p.add(cyl('x', [-0.0133, -0.0175, -0.046], 0.0047, 0.0009, 0.0005), G.STEEL, 0.0004);
  p.add(extrudeX(fillet([[-0.046, -0.0145], [-0.02, -0.0152], [-0.018, -0.0172], [-0.02, -0.0194], [-0.046, -0.0205]], 0.0014, 3), -0.0158, -0.0143, 0.0005), G.STEEL, 0.0006);
  p.add(cyl('x', [0.0133, -0.0175, -0.046], 0.0035, 0.0006, 0.0003), G.STEEL, 0.0003);
  p.paint(cyl('x', [-0.0125, -0.0118, -0.053], 0.0009, 0.0015, 0), G.WHITE);
  p.paint(cyl('x', [-0.0125, -0.0118, -0.039], 0.0009, 0.0015, 0), G.WHITE);
  // trigger guard (billet, integral) with the finger opening
  const tgO = fillet([[0.0005, -0.0395], [0.0005, -0.0585], [-0.0045, -0.0645], [-0.058, -0.0645], [-0.0635, -0.0595], [-0.0655, -0.045], [-0.059, -0.041]], [0.001, 0.003, 0.004, 0.004, 0.004, 0.003, 0.002], 4);
  const tgI = fillet([[-0.0035, -0.0415], [-0.0035, -0.0565], [-0.0075, -0.0605], [-0.054, -0.0605], [-0.0585, -0.0565], [-0.0595, -0.046], [-0.0565, -0.0415]], [0.001, 0.0025, 0.003, 0.003, 0.003, 0.002, 0.001], 4);
  p.add(extrudeX([tgO, tgI], -0.0063, 0.0063, 0.0014), G.ANOD, 0.0015);
  return p;
}

function m4Trigger() {
  const p = new Part('trigger', { cell: 0.0002, tris: 2000 });
  const tr = fillet([[-0.0085, -0.0395], [-0.0045, -0.0395], [-0.0052, -0.045], [-0.0085, -0.0508], [-0.0138, -0.0548], [-0.0168, -0.0548], [-0.0152, -0.0512], [-0.0118, -0.0462], [-0.0106, -0.0412]],
    [0, 0, 0.004, 0.004, 0.002, 0.0012, 0.003, 0.004, 0.002], 4);
  p.add(extrudeX(tr, -0.0031, 0.0031, 0.0009), G.STEEL);
  for (let i = 0; i < 5; i++) p.sub(rotate(box([0, -0.047 - i * 0.0015, -0.0072 - i * 0.0014], [0.004, 0.00025, 0.0012], 0.0001), [0.7, 0, 0], [0, -0.047 - i * 0.0015, -0.0072 - i * 0.0014]), 0.0001);
  return p;
}

function m4Grip() {
  // ergonomic grip: beavertail, finger rest, stippled side panels, storage cap
  const p = new Part('grip', { cell: 0.00028, tris: 9000 });
  const side = fillet([[-0.0355, -0.0405], [-0.077, -0.0405], [-0.0885, -0.0455], [-0.086, -0.052], [-0.0925, -0.085], [-0.0975, -0.1205], [-0.0935, -0.1305], [-0.0625, -0.1285],
    [-0.0585, -0.117], [-0.0535, -0.0915], [-0.0495, -0.0795], [-0.0505, -0.0715], [-0.0455, -0.0555], [-0.0395, -0.0445]],
  [0, 0.004, 0.004, 0.006, 0.02, 0.006, 0.004, 0.004, 0.02, 0.02, 0.004, 0.004, 0.015, 0.004], 5);
  p.add(extrudeX(side, -0.0139, 0.0139, 0.0058), G.POLY);
  for (const s of [-1, 1]) p.paint(rotate(box([s * 0.013, -0.088, -0.0735], [0.004, 0.024, 0.015], 0.004), [-0.42, 0, 0], [s * 0.013, -0.088, -0.0735]), G.POLYTEX);
  p.paint(box([0, -0.087, -0.052], [0.0095, 0.019, 0.004], 0.003), G.POLYTEX);
  // storage-core cap and the bottom lip
  p.add(rotate(box([0, -0.1315, -0.0785], [0.0112, 0.0022, 0.0152], 0.0018), [-0.07, 0, 0], [0, -0.1315, -0.0785]), G.POLY, 0.001);
  p.sub(rotate(box([0, -0.1345, -0.0785], [0.0006, 0.0015, 0.008], 0.0002), [-0.07, 0, 0], [0, -0.1345, -0.0785]), 0.0002);
  return p;
}

function m4BufferTube() {
  const p = new Part('tube', { cell: 0.0003, tris: 8000 });
  p.add(cyl('z', [0, 0, -0.2015], 0.0149, 0.0935, 0.0012), G.ANOD);
  // castle nut with three notches, end plate with a QD socket
  p.add(lathe([[0.0149, -0.1058], [0.0184, -0.1058], [0.0188, -0.1066], [0.0188, -0.1152], [0.0184, -0.1162], [0.0149, -0.1162]], 'z', [0, 0]), G.STEEL, 0.0003);
  for (let i = 0; i < 3; i++) { const a = PI / 2 + i * 2 * PI / 3; p.sub(rotate(box([0, 0.0185, -0.1135], [0.0022, 0.0025, 0.004], 0.0003), [0, 0, a - PI / 2], [0, 0, -0.1135]), 0.0003); }
  p.add(extrudeZ([fillet([[-0.0155, -0.0215], [0.0155, -0.0215], [0.0165, 0.0125], [-0.0205, 0.0125], [-0.021, -0.004]], 0.004, 4)], -0.1068, -0.1044, 0.0005), G.STEEL, 0.0004);
  p.add(cyl('x', [-0.022, -0.004, -0.1062], 0.0055, 0.004, 0.0008), G.STEEL, 0.0015);
  p.sub(cyl('x', [-0.026, -0.004, -0.1062], 0.0036, 0.004, 0.0003), 0.0003);
  // stock rail with adjustment holes underneath
  p.add(box([0, -0.0158, -0.2], [0.0036, 0.0022, 0.086], 0.0006), G.ANOD, 0.0012);
  for (let i = 0; i < 6; i++) p.sub(cyl('y', [0, -0.018, -0.14 - i * 0.0254], 0.0016, 0.004, 0.0002), 0.0002);
  return p;
}

function m4Stock() {
  // SOPMOD-style stock: tube housing with a wide cheek weld, side battery
  // tubes, sling loops, lock lever and a rubber butt pad
  const p = new Part('stock', { cell: 0.0003, tris: 16000 });
  const side = fillet([[-0.19, 0.022], [-0.338, 0.024], [-0.345, 0.018], [-0.345, -0.078], [-0.337, -0.092], [-0.318, -0.094], [-0.265, -0.052], [-0.232, -0.028], [-0.19, -0.02]],
    [0.004, 0.008, 0.004, 0.004, 0.008, 0.006, 0.02, 0.01, 0.004], 5);
  const front = fillet([[-0.0205, -0.1], [0.0205, -0.1], [0.0205, 0.0], [0.024, 0.008], [0.0215, 0.025], [-0.0215, 0.025], [-0.024, 0.008], [-0.0205, 0.0]], [0.005, 0.005, 0.004, 0.006, 0.009, 0.009, 0.006, 0.004], 5);
  p.add(intersect(extrudeX(side, -0.025, 0.025, 0.003), extrudeZ(front, -0.35, -0.185, 0.003), 0.0025), G.FDE);
  // lightening cut through the lower body
  p.sub(extrudeX(fillet([[-0.258, -0.022], [-0.322, -0.022], [-0.322, -0.07], [-0.3, -0.074], [-0.268, -0.045]], 0.005, 4), -0.03, 0.03, 0.002), 0.0015);
  // the tube bore at the front, lock lever underneath
  p.sub(cyl('z', [0, 0, -0.19], 0.0152, 0.006, 0.0006), 0.0008);
  p.add(extrudeX(fillet([[-0.205, -0.02], [-0.245, -0.024], [-0.248, -0.03], [-0.21, -0.029]], 0.002, 3), -0.0055, 0.0055, 0.0012), G.POLY, 0.0015);
  // sling slots and a QD cup on each side
  for (const s of [-1, 1]) {
    p.sub(cyl('x', [s * 0.025, 0.005, -0.215], 0.0045, 0.004, 0.0008), 0.0008);
    p.sub(slot([s * 0.0205, -0.07, -0.332], UP, [s, 0, 0], 0.018, 0.005, 0.006, 0.01), 0.0008);
  }
  // rubber butt pad with ribs
  p.add(extrudeX(fillet([[-0.344, 0.024], [-0.356, 0.024], [-0.356, -0.094], [-0.337, -0.094], [-0.344, -0.08]], 0.004, 4), -0.021, 0.021, 0.004), G.RUBBER, 0.001);
  for (let i = 0; i < 11; i++) p.sub(box([0, 0.015 - i * 0.01, -0.357], [0.03, 0.0012, 0.0012], 0.0004), 0.0004);
  return p;
}

function m4Handguard() {
  const p = new Part('handguard', { cell: 0.0003, tris: 34000, error: 0.0001 });
  const outer = ngon(0, 0, 0.0238, 8, 0.0045, PI / 8);
  const inner = ngon(0, 0, 0.0212, 8, 0.0032, PI / 8);
  p.add(extrudeZ([outer, inner], 0.0858, 0.405, 0.0009), G.ANOD);
  // M-LOK slots on both sides, both lower 45 degree faces and the bottom
  const faces = [[1, 0], [-1, 0], [0.7071, -0.7071], [-0.7071, -0.7071], [0, -1]];
  for (const [nx, ny] of faces) {
    const R = 0.022;
    for (let f = 0.118; f < 0.39; f += 0.04) {
      if (nx === 0 && f > 0.36) continue;
      p.sub(slot([nx * R, ny * R, f], FWD, [nx, ny, 0], 0.032, 0.0072, 0.004, 0.01), 0.0005);
    }
  }
  // triangular lightening windows on the upper 45 degree faces
  for (const s of [-1, 1]) for (let f = 0.138; f < 0.37; f += 0.04) p.sub(slot([s * 0.7071 * 0.022, 0.7071 * 0.022, f], FWD, [s * 0.7071, 0.7071, 0], 0.014, 0.0055, 0.004, 0.01), 0.0005);
  // barrel-nut clamp: bottom pad with two cap screws, anti-rotation tabs at the rear
  p.add(box([0, -0.0232, 0.101], [0.0085, 0.0024, 0.0145], 0.0015), G.ANOD, 0.002);
  for (const f of [0.094, 0.108]) screw(p, 'y', [0, -0.0258, f], 0.0021, G.STEEL, 0.001);
  // QD sling cups front-left and rear-left
  for (const f of [0.382, 0.106]) {
    p.add(cyl('x', [-0.0225, -0.002, f], 0.0062, 0.0022, 0.001), G.ANOD, 0.002);
    p.sub(cyl('x', [-0.0245, -0.002, f], 0.0038, 0.003, 0.0004), 0.0004);
  }
  picatinny(p, 0.0858, 0.405, 0.0195, G.ANOD, 0.0888);
  return p;
}

function m4Barrel() {
  // visible barrel between the handguard and the suppressor, and the gas block
  const p = new Part('barrel', { cell: 0.00028, tris: 9000 });
  p.add(lathe([[0, 0.086], [0.0105, 0.086], [0.0098, 0.12], [0.0098, 0.335], [0.0093, 0.338], [0.0093, 0.468], [0, 0.468]], 'z', [0, 0]), G.STEEL);
  // low-profile gas block with its set screws
  p.add(intersect(cyl('z', [0, 0.003, 0.345], 0.0135, 0.011, 0.0012), box([0, 0.004, 0.345], [0.0112, 0.0142, 0.012], 0.0012), 0.0008), G.STEEL, 0.001);
  // muzzle-device ratchet ring the suppressor locks onto
  p.add(lathe([[0.0092, 0.455], [0.0132, 0.455], [0.0138, 0.457], [0.0138, 0.468], [0.0092, 0.468]], 'z', [0, 0]), G.STEEL, 0.0004);
  for (let i = 0; i < 18; i++) { const a = i / 18 * 2 * PI; p.sub(rotate(box([0, 0.0138, 0.4615], [0.0007, 0.0008, 0.0055], 0.0002), [0, 0, a], [0, 0, 0.4615]), 0.0002); }
  // three-prong flash hider (hidden inside the suppressor on the player's rifle)
  p.add(lathe([[0.0035, 0.468], [0.0105, 0.468], [0.011, 0.47], [0.011, 0.512], [0.0098, 0.5145], [0.0048, 0.5145], [0.0048, 0.47], [0.0035, 0.47]], 'z', [0, 0]), G.STEEL, 0.0004);
  for (let i = 0; i < 3; i++) { const a = i / 3 * 2 * PI + PI / 2; p.sub(rotate(box([0, 0.009, 0.5], [0.0012, 0.004, 0.012], 0.0006), [0, 0, a], [0, 0, 0.5]), 0.0004); }
  return p;
}

function m4Suppressor() {
  // QD suppressor: knurled locking collar with a latch, welded body tube,
  // stepped front cap with wrench flats around the bore exit
  const p = new Part('supp', { anim: 'supp', cell: 0.00025, tris: 16000, material: 'can', lod: false });
  const prof = [[0, 0.466], [0.0158, 0.466], [0.0176, 0.4672], [0.0198, 0.4705], [0.0198, 0.4925], [0.0186, 0.4945], [0.0186, 0.4965], [0.0192, 0.498],
    [0.0192, 0.6455], [0.0186, 0.6505], [0.0174, 0.6555], [0.0162, 0.6588], [0.0076, 0.6602], [0.0068, 0.6632], [0.0046, 0.6632], [0.0046, 0.64], [0, 0.64]];
  p.add(lathe(prof, 'z', [0, 0]), G.CAN);
  for (let i = 0; i < 36; i++) { const a = i / 36 * 2 * PI; p.sub(rotate(box([0, 0.0199, 0.4815], [0.00045, 0.0006, 0.0088], 0.00015), [0, 0, a], [0, 0, 0.4815]), 0.00015); }
  p.sub(lathe([[0.0185, 0.4812], [0.021, 0.4812], [0.021, 0.4822], [0.0185, 0.4822]], 'z', [0, 0]), 0.0002); // groove splitting the knurl
  // latch tab
  p.add(box([0.0172, 0.0092, 0.483], [0.0028, 0.0018, 0.0085], 0.0008), G.STEEL, 0.001);
  // weld seams on the tube
  for (const f of [0.5, 0.643]) p.add(lathe([[0.0191, f - 0.0009], [0.01935, f], [0.0191, f + 0.0009]], 'z', [0, 0]), G.CAN, 0.0004);
  // wrench flats on the front cap
  for (const s of [-1, 1]) p.sub(box([s * 0.0225, 0, 0.653], [0.005, 0.03, 0.006], 0.0004), 0.0004);
  return p;
}

/** Centre, forward normal and tilt of the 5.56 magazine curve at t (0 top .. 1 bottom). */
function magCurve(t) {
  const y = -0.03 - t * 0.172, f = 0.0385 + t * t * 0.041 + t * 0.012;
  const df = 0.082 * t + 0.012, dy = -0.172, l = Math.hypot(df, dy);
  return { y, f, nf: -dy / l, ny: df / l, a: Math.atan2(df, -dy) };
}
function m4Pmag() {
  // curved 30-round polymer magazine: one continuous curved body, raised
  // ridges, textured grip panels, flared base plate with a pull tab
  const p = new Part('pmag', { anim: 'mag', cell: 0.00028, tris: 9000 });
  const front = [], rear = [];
  for (let i = 0; i <= 16; i++) {
    const t = -0.08 + i / 16 * 1.08, c = magCurve(t);
    front.push([c.f + c.nf * 0.0312, c.y + c.ny * 0.0312]);
    rear.unshift([c.f - c.nf * 0.0312, c.y - c.ny * 0.0312]);
  }
  const loop = [...front, ...rear];
  const r = loop.map((_, i) => (i === 0 || i === 16 || i === 17 || i === 33 ? 0.003 : 0));
  p.add(extrudeX(fillet(loop, r, 3), -0.0119, 0.0119, 0.0026), G.FDE);
  for (const t of [0.14, 0.22, 0.3]) {
    const c = magCurve(t);
    p.add(box([0, c.y, c.f], [0.0126, 0.0011, 0.0285], 0.0009, [c.a, 0, 0]), G.FDE, 0.0012);
  }
  for (const s of [-1, 1]) {
    const c = magCurve(0.7);
    p.paint(box([s * 0.012, c.y, c.f], [0.003, 0.024, 0.025], 0.003, [c.a, 0, 0]), G.FDETEX);
  }
  const c1 = magCurve(1.0);
  p.add(box([0, c1.y - 0.0105, c1.f + 0.001], [0.0142, 0.0058, 0.0372], 0.0026, [c1.a, 0, 0]), G.FDE, 0.003);
  p.add(box([0, c1.y - 0.017, c1.f - 0.026], [0.0065, 0.0025, 0.0065], 0.0018, [c1.a, 0, 0]), G.RUBBER, 0.0015);
  return p;
}

function m4Exps3() {
  // EXPS3-style holographic sight: QD base, battery cap at the front,
  // rounded hood around the window, rear buttons, side levers and adjusters
  const p = new Part('exps3', { anim: 'opt:holo', cell: 0.00024, tris: 18000 });
  const base = fillet([[-0.058, 0.0292], [0.036, 0.0292], [0.046, 0.0342], [0.046, 0.049], [0.037, 0.0555], [-0.05, 0.0555], [-0.058, 0.0485]], [0.002, 0.003, 0.004, 0.004, 0.004, 0.004, 0.003], 4);
  p.add(extrudeX(base, -0.0195, 0.0195, 0.0022), G.ANOD);
  // rail clamp jaws under the base
  p.add(box([0, 0.0302, -0.01], [0.0118, 0.0022, 0.03], 0.0008), G.ANOD, 0.001);
  // hood: rounded frame around the window
  const outer = rrect(0, 0.0765, 0.046, 0.046, 0.0065, 6), inner = rrect(0, 0.0748, 0.035, 0.03, 0.0035, 6);
  p.add(extrudeZ([outer, inner], -0.034, 0.018, 0.0016), G.ANOD, 0.004);
  // battery compartment cap (left, knurled) and the tube across the front
  p.add(cyl('x', [-0.001, 0.046, 0.024], 0.0078, 0.0205, 0.0012), G.ANOD, 0.002);
  p.add(cyl('x', [-0.0215, 0.046, 0.024], 0.0088, 0.0034, 0.0008), G.KNURL, 0.0004);
  // buttons on the rear face and the NV button
  for (const y of [0.0455, 0.0505]) p.add(box([-0.006, y, -0.0592], [0.004, 0.0018, 0.0012], 0.0009), G.RUBBER, 0.0005);
  p.add(cyl('z', [0.008, 0.048, -0.0592], 0.0026, 0.0012, 0.0006), G.RUBBER, 0.0005);
  // QD levers (right)
  for (const f of [-0.035, -0.006]) {
    p.add(extrudeY(fillet([[f + 0.009, 0.0195], [f - 0.009, 0.0195], [f - 0.008, 0.0235], [f + 0.0065, 0.0228]], 0.0015, 3), 0.031, 0.0395, 0.0009), G.STEEL, 0.0008);
    screw(p, 'y', [0.0215, 0.0402, f + 0.004], 0.0018, G.STEEL, 0.0008);
  }
  // windage (right) and elevation adjusters
  p.add(cyl('x', [0.0205, 0.0505, -0.021], 0.0042, 0.0012, 0.0005), G.ANOD, 0.0008);
  p.sub(box([0.022, 0.0505, -0.021], [0.0006, 0.0034, 0.0005], 0.0001), 0.0001);
  p.add(cyl('y', [0.0, 0.1005, -0.022], 0.0042, 0.0015, 0.0005), G.ANOD, 0.0008);
  p.sub(box([0, 0.102, -0.022], [0.0034, 0.0006, 0.0005], 0.0001), 0.0001);
  return p;
}

function m4NvScope() {
  // digital day/night riflescope: QD mount, sensor/display body, objective
  // bell, rubber eyecup, top control knob and an IR illuminator on the side
  const p = new Part('nvscope', { anim: 'opt:nv', lod: false, cell: 0.0003, tris: 20000, error: 0.00014 });
  const ax = 0.078;
  p.add(extrudeX(fillet([[-0.07, 0.029], [0.07, 0.029], [0.07, 0.046], [-0.07, 0.046]], 0.003), -0.015, 0.015, 0.0015), G.ANOD);
  p.add(box([0.021, 0.041, 0.03], [0.006, 0.006, 0.015], 0.0015), G.ANOD, 0.001);
  p.add(intersect(extrudeZ([rrect(0, ax, 0.05, 0.058, 0.012, 6)], -0.075, 0.065, 0.004), extrudeX(fillet([[-0.075, ax - 0.03], [0.065, ax - 0.03], [0.065, ax + 0.029], [-0.06, ax + 0.029], [-0.075, ax + 0.02]], 0.006), -0.03, 0.03, 0.003), 0.002), G.POLY, 0.003);
  p.add(lathe([[0, 0.063], [0.024, 0.063], [0.031, 0.108], [0.0305, 0.113], [0.0265, 0.114], [0.0265, 0.111], [0, 0.111]], 'z', [0, ax]), G.POLY, 0.002);
  p.add(lathe([[0.0285, 0.108], [0.0298, 0.108], [0.0298, 0.1175], [0.0285, 0.1175]], 'z', [0, ax]), G.RUBBER, 0.0006);
  p.add(lathe([[0, -0.075], [0.0195, -0.075], [0.0205, -0.1], [0.023, -0.118], [0.0215, -0.1205], [0.0165, -0.118], [0.0155, -0.1], [0, -0.1]], 'z', [0, ax]), G.RUBBER, 0.001);
  for (let i = 0; i < 3; i++) p.add(box([-0.012 + i * 0.012, ax + 0.0298, 0.02 - i * 0.001], [0.004, 0.0018, 0.006], 0.0012), G.RUBBER, 0.001);
  p.add(cyl('y', [0, ax + 0.034, -0.03], 0.011, 0.005, 0.001), G.KNURL, 0.001);
  p.add(lathe([[0, -0.042], [0.011, -0.042], [0.0118, 0.04], [0.0118, 0.043], [0, 0.043]], 'z', [0.037, ax - 0.006]), G.ANOD, 0.0015);
  p.add(box([0.03, ax - 0.012, -0.0], [0.006, 0.007, 0.015], 0.002), G.ANOD, 0.002);
  return p;
}

function m4Peq() {
  const p = new Part('peq', { cell: 0.00022, tris: 9000 });
  const cz = 0.31, cy = 0.049;
  p.add(box([0, cy, cz], [0.0148, 0.0118, 0.0372], 0.0045), G.FDE);
  p.add(box([0, cy - 0.0102, cz], [0.0152, 0.0028, 0.034], 0.0014), G.FDE, 0.002);
  p.add(cyl('z', [-0.0118, cy - 0.003, cz + 0.019], 0.0088, 0.017, 0.0025), G.FDE, 0.003);
  p.add(cyl('z', [-0.0118, cy - 0.003, cz + 0.0375], 0.0094, 0.0028, 0.0012), G.KNURL, 0.0008);
  p.sub(cyl('z', [0.0065, cy + 0.003, cz + 0.0375], 0.0052, 0.0008, 0.0003), 0.0006);
  p.sub(cyl('z', [0.0065, cy - 0.0065, cz + 0.0375], 0.0034, 0.0006, 0.0003), 0.0005);
  for (const x of [-0.006, 0.006]) p.add(cyl('y', [x, cy + 0.0126, cz - 0.012], 0.0038, 0.0022, 0.0008), G.KNURL, 0.001);
  p.add(cyl('y', [0, cy + 0.0125, cz - 0.026], 0.0062, 0.003, 0.001), G.FDE, 0.0015);
  for (let i = 0; i < 12; i++) { const a = i / 12 * 2 * PI; p.sub(box([cos(a) * 0.0063, cy + 0.0145, cz - 0.026 + sin(a) * 0.0063], [0.0007, 0.003, 0.001], 0.0002, [0, a, 0]), 0.0002); }
  for (const x of [-0.0062, 0.0062]) p.add(box([x, cy + 0.0122, cz + 0.012], [0.0034, 0.0014, 0.0045], 0.0012), G.RUBBER, 0.0012);
  p.add(box([0, cy - 0.0158, cz - 0.006], [0.0118, 0.004, 0.022], 0.0012), G.ANOD, 0.002);
  p.add(cyl('x', [-0.0148, cy - 0.0158, cz - 0.006], 0.0058, 0.003, 0.0012), G.KNURL, 0.0015);
  return p;
}

function m4Light() {
  // weapon light: tail cap, body, flared head with a knurled bezel, offset mount
  const p = new Part('light', { cell: 0.00022, tris: 9000 });
  const lp = [[0, 0.24], [0.0092, 0.24], [0.0108, 0.2425], [0.011, 0.257], [0.0101, 0.2595], [0.0101, 0.334], [0.0112, 0.339], [0.0134, 0.358], [0.0138, 0.381],
    [0.0141, 0.3815], [0.0141, 0.3945], [0.0138, 0.3955], [0.0126, 0.3962], [0.0114, 0.3945], [0, 0.3945]];
  p.add(lathe(lp, 'z', [0.034, 0.004]), G.ANOD);
  for (let i = 0; i < 20; i++) { const a = i / 20 * 2 * PI; p.sub(rotate(box([0.034, 0.004 + 0.0141, 0.388], [0.0007, 0.0006, 0.006], 0.0002), [0, 0, a], [0.034, 0.004, 0.388]), 0.0002); }
  for (let i = 0; i < 16; i++) { const a = i / 16 * 2 * PI; p.sub(rotate(box([0.034, 0.004 + 0.011, 0.2485], [0.0008, 0.0005, 0.006], 0.0002), [0, 0, a], [0.034, 0.004, 0.2485]), 0.0002); }
  p.add(box([0.0275, 0.004, 0.3], [0.0055, 0.0068, 0.016], 0.0015), G.ANOD, 0.002);
  screw(p, 'x', [0.0322, -0.0035, 0.3], 0.0022, G.STEEL, 0.0012);
  return p;
}

function m4Buis() {
  // folded polymer flip-up sights on the rail
  const p = new Part('buis', { cell: 0.00024, tris: 8000 });
  for (const [f0, f1] of [[-0.1, -0.069], [0.366, 0.397]]) {
    const prof = fillet([[f0, 0.029], [f1, 0.029], [f1, 0.0335], [f1 - 0.004, 0.0375], [f0 + 0.004, 0.0375], [f0, 0.0335]], 0.0018, 3);
    p.add(extrudeX(prof, -0.0105, 0.0105, 0.0012), G.POLY);
    for (let i = 0; i < 5; i++) p.sub(box([0, 0.0375, f0 + 0.008 + i * 0.0035], [0.008, 0.0005, 0.0006], 0.0002), 0.0002);
    screw(p, 'x', [0.0108, 0.0315, (f0 + f1) / 2], 0.0024, G.STEEL, 0.001);
  }
  return p;
}

function m4SlingSwivel() {
  const p = new Part('swivel', { cell: 0.0002, tris: 3000 });
  p.add(cyl('x', [-0.0262, -0.002, 0.382], 0.0042, 0.0022, 0.0006), G.STEEL);
  p.add(cyl('x', [-0.0292, -0.002, 0.382], 0.0024, 0.0016, 0.0004), G.STEEL, 0.0006);
  const ring = { fn: (x, y, z) => Math.hypot(Math.hypot(y + 0.002 + 0.012, z + 0.382) - 0.009, x + 0.0305) - 0.0016, bb: [-0.034, -0.026, -0.395, -0.028, 0.0, -0.369] };
  p.add(ring, G.STEEL, 0.001);
  return p;
}

function m4() {
  return [m4Upper(), m4BCG(), m4DustCover(), m4ChargingHandle(), m4Lower(), m4Trigger(), m4Grip(), m4BufferTube(), m4Stock(), m4Handguard(), m4Barrel(),
    m4Suppressor(), m4Pmag(), m4Exps3(), m4NvScope(), m4Peq(), m4Light(), m4Buis(), m4SlingSwivel()];
}
m4.lodOptic = 'opt:holo';
m4.lodTris = 7000;

// =====================================================================
// Glock 17 (Gen 5 style): nitrided slide with front and rear serrations,
// polymer frame with accessory rail, textured grip and flared magwell.
// =====================================================================
function glockSlide() {
  const p = new Part('slide', { anim: 'slide', cell: 0.00022, tris: 26000 });
  const side = fillet([[-0.078, -0.012], [0.1045, -0.012], [0.108, -0.008], [0.108, 0.0135], [0.1055, 0.018], [-0.076, 0.018], [-0.078, 0.015]], [0.0008, 0.003, 0.0025, 0.002, 0.0015, 0.0015, 0.0012], 4);
  const front = fillet([[-0.01275, -0.012], [0.01275, -0.012], [0.01275, 0.0098], [0.0076, 0.018], [-0.0076, 0.018], [-0.01275, 0.0098]], [0.0006, 0.0006, 0.0018, 0.0012, 0.0012, 0.0018], 4);
  p.add(intersect(extrudeX(side, -0.01275, 0.01275, 0.0007), extrudeZ(front, -0.079, 0.109, 0.0007), 0.0005), G.STEEL);
  // front and rear cocking serrations
  for (const [f0, n] of [[0.071, 7], [-0.0735, 8]]) for (let i = 0; i < n; i++) for (const sx of [-1, 1]) {
    p.sub(box([sx * 0.01275, 0.0008, f0 + i * 0.0038], [0.0007, 0.0092, 0.0009], 0.0003), 0.0003);
  }
  // ejection port with the barrel hood inside, extractor on the right
  p.sub(box([0.0045, 0.018, 0.0195], [0.0095, 0.0068, 0.0185], 0.0009), 0.0004);
  p.add(box([0.0, 0.0142, 0.0195], [0.0062, 0.0035, 0.0182], 0.0008), G.GRAY, 0.0004);
  p.add(box([0.0128, 0.0035, 0.009], [0.0005, 0.0032, 0.0115], 0.0005), G.STEEL, 0.0004);
  // muzzle: slide front bore and the barrel crown
  p.sub(cyl('z', [0, 0.0, 0.108], 0.0062, 0.004, 0.0006), 0.0004);
  p.add(lathe([[0.0045, 0.1], [0.006, 0.1], [0.006, 0.1062], [0.0052, 0.1068], [0.0045, 0.1062]], 'z', [0, 0]), G.GRAY, 0.0003);
  // sights: front post with a white dot, rear U-notch with a white outline
  p.add(box([0, 0.0205, 0.1], [0.00175, 0.0028, 0.0022], 0.0004), G.STEEL, 0.0006);
  p.paint(cyl('z', [0, 0.0215, 0.098], 0.0011, 0.0008, 0), G.WHITE);
  const rear = fillet([[-0.009, 0.0175], [0.009, 0.0175], [0.0085, 0.0238], [0.002, 0.0238], [0.002, 0.0208], [-0.002, 0.0208], [-0.002, 0.0238], [-0.0085, 0.0238]], [0, 0, 0.0008, 0.0004, 0.0003, 0.0003, 0.0004, 0.0008], 2);
  p.add(extrudeZ(rear, -0.0685, -0.0615, 0.0004), G.STEEL, 0.0005);
  p.paint(box([0, 0.022, -0.0685], [0.0036, 0.0022, 0.0006], 0.0004), G.WHITE);
  p.sub(box([0, 0.022, -0.069], [0.0026, 0.0016, 0.002], 0.0003), 0.0002);
  // slide cover plate on the rear face
  p.sub(box([0, 0.002, -0.078], [0.0072, 0.0082, 0.0003], 0.0012), 0.0002);
  return p;
}

function glockFrame() {
  const p = new Part('frame', { cell: 0.00024, tris: 30000 });
  // dust cover and receiver area under the slide
  const top = fillet([[-0.074, -0.0118], [0.104, -0.0118], [0.104, -0.0265], [0.036, -0.0285], [0.03, -0.031], [-0.036, -0.031], [-0.06, -0.0295], [-0.07, -0.022]], [0.001, 0.001, 0.002, 0.003, 0.003, 0.004, 0.006, 0.004], 4);
  p.add(extrudeX(top, -0.0108, 0.0108, 0.0012), G.POLY);
  // accessory rail with one cross slot
  p.add(extrudeZ(fillet([[-0.0108, -0.0255], [0.0108, -0.0255], [0.0108, -0.028], [0.0086, -0.0312], [-0.0086, -0.0312], [-0.0108, -0.028]], 0.0005, 2), 0.05, 0.103, 0.0006), G.POLY, 0.0015);
  p.sub(box([0, -0.0312, 0.088], [0.012, 0.0025, 0.0022], 0.0004), 0.0003);
  // squared-front trigger guard with the undercut
  const tgO = fillet([[0.037, -0.028], [0.036, -0.047], [0.029, -0.0575], [-0.019, -0.0585], [-0.026, -0.052], [-0.03, -0.03]], [0.002, 0.004, 0.005, 0.005, 0.004, 0.002], 4);
  const tgI = fillet([[0.031, -0.031], [0.031, -0.046], [0.026, -0.0535], [-0.015, -0.0545], [-0.02, -0.049], [-0.022, -0.031]], [0.002, 0.003, 0.004, 0.004, 0.003, 0.002], 4);
  p.add(extrudeX([tgO, tgI], -0.0072, 0.0072, 0.0016), G.POLY, 0.002);
  // grip (22 degree angle) with textured panels and a flared magwell
  const grip = fillet([[-0.028, -0.0292], [-0.062, -0.0282], [-0.0735, -0.034], [-0.0745, -0.044], [-0.0915, -0.1175], [-0.093, -0.124], [-0.046, -0.124], [-0.043, -0.117], [-0.0335, -0.074], [-0.0255, -0.048]],
    [0.004, 0.004, 0.004, 0.012, 0.006, 0.003, 0.003, 0.012, 0.02, 0.006], 5);
  const gripFront = fillet([[-0.0145, -0.13], [0.0145, -0.13], [0.0128, -0.06], [0.0108, -0.028], [-0.0108, -0.028], [-0.0128, -0.06]], [0.005, 0.005, 0.004, 0.001, 0.001, 0.004], 4);
  p.add(intersect(extrudeX(grip, -0.0158, 0.0158, 0.0042), extrudeZ(gripFront, -0.1, -0.02, 0.003), 0.003), G.POLY, 0.004);
  for (const sx of [-1, 1]) p.paint(rotate(box([sx * 0.0128, -0.084, -0.0565], [0.004, 0.026, 0.016], 0.004), [-0.38, 0, 0], [sx * 0.0128, -0.084, -0.0565]), G.POLYTEX);
  p.paint(rotate(box([0, -0.086, -0.0395], [0.009, 0.024, 0.004], 0.003), [-0.38, 0, 0], [0, -0.086, -0.0395]), G.POLYTEX);
  p.paint(rotate(box([0, -0.083, -0.078], [0.009, 0.025, 0.004], 0.003), [-0.38, 0, 0], [0, -0.083, -0.078]), G.POLYTEX);
  p.sub(rotate(box([0, -0.12, -0.069], [0.0112, 0.012, 0.0205], 0.004), [-0.38, 0, 0], [0, -0.12, -0.069]), 0.002); // magwell mouth
  // slide stop (left), takedown lever tabs, magazine catch, frame pins
  p.add(extrudeX(fillet([[-0.004, -0.0142], [0.014, -0.0142], [0.016, -0.017], [0.0095, -0.0195], [-0.004, -0.0182]], 0.001, 3), -0.0122, -0.0106, 0.0004), G.STEEL, 0.0004);
  for (const sx of [-1, 1]) p.add(box([sx * 0.011, -0.0172, 0.022], [0.0011, 0.0014, 0.0038], 0.0005), G.STEEL, 0.0004);
  p.add(box([-0.0112, -0.036, -0.029], [0.0012, 0.0034, 0.0042], 0.0011), G.POLY, 0.0006);
  for (const [f, y] of [[0.02, -0.0232], [-0.018, -0.0215], [-0.047, -0.0228]]) for (const sx of [-1, 1]) p.add(cyl('x', [sx * 0.0106, y, f], 0.0016, 0.0005, 0.0002), G.STEEL, 0.0002);
  return p;
}

function glockTrigger() {
  const p = new Part('trigger', { cell: 0.00018, tris: 2500 });
  p.add(extrudeX(fillet([[0.0085, -0.0305], [0.0035, -0.0305], [0.0015, -0.038], [-0.002, -0.0452], [0.0015, -0.0462], [0.0055, -0.0405], [0.008, -0.034]], [0, 0, 0.004, 0.0015, 0.0015, 0.004, 0.002], 3), -0.003, 0.003, 0.0008), G.POLY);
  p.add(extrudeX(fillet([[0.0035, -0.032], [0.0015, -0.0385], [-0.0005, -0.0435], [0.0012, -0.044], [0.0035, -0.038]], 0.0006, 2), -0.0009, 0.0009, 0.0003), G.BLACK, 0.0002);
  return p;
}

function glockMag() {
  const p = new Part('mag', { anim: 'mag', cell: 0.00024, tris: 5000 });
  p.add(rotate(box([0, -0.072, -0.061], [0.0107, 0.05, 0.0165], 0.0022), [-0.38, 0, 0], [0, -0.072, -0.061]), G.STEEL);
  p.add(rotate(box([0, -0.1255, -0.0695], [0.0128, 0.0042, 0.0215], 0.0022), [-0.38, 0, 0], [0, -0.1255, -0.0695]), G.POLY, 0.002);
  p.sub(rotate(box([0, -0.1302, -0.0695], [0.006, 0.0008, 0.0012], 0.0003), [-0.38, 0, 0], [0, -0.1302, -0.0695]), 0.0002);
  return p;
}

function glock() { return [glockSlide(), glockFrame(), glockTrigger(), glockMag()]; }
glock.lodTris = 3000;

// =====================================================================
// M1014 (Benelli M4 style): aluminium receiver with a rail and ghost-ring
// sight, twin-piston gas system under a polymer forend, magazine tube,
// telescoping stock with pistol grip, side saddle with 12 gauge shells.
// =====================================================================
function m1014Receiver() {
  const p = new Part('receiver', { cell: 0.0003, tris: 30000 });
  const side = fillet([[-0.14, -0.0335], [0.12, -0.0335], [0.121, 0.012], [0.113, 0.022], [0.09, 0.0255], [-0.125, 0.0255], [-0.14, 0.012]], [0.002, 0.002, 0.006, 0.008, 0.006, 0.012, 0.004], 5);
  const front = fillet([[-0.018, -0.0335], [0.018, -0.0335], [0.018, 0.012], [0.0135, 0.0255], [-0.0135, 0.0255], [-0.018, 0.012]], [0.003, 0.003, 0.004, 0.004, 0.004, 0.004], 4);
  p.add(intersect(extrudeX(side, -0.018, 0.018, 0.0012), extrudeZ(front, -0.141, 0.122, 0.001), 0.001), G.ANOD);
  // side flutes (the M4's lightening grooves) and the ejection port
  for (const sx of [-1, 1]) p.sub(slot([sx * 0.018, -0.012, -0.05], FWD, [sx, 0, 0], 0.11, 0.009, 0.0012, 0.01), 0.0008);
  p.sub(box([0.018, 0.005, 0.03], [0.004, 0.0105, 0.033], 0.0012), 0.0006);
  // bolt visible in the port (bright), loading port below with the shell lifter
  p.add(box([0.0125, 0.005, 0.03], [0.002, 0.009, 0.03], 0.0008), G.BRIGHT, 0.0003);
  p.sub(box([0, -0.0335, 0.005], [0.0115, 0.004, 0.046], 0.002), 0.001);
  p.add(box([0, -0.03, 0.005], [0.0105, 0.0012, 0.042], 0.001), G.STEEL, 0.0006);
  // bolt release button (right), cross-bolt safety in front of the trigger
  p.add(cyl('x', [0.0185, -0.018, -0.02], 0.0045, 0.0012, 0.0006), G.STEEL, 0.0005);
  p.add(cyl('x', [0, -0.0395, -0.034], 0.004, 0.0205, 0.0008), G.STEEL, 0.0005);
  // rail on top with the ghost-ring rear sight and its protective ears
  picatinny(p, -0.125, 0.2, 0.02, G.ANOD, -0.121);
  p.add(extrudeX(fillet([[-0.118, 0.029], [-0.082, 0.029], [-0.085, 0.036], [-0.095, 0.062], [-0.103, 0.062], [-0.112, 0.036]], [0, 0, 0.004, 0.002, 0.002, 0.004], 3), -0.0142, 0.0142, 0.0012), G.ANOD, 0.001);
  p.sub(extrudeX(fillet([[-0.078, 0.039], [-0.125, 0.039], [-0.125, 0.07], [-0.078, 0.07]], 0.001), -0.0102, 0.0102, 0.0004), 0.0008); // space between the ears
  p.add(cyl('z', [0, 0.058, -0.1], 0.0072, 0.0028, 0.0008), G.STEEL, 0.001);
  p.sub(cyl('z', [0, 0.058, -0.1], 0.0034, 0.004, 0.0003), 0.0003);
  p.add(box([0, 0.0475, -0.1], [0.0015, 0.008, 0.0024], 0.0006), G.STEEL, 0.001);
  // trigger group: guard and trigger
  const tg = [fillet([[-0.03, -0.033], [-0.03, -0.055], [-0.036, -0.061], [-0.082, -0.061], [-0.088, -0.054], [-0.09, -0.033]], [0, 0.004, 0.004, 0.004, 0.004, 0]),
    fillet([[-0.034, -0.035], [-0.034, -0.053], [-0.038, -0.057], [-0.079, -0.057], [-0.084, -0.052], [-0.085, -0.035]], [0, 0.003, 0.003, 0.003, 0.003, 0])];
  p.add(extrudeX(tg, -0.0075, 0.0075, 0.0015), G.POLY, 0.002);
  p.add(extrudeX(fillet([[-0.046, -0.0335], [-0.041, -0.0335], [-0.043, -0.042], [-0.049, -0.05], [-0.055, -0.052], [-0.053, -0.046], [-0.049, -0.039]], [0, 0, 0.003, 0.003, 0.001, 0.003, 0.002], 3), -0.0028, 0.0028, 0.0008), G.STEEL, 0.0006);
  return p;
}

function m1014Handle() {
  const p = new Part('bolthandle', { anim: 'charge', cell: 0.00022, tris: 3000 });
  p.add(cyl('x', [0.0215, 0.005, 0.02], 0.0032, 0.004, 0.0005), G.STEEL);
  p.add(lathe([[0, 0.0235], [0.0052, 0.0235], [0.0058, 0.0255], [0.0058, 0.0325], [0.0045, 0.0342], [0, 0.0342]], 'x', [0.005, 0.02]), G.STEEL, 0.001);
  return p;
}

function m1014Barrel() {
  const p = new Part('barrel', { cell: 0.0003, tris: 24000 });
  p.add(lathe([[0.0082, 0.12], [0.0122, 0.12], [0.0118, 0.2], [0.0113, 0.594], [0.0105, 0.6], [0.0082, 0.6]], 'z', [0, 0.008]), G.STEEL);
  // magazine tube, barrel clamp / tube cap with a sling loop
  p.add(lathe([[0, 0.12], [0.0138, 0.12], [0.0138, 0.515], [0.0128, 0.52], [0, 0.52]], 'z', [0, -0.024]), G.ANOD, 0.001);
  p.add(intersect(extrudeZ([fillet([[-0.0155, -0.042], [0.0155, -0.042], [0.0155, 0.018], [0.009, 0.024], [-0.009, 0.024], [-0.0155, 0.018]], 0.004, 4)], 0.45, 0.472, 0.0015), box([0, -0.008, 0.461], [0.02, 0.04, 0.02], 0.002)), G.ANOD, 0.001);
  screw(p, 'x', [0.0158, -0.006, 0.461], 0.0026, G.STEEL, 0.001);
  p.add(lathe([[0, 0.515], [0.0122, 0.515], [0.0132, 0.52], [0.0132, 0.545], [0.012, 0.548], [0, 0.548]], 'z', [0, -0.024]), G.ANOD, 0.0008);
  for (let i = 0; i < 16; i++) { const a = i / 16 * 2 * PI; p.sub(rotate(box([0, -0.024 + 0.0133, 0.535], [0.0008, 0.0007, 0.009], 0.0002), [0, 0, a], [0, -0.024, 0.535]), 0.0002); }
  // front sight: blade inside protective ears on the barrel
  p.add(extrudeX(fillet([[0.565, 0.018], [0.595, 0.018], [0.593, 0.024], [0.58, 0.0275], [0.567, 0.024]], 0.002, 3), -0.0125, 0.0125, 0.0012), G.STEEL, 0.001);
  for (const sx of [-1, 1]) p.add(extrudeX(fillet([[0.574, 0.024], [0.592, 0.024], [0.59, 0.034], [0.585, 0.041], [0.579, 0.041], [0.576, 0.032]], 0.0015, 3), sx > 0 ? 0.0065 : -0.0095, sx > 0 ? 0.0095 : -0.0065, 0.0008), G.STEEL, 0.001);
  p.add(box([0, 0.033, 0.583], [0.0012, 0.0085, 0.004], 0.0005), G.STEEL, 0.0008);
  p.paint(cyl('z', [0, 0.04, 0.5795], 0.0009, 0.0008, 0), G.WHITE);
  // twin gas pistons between barrel and tube, visible at the forend front
  for (const sx of [-1, 1]) p.add(cyl('z', [sx * 0.0072, -0.009, 0.36], 0.0034, 0.024, 0.0006), G.STEEL, 0.0008);
  return p;
}

function m1014Forend() {
  const p = new Part('forend', { cell: 0.0003, tris: 16000 });
  const sect = fillet([[-0.0225, -0.05], [0.0225, -0.05], [0.0235, -0.012], [0.019, 0.004], [-0.019, 0.004], [-0.0235, -0.012]], [0.008, 0.008, 0.006, 0.004, 0.004, 0.006], 5);
  p.add(intersect(extrudeZ([sect], 0.122, 0.336, 0.004), extrudeX(fillet([[0.122, 0.004], [0.33, 0.004], [0.337, -0.012], [0.33, -0.05], [0.13, -0.05], [0.122, -0.038]], 0.004, 3), -0.03, 0.03, 0.002), 0.002), G.POLY);
  p.sub(box([0, 0.004, 0.23], [0.0135, 0.0065, 0.11], 0.003), 0.002); // barrel channel
  // ribbed grip panels
  for (const sx of [-1, 1]) for (let i = 0; i < 12; i++) p.sub(box([sx * 0.0232, -0.024, 0.165 + i * 0.0125], [0.0012, 0.018, 0.0024], 0.0008), 0.0006);
  for (const sx of [-1, 1]) p.paint(box([sx * 0.022, -0.024, 0.235], [0.004, 0.02, 0.08], 0.004), G.POLYTEX);
  return p;
}

function m1014Stock() {
  const p = new Part('stock', { cell: 0.0003, tris: 26000 });
  // pistol grip moulded with the stock tube housing
  const grip = fillet([[-0.1, -0.03], [-0.128, -0.03], [-0.152, -0.072], [-0.1665, -0.126], [-0.157, -0.1375], [-0.129, -0.134], [-0.117, -0.09], [-0.1, -0.052]],
    [0.004, 0.006, 0.02, 0.006, 0.004, 0.008, 0.02, 0.006], 5);
  p.add(extrudeX(grip, -0.0145, 0.0145, 0.0058), G.POLY);
  for (const sx of [-1, 1]) p.paint(rotate(box([sx * 0.0138, -0.09, -0.136], [0.004, 0.028, 0.014], 0.004), [-0.33, 0, 0], [sx * 0.0138, -0.09, -0.136]), G.POLYTEX);
  p.add(cyl('z', [0, 0.0, -0.235], 0.0149, 0.095, 0.0012), G.ANOD, 0.002);
  p.add(box([0, -0.0158, -0.24], [0.0036, 0.0022, 0.085], 0.0006), G.ANOD, 0.0012);
  // telescoping stock body with cheek rest and a rubber butt pad
  const side = fillet([[-0.235, 0.024], [-0.39, 0.028], [-0.398, 0.022], [-0.398, -0.084], [-0.388, -0.097], [-0.366, -0.095], [-0.3, -0.046], [-0.26, -0.032], [-0.235, -0.02]],
    [0.004, 0.008, 0.004, 0.004, 0.008, 0.006, 0.03, 0.01, 0.004], 5);
  const front = fillet([[-0.019, -0.1], [0.019, -0.1], [0.019, 0.0], [0.022, 0.012], [0.017, 0.029], [-0.017, 0.029], [-0.022, 0.012], [-0.019, 0.0]], [0.005, 0.005, 0.004, 0.006, 0.008, 0.008, 0.006, 0.004], 5);
  p.add(intersect(extrudeX(side, -0.025, 0.025, 0.003), extrudeZ(front, -0.4, -0.23, 0.003), 0.0025), G.POLY);
  p.sub(extrudeX(fillet([[-0.296, -0.016], [-0.372, -0.018], [-0.372, -0.062], [-0.35, -0.07], [-0.304, -0.036]], 0.005, 4), -0.03, 0.03, 0.002), 0.0015);
  p.add(extrudeX(fillet([[-0.397, 0.028], [-0.412, 0.028], [-0.412, -0.098], [-0.389, -0.098], [-0.397, -0.084]], 0.004, 4), -0.02, 0.02, 0.004), G.RUBBER, 0.001);
  for (let i = 0; i < 12; i++) p.sub(box([0, 0.02 - i * 0.01, -0.4125], [0.03, 0.0012, 0.0012], 0.0004), 0.0004);
  return p;
}

/** A 12 gauge shell standing along 'axis' at c: red ribbed hull and brass head. */
function shell(p, c, axis = 'y') {
  const [x, y, f] = c;
  if (axis === 'y') {
    p.add(cyl('y', [x, y + 0.012, f], 0.0101, 0.0275, 0.0012), G.SHELL, 0.0005);
    p.add(lathe([[0, -0.0225], [0.0107, -0.0225], [0.0107, -0.0215], [0.0102, -0.021], [0.0102, -0.008], [0, -0.008]].map(([r, a]) => [r, a + y]), 'y', [x, f]), G.BRASS, 0.0004);
  }
}

function m1014Saddle() {
  const p = new Part('saddle', { cell: 0.00026, tris: 14000 });
  p.add(box([-0.0212, 0.004, -0.02], [0.0022, 0.017, 0.047], 0.0012), G.ANOD);
  for (let i = 0; i < 5; i++) {
    const f = -0.058 + i * 0.019;
    shell(p, [-0.034, 0.0, f]);
    p.add(box([-0.024, 0.0, f], [0.0015, 0.013, 0.0072], 0.0008), G.RUBBER, 0.0012);
  }
  return p;
}

function m1014LooseShell() {
  const p = new Part('loose', { anim: 'loose', cell: 0.00022, tris: 2500, lod: false });
  shell(p, [0, 0, 0]);
  return p;
}

function m1014() { return [m1014Receiver(), m1014Handle(), m1014Barrel(), m1014Forend(), m1014Stock(), m1014Saddle(), m1014LooseShell()]; }
m1014.lodTris = 6000;

// =====================================================================
// Bolt-action precision rifle in a modern chassis: round action with an
// integral rail, fluted heavy barrel, ported brake, OD chassis with M-LOK
// forend and skeleton stock, folded bipod, 5-25x56 scope in rings.
// =====================================================================
const SY = 0.058; // scope axis above the bore

function sniperAction() {
  const p = new Part('action', { cell: 0.0003, tris: 22000 });
  p.add(lathe([[0, -0.121], [0.0172, -0.121], [0.018, -0.118], [0.018, 0.118], [0.0165, 0.121], [0, 0.121]], 'z', [0, 0]), G.GRAY);
  p.sub(box([0.018, 0.004, -0.04], [0.007, 0.0088, 0.03], 0.0015), 0.0008);   // ejection port
  p.sub(box([0.0, 0.017, -0.07], [0.0042, 0.006, 0.06], 0.0012), 0.0006);     // bolt raceway slot on top rear
  p.add(box([-0.0178, 0.0, -0.098], [0.0018, 0.004, 0.006], 0.0012), G.STEEL, 0.001); // bolt release
  picatinny(p, -0.121, 0.128, 0.012, G.GRAY, -0.117);
  // recoil lug and the barrel nut ring
  p.add(lathe([[0.0125, 0.118], [0.0168, 0.118], [0.0168, 0.132], [0.0125, 0.132]], 'z', [0, 0]), G.STEEL, 0.0006);
  for (let i = 0; i < 6; i++) { const a = i / 6 * 2 * PI; p.sub(rotate(box([0, 0.0168, 0.126], [0.0018, 0.0012, 0.006], 0.0003), [0, 0, a], [0, 0, 0.126]), 0.0003); }
  return p;
}

function sniperBolt() {
  const p = new Part('bolt', { anim: 'bolt', cell: 0.00024, tris: 9000 });
  p.add(cyl('z', [0, 0.0005, -0.1], 0.0092, 0.1, 0.0008), G.BRIGHT);
  for (let i = 0; i < 3; i++) p.sub(cyl('z', [Math.cos(i * 2.09) * 0.0092, Math.sin(i * 2.09) * 0.0092, -0.06], 0.0022, 0.05, 0.0003), 0.0004); // bolt flutes
  // shroud with the cocking indicator
  p.add(lathe([[0, -0.2], [0.0118, -0.2], [0.0124, -0.197], [0.0124, -0.123], [0.011, -0.121], [0, -0.121]], 'z', [0, 0.0005]), G.GRAY, 0.001);
  p.add(cyl('z', [0, 0.0005, -0.2035], 0.0045, 0.0035, 0.0006), G.SHELL, 0.0004);
  // bolt handle with a ribbed tactical knob
  p.add(capsule([0.008, 0.0, -0.14], [0.045, -0.004, -0.143], 0.0042, 0.0036), G.STEEL, 0.002);
  p.add(lathe([[0, 0.043], [0.0072, 0.043], [0.0092, 0.048], [0.0096, 0.058], [0.0085, 0.064], [0.0045, 0.066], [0, 0.066]], 'x', [-0.004, -0.143]), G.POLY, 0.0015);
  for (let i = 0; i < 10; i++) { const a = i / 10 * 2 * PI; p.sub(box([0.055, -0.004 + Math.cos(a) * 0.0095, -0.143 + Math.sin(a) * 0.0095], [0.006, 0.0008, 0.0008], 0.0002, [a, 0, 0]), 0.0002); }
  return p;
}

function sniperBarrel() {
  const p = new Part('barrel', { cell: 0.0003, tris: 22000 });
  p.add(lathe([[0.004, 0.132], [0.0148, 0.132], [0.0145, 0.2], [0.012, 0.63], [0.0116, 0.72], [0.004, 0.72]], 'z', [0, 0]), G.STEEL);
  for (let i = 0; i < 6; i++) { const a = i / 6 * 2 * PI; p.sub(rotate(slot([0, 0.0138, 0.41], FWD, UP, 0.4, 0.0042, 0.0012, 0.01), [0, 0, a], [0, 0, 0.41]), 0.0006); }
  // ported brake
  const brake = fillet([[-0.0155, -0.0132], [0.0155, -0.0132], [0.0155, 0.0132], [-0.0155, 0.0132]], 0.005, 4);
  p.add(extrudeZ([brake], 0.72, 0.81, 0.0016), G.GRAY, 0.001);
  for (let i = 0; i < 3; i++) p.sub(box([0, 0.0, 0.738 + i * 0.022], [0.02, 0.0085, 0.0062], 0.0015), 0.0008);
  p.sub(cyl('z', [0, 0, 0.81], 0.0045, 0.01, 0.0004), 0.0004);
  return p;
}

function sniperChassis() {
  const p = new Part('chassis', { cell: 0.00034, tris: 40000 });
  // centre section with the magwell and trigger guard
  const mid = fillet([[-0.135, -0.012], [0.08, -0.012], [0.082, -0.03], [0.075, -0.075], [-0.025, -0.075], [-0.032, -0.056], [-0.075, -0.056], [-0.13, -0.05], [-0.135, -0.03]], [0.002, 0.002, 0.004, 0.004, 0.004, 0.004, 0.006, 0.008, 0.004], 4);
  p.add(extrudeX(mid, -0.022, 0.022, 0.0025), G.OD);
  p.sub(box([0, -0.05, 0.025], [0.0165, 0.04, 0.046], 0.002), 0.001);
  const tgO = fillet([[-0.028, -0.056], [-0.028, -0.07], [-0.035, -0.078], [-0.074, -0.078], [-0.08, -0.07], [-0.08, -0.056]], 0.003, 3);
  const tgI = fillet([[-0.032, -0.058], [-0.032, -0.068], [-0.037, -0.074], [-0.071, -0.074], [-0.076, -0.068], [-0.076, -0.058]], 0.002, 3);
  p.add(extrudeX([tgO, tgI], -0.008, 0.008, 0.0015), G.OD, 0.002);
  p.add(extrudeX(fillet([[-0.05, -0.056], [-0.044, -0.056], [-0.047, -0.066], [-0.053, -0.071], [-0.056, -0.067], [-0.052, -0.062]], [0, 0, 0.002, 0.001, 0.001, 0.002], 3), -0.0028, 0.0028, 0.0008), G.STEEL, 0.0006);
  // forend tube with M-LOK slots
  const fe = fillet([[-0.026, -0.058], [0.026, -0.058], [0.026, -0.021], [0.021, -0.017], [-0.021, -0.017], [-0.026, -0.021]], [0.005, 0.005, 0.003, 0.002, 0.002, 0.003], 4);
  const feIn = fillet([[-0.0235, -0.0555], [0.0235, -0.0555], [0.0235, -0.0195], [-0.0235, -0.0195]], 0.003, 3);
  p.add(extrudeZ([fe, feIn], 0.078, 0.45, 0.0012), G.OD, 0.002);
  for (const sx of [-1, 1]) for (let f = 0.11; f < 0.43; f += 0.04) p.sub(slot([sx * 0.026, -0.036, f], FWD, [sx, 0, 0], 0.032, 0.0072, 0.004, 0.01), 0.0005);
  for (let f = 0.13; f < 0.42; f += 0.04) p.sub(slot([0, -0.058, f], FWD, [0, -1, 0], 0.032, 0.0072, 0.004, 0.01), 0.0005);
  // grip
  const grip = fillet([[-0.074, -0.052], [-0.112, -0.052], [-0.122, -0.08], [-0.129, -0.148], [-0.12, -0.158], [-0.091, -0.154], [-0.088, -0.12], [-0.081, -0.08]], [0.004, 0.006, 0.02, 0.006, 0.004, 0.006, 0.02, 0.006], 5);
  p.add(extrudeX(grip, -0.0142, 0.0142, 0.0058), G.POLY, 0.003);
  for (const sx of [-1, 1]) p.paint(rotate(box([sx * 0.0135, -0.105, -0.103], [0.004, 0.03, 0.014], 0.004), [-0.13, 0, 0], [sx * 0.0135, -0.105, -0.103]), G.POLYTEX);
  // folding-stock hinge and skeleton stock
  p.add(cyl('y', [0.018, -0.03, -0.14], 0.0065, 0.022, 0.0012), G.STEEL, 0.002);
  const st = [fillet([[-0.14, -0.012], [-0.2, 0.002], [-0.5, 0.004], [-0.518, -0.008], [-0.518, -0.122], [-0.46, -0.126], [-0.36, -0.062], [-0.2, -0.05], [-0.14, -0.05]], [0.003, 0.02, 0.006, 0.005, 0.006, 0.02, 0.04, 0.02, 0.003], 5),
    fillet([[-0.3, -0.013], [-0.445, -0.013], [-0.445, -0.07], [-0.36, -0.038]], [0.006, 0.006, 0.006, 0.012], 4)];
  p.add(extrudeX(st, -0.017, 0.017, 0.0025), G.OD, 0.002);
  // adjustable cheek riser on posts, butt pad with spacers
  p.add(extrudeX(fillet([[-0.28, 0.012], [-0.46, 0.012], [-0.465, 0.03], [-0.45, 0.034], [-0.3, 0.032], [-0.28, 0.022]], 0.004, 4), -0.016, 0.016, 0.004), G.POLY, 0.0015);
  for (const f of [-0.33, -0.42]) p.add(cyl('y', [0, 0.008, f], 0.004, 0.006, 0.0006), G.STEEL, 0.001);
  // length-of-pull spacers (one block with grooves between the plates) and the butt pad
  p.add(box([0, -0.056, -0.5225], [0.018, 0.069, 0.0055], 0.0012), G.POLY, 0.0008);
  for (const f of [-0.5205, -0.5245]) p.sub(lathe([[0.03, f - 0.0004], [0.05, f - 0.0004], [0.05, f + 0.0004], [0.03, f + 0.0004]], 'z', [0, -0.056]), 0.0002);
  p.add(box([0, -0.056, -0.5365], [0.019, 0.071, 0.009], 0.004), G.RUBBER, 0.001);
  return p;
}

function sniperMag() {
  const p = new Part('mag', { anim: 'mag', cell: 0.00026, tris: 6000 });
  p.add(box([0, -0.085, 0.025], [0.0158, 0.05, 0.044], 0.0018), G.STEEL);
  for (let i = 0; i < 3; i++) for (const sx of [-1, 1]) p.sub(box([sx * 0.0158, -0.07 - i * 0.015, 0.025], [0.0005, 0.0025, 0.036], 0.0004), 0.0004);
  p.add(box([0, -0.137, 0.025], [0.0175, 0.0045, 0.047], 0.0022), G.POLY, 0.002);
  return p;
}

function sniperBipod() {
  const p = new Part('bipod', { cell: 0.00026, tris: 9000 });
  p.add(box([0, -0.064, 0.418], [0.016, 0.006, 0.012], 0.002), G.ANOD);
  for (const sx of [-1, 1]) {
    p.add(capsule([sx * 0.011, -0.066, 0.41], [sx * 0.012, -0.068, 0.22], 0.0048, 0.0042), G.ANOD, 0.002);
    p.add(capsule([sx * 0.012, -0.068, 0.26], [sx * 0.012, -0.068, 0.2], 0.0036), G.STEEL, 0.001);
    p.add(sphere([sx * 0.012, -0.069, 0.196], 0.0058), G.RUBBER, 0.001);
  }
  return p;
}

function sniperScope() {
  const p = new Part('scope', { cell: 0.00026, tris: 30000 });
  const prof = [[0, -0.2125], [0.0178, -0.2125], [0.0212, -0.2085], [0.0215, -0.172], [0.0205, -0.165], [0.019, -0.158], [0.0188, -0.152], [0.017, -0.148], [0.017, 0.162], [0.0182, 0.168], [0.0275, 0.2], [0.0292, 0.21],
    [0.0292, 0.276], [0.0286, 0.279], [0.0272, 0.279], [0.0272, 0.274], [0, 0.274]];
  p.add(lathe(prof, 'z', [0, SY]), G.ANOD);
  // eyepiece rubber guard, diopter and magnification rings (knurled, with a throw lever)
  p.add(lathe([[0.0188, -0.2155], [0.0216, -0.2155], [0.0218, -0.2085], [0.0188, -0.2085]], 'z', [0, SY]), G.RUBBER, 0.0006);
  p.add(lathe([[0.0195, -0.2], [0.0222, -0.2], [0.0222, -0.186], [0.0195, -0.186]], 'z', [0, SY]), G.KNURL, 0.0005);
  p.add(lathe([[0.018, -0.158], [0.0205, -0.158], [0.0205, -0.144], [0.018, -0.144]], 'z', [0, SY]), G.KNURL, 0.0005);
  p.add(box([0.0165, SY + 0.012, -0.151], [0.0045, 0.0028, 0.0035], 0.0012, [0, 0, -0.6]), G.ANOD, 0.0012);
  // turret saddle with elevation (top), windage (right) and parallax (left) turrets
  p.add(intersect(cyl('z', [0, SY, 0.0], 0.0215, 0.028, 0.004), box([0, SY, 0.0], [0.024, 0.024, 0.028], 0.004), 0.003), G.ANOD, 0.004);
  p.add(lathe([[0, 0.0], [0.0148, 0.0], [0.0148, 0.014], [0.0152, 0.0145], [0.0152, 0.0285], [0.0142, 0.03], [0, 0.03]].map(([r, a]) => [r, a + SY + 0.016]), 'y', [0, 0.0]), G.KNURL, 0.001);
  p.add(lathe([[0, 0.0], [0.012, 0.0], [0.012, 0.022], [0.0112, 0.0235], [0, 0.0235]].map(([r, a]) => [r, a + 0.019]), 'x', [SY, 0.0]), G.KNURL, 0.001);
  p.add(lathe([[0, 0.0], [0.012, 0.0], [0.012, 0.02], [0.0112, 0.0215], [0, 0.0215]].map(([r, a]) => [r, -a - 0.019]), 'x', [SY, 0.0]), G.KNURL, 0.001);
  for (let i = 0; i < 20; i++) { const a = i / 20 * 2 * PI; p.paint(box([Math.sin(a) * 0.0152, SY + 0.043, Math.cos(a) * 0.0152], [0.0005, 0.0032, 0.0005], 0.0001, [0, a, 0]), G.WHITE); }
  p.paint(box([0, SY + 0.042, 0.0152], [0.0006, 0.004, 0.0008], 0.0001), G.WHITE);
  // rings on the rail with cap screws
  for (const f of [-0.07, 0.07]) {
    p.add(intersect(lathe([[0.017, f - 0.009], [0.0215, f - 0.009], [0.0215, f + 0.009], [0.017, f + 0.009]], 'z', [0, SY]), box([0, SY, f], [0.03, 0.03, 0.01]), 0.0), G.ANOD, 0.0012);
    p.add(extrudeX(fillet([[f - 0.009, 0.029], [f + 0.009, 0.029], [f + 0.009, SY - 0.012], [f - 0.009, SY - 0.012]], 0.002, 3), -0.0125, 0.0125, 0.0012), G.ANOD, 0.003);
    for (const sx of [-1, 1]) for (const df of [-0.0045, 0.0045]) screw(p, 'x', [sx * 0.0212, SY + 0.004, f + df], 0.0017, G.STEEL, 0.001);
    screw(p, 'x', [0.0128, 0.034, f], 0.0028, G.STEEL, 0.0014);
  }
  return p;
}

function sniper() { return [sniperAction(), sniperBolt(), sniperBarrel(), sniperChassis(), sniperMag(), sniperBipod(), sniperScope()]; }
sniper.lodTris = 7000;

export const GUNS = { m4, glock, m1014, sniper };
void [extrudeY, sphere, capsule, mirrorX, circle, arc, RIGHT];
