// Soldiers' bodies: real rigged, textured characters (tools/build-people.mjs;
// credits in assets/people/CREDITS.md), posed every frame from the procedural
// rig in soldier.js. The rig stays the source of the animation (walking,
// crouching, aiming, reloading, throwing, flinching, falling); every real bone
// takes the rotation of the rig segment it belongs to, the arms reach the
// rifle with their own two-bone IK, and the hands close around it.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { MeshoptDecoder } from '../vendor/meshopt/meshopt_decoder.js';

export const PEOPLE_KITS = ['olive', 'tan', 'black', 'heavy'];
const TEMPLATES = {};

export async function loadPeople(renderer, hq = false) {
  await MeshoptDecoder.ready;
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  await Promise.all(PEOPLE_KITS.map(async (kit) => {
    try {
      let gltf = hq ? await loader.loadAsync(`assets/people/${kit}_hq.glb`).catch(() => null) : null;
      if (!gltf) gltf = await loader.loadAsync(`assets/people/${kit}.glb`);
      TEMPLATES[kit] = new BodyTemplate(gltf, aniso);
    } catch (e) {
      console.warn(`${kit}: real soldier unavailable, using the sculpted one`, e);
    }
  }));
}
/** The loaded body for a kit, or null (the sculpted soldier is used). */
export function bodyTemplate(kit) { return TEMPLATES[kit] || null; }

const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1), DOWN = new THREE.Vector3(0, -1, 0);
const I = new THREE.Quaternion();
const D = Math.PI / 180;

/** Rotation taking frame (a1, a2) onto frame (b1, b2): both orthonormalised, third axis a1 x a2. */
const _ma = new THREE.Matrix4(), _mb = new THREE.Matrix4(), _b1 = new THREE.Vector3(), _b2 = new THREE.Vector3(), _b3 = new THREE.Vector3();
function frameRotation(a1, a2, b1, b2, out) {
  const basis = (x, y, m) => {
    _b1.copy(x).normalize();
    _b2.copy(y).addScaledVector(_b1, -y.dot(_b1)).normalize();
    _b3.crossVectors(_b1, _b2);
    return m.makeBasis(_b1, _b2, _b3);
  };
  basis(a1, a2, _ma); basis(b1, b2, _mb);
  return out.setFromRotationMatrix(_mb.multiply(_ma.transpose()));
}

// how each hand closes: finger curl per joint (degrees) for [thumb, index, other fingers]
const CURL = {
  grip: { thumb: [18, 16, 10], index: [14, 20, 12], other: [78, 92, 55] },   // firing hand, trigger finger along the frame
  fore: { thumb: [12, 10, 8], index: [62, 72, 42], other: [66, 78, 46] },    // support hand under the handguard
  limp: { thumb: [6, 6, 4], index: [22, 28, 16], other: [28, 34, 20] },
};
const FINGERS = { Thumb: 'thumb', Index: 'index', Middle: 'other', Ring: 'other', Pinky: 'other' };

class BodyTemplate {
  constructor(gltf, aniso) {
    const scene = this.scene = gltf.scene;
    scene.updateMatrixWorld(true);
    const bones = {};
    this.order = []; this.parent = [];
    scene.traverse((o) => {
      if (o.isBone) { bones[o.name] = o; this.parent.push(this.order.indexOf(o.parent)); this.order.push(o); }
      if (o.isMesh) {
        for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap']) if (o.material[k]) o.material[k].anisotropy = aniso;
        // exported as blended though opaque (only eyes and lenses are see-through): drawn as solid, with cut-outs
        const m = o.material;
        if (m.transparent && m.opacity >= 0.99) { m.transparent = false; m.depthWrite = true; m.alphaTest = 0.5; }
      }
    });
    this.names = this.order.map((b) => b.name);
    this.index = Object.fromEntries(this.names.map((n, i) => [n, i]));
    const has = (n) => n in bones;
    const wp = (n) => bones[n].getWorldPosition(new THREE.Vector3());
    const wq = (n) => bones[n].getWorldQuaternion(new THREE.Quaternion());
    this.bindQ = this.order.map((b) => b.quaternion.clone());
    this.bindP = this.order.map((b) => b.position.clone());
    this.worldQ = this.order.map((b) => b.getWorldQuaternion(new THREE.Quaternion()));
    // the rig in soldier.js takes this body's proportions
    const hips = wp('Hips'), spine = wp('Spine'), neck = wp('Neck'), head = wp('Head');
    this.rig = {
      hipY: hips.y,
      spine: spine.clone().sub(hips), neck: neck.clone().sub(spine), head: head.clone().sub(neck),
      shoulder: { R: wp('RightArm').sub(spine), L: wp('LeftArm').sub(spine) },
      upper: wp('LeftArm').distanceTo(wp('LeftForeArm')), fore: wp('LeftForeArm').distanceTo(wp('LeftHand')),
      thigh: { R: wp('RightUpLeg').sub(hips), L: wp('LeftUpLeg').sub(hips) },
      thighLen: wp('LeftUpLeg').distanceTo(wp('LeftLeg')), shinLen: wp('LeftLeg').distanceTo(wp('LeftFoot')),
      headTop: has('HeadTop_End') ? wp('HeadTop_End').y - head.y : 0.22,
    };
    // Bones that follow one rig segment. `C` is the bone's rotation when that segment is at rest (identity):
    // the torso keeps its modelled posture; limbs are turned to hang straight down, facing forward.
    const straightDown = (n, child) => frameRotation(wp(child).sub(wp(n)), Z, DOWN, Z, new THREE.Quaternion()).multiply(wq(n));
    const role = this.role = new Array(this.order.length).fill(null);
    const set = (n, seg, C, k = 1) => { if (has(n)) role[this.index[n]] = { seg, C, k }; };
    set('Hips', 'hips', wq('Hips'));
    // the rig bends its one spine segment; the real spine shares the bend over its three joints
    const spines = ['Spine', 'Spine1', 'Spine2'].filter(has);
    spines.forEach((n, i) => set(n, 'spine', wq(n), (i + 1) / spines.length));
    set('Neck', 'neck', wq('Neck'));
    set('Head', 'head', wq('Head'));
    for (const [s, side] of [['R', 'Right'], ['L', 'Left']]) {
      set(side + 'UpLeg', 'th' + s, straightDown(side + 'UpLeg', side + 'Leg'));
      set(side + 'Leg', 'sh' + s, straightDown(side + 'Leg', side + 'Foot'));
    }
    // arms: IK, or (when limp) the rig segments' rotations
    this.arm = {};
    for (const [s, side] of [['R', 'Right'], ['L', 'Left']]) {
      const S = wp(side + 'Arm'), E = wp(side + 'ForeArm'), W = wp(side + 'Hand');
      const I1 = wp(side + 'HandIndex1'), M1 = has(side + 'HandMiddle1') ? wp(side + 'HandMiddle1') : I1;
      // hand frame: forward (wrist to knuckles) and palm normal (out of the palm). Some bodies have
      // no ring or little finger bones (or only an index for all four): then across the knuckles is
      // index to middle finger, or away from the thumb
      const F = M1.clone().sub(W).normalize();
      const across = has(side + 'HandPinky1') ? wp(side + 'HandPinky1').sub(I1)
        : has(side + 'HandMiddle1') ? M1.clone().sub(I1) : W.clone().sub(wp(side + 'HandThumb1'));
      across.addScaledVector(F, -across.dot(F)).normalize();
      const N = s === 'R' ? new THREE.Vector3().crossVectors(F, across) : new THREE.Vector3().crossVectors(across, F);
      const palm = W.clone().lerp(M1, 0.75).addScaledVector(N, 0.014);
      const u = E.clone().sub(S).normalize(), f = W.clone().sub(E).normalize();
      // elbow hinge: from the modelled bend, or for a straight arm, flexing forward
      const hinge = new THREE.Vector3().crossVectors(u, f);
      if (hinge.length() < 0.1) hinge.crossVectors(u, Z.clone().addScaledVector(u, -Z.dot(u)));
      hinge.normalize();
      const i = (n) => this.index[side + n];
      this.arm[s] = {
        arm: i('Arm'), fore: i('ForeArm'), hand: i('Hand'),
        a: S.distanceTo(E), b: E.distanceTo(W),
        up: [u, hinge], fo: [f, hinge.clone()],
        F, N, palmToWrist: W.clone().sub(palm),
        foreAxis: this.bindP[i('Hand')].clone().normalize(),
        handRel: this.worldQ[i('ForeArm')].clone().invert().multiply(this.worldQ[i('Hand')]),
        limp: { up: straightDown(side + 'Arm', side + 'ForeArm'), fo: straightDown(side + 'ForeArm', side + 'Hand') },
        curls: {},
      };
      // finger poses, as local rotations (they only depend on the hand)
      for (const [hold, c] of Object.entries(CURL)) {
        const out = new Map();
        for (const [finger, kind] of Object.entries(FINGERS)) {
          const chain = [1, 2, 3].map((k) => bones[`${side}Hand${finger}${k}`]).filter(Boolean);
          const save = chain.map((b) => b.quaternion.clone());
          chain.forEach((b, k) => {
            b.updateMatrixWorld(true);
            const next = b.children.find((x) => x.isBone);
            if (!next) return;
            const dir = next.getWorldPosition(new THREE.Vector3()).sub(b.getWorldPosition(new THREE.Vector3())).normalize();
            const axis = new THREE.Vector3().crossVectors(dir, N);
            if (kind === 'thumb') axis.addScaledVector(F, s === 'R' ? 0.5 : -0.5);
            axis.normalize();
            const qw = new THREE.Quaternion().setFromAxisAngle(axis, c[kind][k] * D).multiply(b.getWorldQuaternion(new THREE.Quaternion()));
            const qp = b.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
            b.quaternion.copy(qp.multiply(qw));
            b.updateMatrixWorld(true);
          });
          chain.forEach((b, k) => { out.set(this.index[b.name], b.quaternion.clone()); b.quaternion.copy(save[k]); });
          chain.forEach((b) => b.updateMatrixWorld(true));
        }
        this.arm[s].curls[hold] = out;
      }
    }
  }
}

// scratch
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const SPHERE = new THREE.Sphere(new THREE.Vector3(0, 0.8, 0), 2.1); // covers every pose, lying down included

export class Body {
  constructor(tpl) {
    this.tpl = tpl;
    this.root = cloneSkinned(tpl.scene);
    const byName = {};
    this.near = []; this.far = [];
    this.root.traverse((o) => {
      if (o.isBone) byName[o.name] = o;
      if (o.isSkinnedMesh) {
        (o.name.endsWith('_far') ? this.far : this.near).push(o);
        o.boundingSphere = SPHERE;
        o.castShadow = o.receiveShadow = true;
      }
    });
    for (const m of this.far) m.visible = false;
    this.bones = tpl.names.map((n) => byName[n]);
    const n = this.bones.length;
    this.wq = Array.from({ length: n }, () => new THREE.Quaternion());
    this.wp = Array.from({ length: n }, () => new THREE.Vector3());
    this.seg = {};
    this.hands = null;
    this.isFar = false;
  }

  get meshes() { return [...this.near, ...this.far]; }

  setFar(far) {
    if (far === this.isFar) return;
    this.isFar = far;
    for (const m of this.near) m.visible = !far;
    for (const m of this.far) m.visible = far;
  }

  _fingers(hold) {
    const key = hold.R + hold.L;
    if (this.hands === key) return;
    this.hands = key;
    for (const s of ['R', 'L']) for (const [i, q] of this.tpl.arm[s].curls[hold[s]]) this.bones[i].quaternion.copy(q);
  }

  /** Poses the skeleton from soldier `s` (its rig groups are up to date). Everything in the soldier root's space. */
  pose(s) {
    const tpl = this.tpl, seg = this.seg;
    // rig segments: rotation (and the hips' position) in root space
    const q = (k) => seg[k] || (seg[k] = new THREE.Quaternion());
    q('hips').copy(s.faller.quaternion).multiply(s.hips.quaternion);
    const hipsP = _v4.copy(s.hips.position).applyQuaternion(s.faller.quaternion).add(s.faller.position);
    q('spine').copy(seg.hips).multiply(s.spine.quaternion);
    q('neck').copy(seg.spine).multiply(s.neck.quaternion);
    q('head').copy(seg.neck).multiply(s.head.quaternion);
    for (const side of ['R', 'L']) {
      q('th' + side).copy(seg.hips).multiply(s.leg[side].th.quaternion);
      q('sh' + side).copy(seg['th' + side]).multiply(s.leg[side].sh.quaternion);
      q('up' + side).copy(seg.spine).multiply(s.arm[side].up.quaternion);
      q('fo' + side).copy(seg['up' + side]).multiply(s.arm[side].fo.quaternion);
    }
    const spineRel = s.spine.quaternion;
    this.spineP = (this.spineP || new THREE.Vector3()).copy(s.spine.position).applyQuaternion(seg.hips).add(hipsP);
    // torso and legs, parents first; the arms (and hands, fingers) after
    const { wq, wp, bones } = this;
    const armBones = tpl.armBones || (tpl.armBones = new Set(tpl.names.map((_, i) => i).filter((i) => {
      for (let k = i; k >= 0; k = tpl.parent[k]) if (k === tpl.arm.R.arm || k === tpl.arm.L.arm) return true;
      return false;
    })));
    for (let i = 0; i < bones.length; i++) {
      if (armBones.has(i)) continue;
      const p = tpl.parent[i];
      const Qp = p < 0 ? I : wq[p];
      const r = tpl.role[i];
      if (r) {
        if (r.seg === 'spine') wq[i].copy(seg.hips).multiply(_q.copy(I).slerp(spineRel, r.k)).multiply(r.C);
        else wq[i].copy(seg[r.seg]).multiply(r.C);
        bones[i].quaternion.copy(_q.copy(Qp).invert().multiply(wq[i]));
      } else {
        wq[i].copy(Qp).multiply(bones[i].quaternion);
      }
      if (tpl.names[i] === 'Hips') {
        wp[i].copy(hipsP);
        bones[i].position.copy(_v.copy(hipsP).sub(p < 0 ? _v2.set(0, 0, 0) : wp[p]).applyQuaternion(_q.copy(Qp).invert()));
      } else {
        wp[i].copy(bones[i].position).applyQuaternion(Qp).add(p < 0 ? _v2.set(0, 0, 0) : wp[p]);
      }
    }
    if (s.dead) {
      for (const side of ['R', 'L']) this._limpArm(side);
      this._fingers({ R: 'limp', L: 'limp' });
    } else {
      for (const side of ['R', 'L']) this._reach(s, side);
      this._fingers({ R: 'grip', L: 'fore' });
    }
  }

  _setWorld(i, Q) {
    const p = this.tpl.parent[i];
    this.wq[i].copy(Q);
    this.bones[i].quaternion.copy(_q3.copy(this.wq[p]).invert().multiply(Q));
    this.wp[i].copy(this.bones[i].position).applyQuaternion(this.wq[p]).add(this.wp[p]);
  }

  _limpArm(side) {
    const A = this.tpl.arm[side];
    this.wp[A.arm].copy(this.bones[A.arm].position).applyQuaternion(this.wq[this.tpl.parent[A.arm]]).add(this.wp[this.tpl.parent[A.arm]]);
    this._setWorld(A.arm, _q2.copy(this.seg['up' + side]).multiply(A.limp.up));
    this._setWorld(A.fore, _q2.copy(this.seg['fo' + side]).multiply(A.limp.fo));
    this._setWorld(A.hand, _q2.copy(this.wq[A.fore]).multiply(A.handRel));
  }

  /** Two-bone IK onto the rig's hand target, the hand turned to hold the rifle. */
  _reach(s, side) {
    const tpl = this.tpl, A = tpl.arm[side], seg = this.seg;
    const pa = tpl.parent[A.arm];
    const S = this.wp[A.arm].copy(this.bones[A.arm].position).applyQuaternion(this.wq[pa]).add(this.wp[pa]);
    // what the hand holds, in root space (the rig gives it in its spine's space)
    const target = s.handTarget[side];
    const grip = _v2.copy(target.pos).applyQuaternion(seg.spine).add(this.spineP);
    const gunQ = _q.copy(seg.spine).multiply(target.q);
    // hand frame on the gun: palm normal N (toward the grip), fingers F; gun space: +Z muzzle, +Y up, soldier's right -X
    const hold = side === 'R' ? RIGHT_HOLD : LEFT_HOLD;
    const N = _hN.copy(hold.N).applyQuaternion(gunQ), across = _hA.copy(hold.across).applyQuaternion(gunQ);
    const F = side === 'R' ? _hF.crossVectors(across, N) : _hF.crossVectors(N, across);
    const dq = frameRotation(A.F, A.N, F, N, _hQ);
    const handQ = _q2.copy(dq).multiply(tpl.worldQ[A.hand]);
    const palm = _v3.copy(grip).addScaledVector(N, -(hold.r + 0.014));
    const W = palm.add(_v.copy(A.palmToWrist).applyQuaternion(dq));
    // elbow: out and down, like the rig's
    const dir = _hD.copy(W).sub(S);
    let d = dir.length();
    dir.divideScalar(d || 1);
    d = THREE.MathUtils.clamp(d, Math.abs(A.a - A.b) + 0.01, A.a + A.b - 0.002);
    const pole = _hP.set(side === 'R' ? -0.6 : 0.6, -1, -0.3).applyQuaternion(seg.spine);
    const perp = pole.addScaledVector(dir, -pole.dot(dir)).normalize();
    const cosA = THREE.MathUtils.clamp((A.a * A.a + d * d - A.b * A.b) / (2 * A.a * d), -1, 1);
    const E = _hE.copy(S).addScaledVector(dir, cosA * A.a).addScaledVector(perp, Math.sqrt(1 - cosA * cosA) * A.a);
    const Wr = _hW.copy(S).addScaledVector(dir, d);
    const u = _v.copy(E).sub(S), f = _hf.copy(Wr).sub(E);
    const n = _hn.crossVectors(u, f);
    if (n.lengthSq() < 1e-8) n.crossVectors(u, perp).negate();
    this._setWorld(A.arm, frameRotation(A.up[0], A.up[1], u, n, _hQ2).multiply(tpl.worldQ[A.arm]));
    // forearm: takes half the hand's roll about it, as the radius turns round the ulna
    const Qf = frameRotation(A.fo[0], A.fo[1], f, n, _hQ2).multiply(tpl.worldQ[A.fore]);
    const dev = _hQ3.copy(Qf).invert().multiply(handQ).multiply(_q3.copy(A.handRel).invert());
    const ax = A.foreAxis, dp = dev.x * ax.x + dev.y * ax.y + dev.z * ax.z;
    const twist = _hT.set(ax.x * dp, ax.y * dp, ax.z * dp, dev.w).normalize();
    Qf.multiply(_q3.copy(I).slerp(twist, 0.5));
    this._setWorld(A.fore, Qf);
    this._setWorld(A.hand, handQ);
  }
}

// hand placement on the soldier's gun (gun space)
const RIGHT_HOLD = { N: new THREE.Vector3(1, 0, 0), across: new THREE.Vector3(0, -0.95, -0.3).normalize(), r: 0.016 };
const LEFT_HOLD = { N: new THREE.Vector3(-0.35, 0.94, 0).normalize(), across: new THREE.Vector3(0, 0, -1), r: 0.024 };
const _hN = new THREE.Vector3(), _hA = new THREE.Vector3(), _hF = new THREE.Vector3(), _hD = new THREE.Vector3(), _hP = new THREE.Vector3();
const _hE = new THREE.Vector3(), _hW = new THREE.Vector3(), _hf = new THREE.Vector3(), _hn = new THREE.Vector3();
const _hQ = new THREE.Quaternion(), _hQ2 = new THREE.Quaternion(), _hQ3 = new THREE.Quaternion(), _hT = new THREE.Quaternion();
