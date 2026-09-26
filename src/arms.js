// First-person arms: a rigged, textured model (sleeves, fingerless gloves,
// hands) posed procedurally every frame. The arms reach with two-bone IK,
// each hand closes around what it holds (pistol grip, handguard, the firing
// hand, a grenade) by placing the palm on the grip's surface and curling
// every finger joint around the grip axis; the trigger finger lies along the
// frame. Same interface as the sculpted Arms in gunmodels.js.
import * as THREE from 'three';

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4();

/** Rotation taking frame (a1, a2) onto frame (b1, b2): both pairs orthonormalised, third axis a1 x a2. */
function frameRotation(a1, a2, b1, b2, out) {
  const basis = (x, y) => {
    const X = x.clone().normalize();
    const Y = y.clone().addScaledVector(X, -y.dot(X)).normalize();
    const Z = new THREE.Vector3().crossVectors(X, Y);
    return new THREE.Matrix4().makeBasis(X, Y, Z);
  };
  const A = basis(a1, a2), B = basis(b1, b2);
  return out.setFromRotationMatrix(B.multiply(A.transpose()));
}

// how each hold closes the hand: grip radius (m), palm side in the grip frame, finger curl per joint (radians)
const D = Math.PI / 180;
const HOLDS = {
  // firing hand on a pistol grip: palm on the right rear of the grip, index finger along the frame by the trigger
  grip: { r: 0.017, palm: [0.95, 0, 0.3], curl: [82, 96, 56], index: [8, 18, 10], thumb: [8, 10, 6], thumbAim: [-0.35, 0.15, -0.92], oblique: 30 },
  // support hand under the handguard, thumb along its left side
  handguard: { r: 0.025, palm: [-0.25, 0, -0.97], curl: [72, 84, 46], index: [66, 76, 40], thumb: [6, 8, 6], thumbAim: [-0.3, 0.95, 0.1] },
  // support hand wrapped over the firing hand on a pistol
  support: { r: 0.03, palm: [-0.95, 0, 0.3], curl: [74, 88, 50], index: [74, 88, 50], thumb: [6, 8, 6], thumbAim: [-0.2, 0.1, -0.97], oblique: 20 },
  // a grenade (or a magazine, a shell) held in the fingers
  ball: { r: 0.03, palm: [0, -1, 0.2], curl: [42, 48, 30], index: [42, 48, 30], thumb: [30, 30, 20] },
};

export class RealArms {
  constructor(gltf) {
    this.group = new THREE.Group();
    const root = this.root = gltf.scene;
    // authored in centimetres, reaching along +Z: turned to reach along -Z (the camera's view), life size
    root.scale.setScalar(0.01);
    root.rotation.y = Math.PI;
    this.group.add(root);
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.frustumCulled = false;
      o.castShadow = o.receiveShadow = true;
      o.userData.hand = true; // warm in the thermal view
    });
    this.group.updateMatrixWorld(true);
    const bones = {};
    root.traverse((o) => { if (o.isBone) bones[o.name.replace(/_\d+$/, '')] = o; });
    this.bones = bones;
    const pos = (b) => b.getWorldPosition(new THREE.Vector3());
    const quat = (b) => b.getWorldQuaternion(new THREE.Quaternion());
    this.side = {};
    for (const s of ['R', 'L']) {
      const b = (n) => bones[`${s}_${n}`];
      const S = pos(b('arm')), E = pos(b('elbow')), W = pos(b('wrist'));
      const M1 = pos(b('middle1')), I1 = pos(b('point1')), P1 = pos(b('pink1'));
      // bind-pose hand frame: forward (wrist to knuckles), palm normal (out of the palm)
      const F = M1.clone().sub(W).normalize();
      const across = P1.clone().sub(I1).normalize();            // index to little finger
      const N = s === 'R' ? new THREE.Vector3().crossVectors(F, across) : new THREE.Vector3().crossVectors(across, F);
      N.addScaledVector(F, -N.dot(F)).normalize();
      // a power grip holds the handle across the base of the fingers, not the middle of the palm
      const palm = W.clone().lerp(M1, 0.8).addScaledVector(N, 0.012);
      const fingers = {};
      for (const [k, n] of [['thumb', 'thumb'], ['index', 'point'], ['middle', 'middle'], ['ring', 'ring'], ['pinky', 'pink']]) fingers[k] = [1, 2, 3].map((i) => b(n + i)).filter(Boolean);
      this.side[s] = {
        arm: b('arm'), elbow: b('elbow'), wrist: b('wrist'), fingers,
        a: S.distanceTo(E), b: E.distanceTo(W),
        S, bindArm: [E.clone().sub(S), new THREE.Vector3().crossVectors(E.clone().sub(S), W.clone().sub(E))],
        bindFore: [W.clone().sub(E), new THREE.Vector3().crossVectors(E.clone().sub(S), W.clone().sub(E))],
        armQ: quat(b('arm')), elbowQ: quat(b('elbow')), wristQ: quat(b('wrist')),
        F, N, palmToWrist: W.clone().sub(palm), // bind offset from the palm centre to the wrist joint
        fingerQ: Object.fromEntries(Object.entries(fingers).map(([k, ch]) => [k, ch.map((bn) => bn.quaternion.clone())])),
      };
    }
    // where the arms come from, in camera space (the shoulders are just out of view)
    this.shoulder = { R: new THREE.Vector3(0.19, -0.36, 0.12), L: new THREE.Vector3(-0.2, -0.38, 0.05) };
    this.hands = { R: { visible: true }, L: { visible: true } }; // for code that toggles visibility
  }

  /** Sets a bone's world rotation (its parent must be up to date). */
  _setWorldQuat(bone, q) {
    bone.parent.getWorldQuaternion(_q2);
    bone.quaternion.copy(_q2.invert().multiply(q));
    bone.updateMatrixWorld(true);
  }
  _setWorldPos(bone, p) {
    bone.parent.updateWorldMatrix(true, false);
    bone.position.copy(bone.parent.worldToLocal(p.clone()));
    bone.updateMatrixWorld(true);
  }

  /**
   * Poses one arm: `grip` is the centre of what the hand holds and `gripQuat` its frame (y = grip axis),
   * both in camera space. `pistol` = support hand wrapped over the firing hand.
   */
  solve(side, grip, gripQuat, visible = true, pistol = false, hold = null) {
    const sd = this.side[side];
    const hide = !visible;
    sd.arm.scale.setScalar(hide ? 1e-4 : 1);
    if (hide) { sd.arm.updateMatrixWorld(true); return; }
    const h = HOLDS[hold || (side === 'R' ? 'grip' : pistol ? 'support' : 'handguard')];
    // target hand frame: palm against the grip, knuckles across the grip axis
    const A = _v.set(0, 1, 0).applyQuaternion(gripQuat).clone();
    const P = new THREE.Vector3(...h.palm).applyQuaternion(gripQuat);
    P.addScaledVector(A, -P.dot(A)).normalize();
    const N = P.clone().negate();                               // the palm faces the grip
    const across = A.clone().negate();                          // index finger nearest the top / muzzle
    const F = side === 'R' ? new THREE.Vector3().crossVectors(across, N) : new THREE.Vector3().crossVectors(N, across);
    F.normalize();
    if (h.oblique) {
      // a power grip holds the handle diagonally across the palm: knuckles higher, wrist lower than square-on
      const q = new THREE.Quaternion().setFromAxisAngle(N, h.oblique * D);
      if (F.clone().applyQuaternion(q).dot(A) < F.dot(A)) q.invert();
      F.applyQuaternion(q); across.applyQuaternion(q);
    }
    const palmC = grip.clone().addScaledVector(P, h.r + 0.012);
    const handQ = frameRotation(sd.F, sd.N, F, N, new THREE.Quaternion()).multiply(sd.wristQ);
    const dq = frameRotation(sd.F, sd.N, F, N, new THREE.Quaternion());
    const W = palmC.clone().add(sd.palmToWrist.clone().applyQuaternion(dq));
    // two-bone IK from the shoulder; a shoulder that cannot reach comes forward
    let S = this.shoulder[side].clone();
    const reach = sd.a + sd.b - 0.002;
    if (S.distanceTo(W) > reach) {
      // out of reach (a pistol at arm's length): the shoulder comes forward, keeping its height and width,
      // so the upper arm stays low at the side of the view instead of in front of the eye
      const lat = Math.hypot(S.x - W.x, S.y - W.y);
      if (lat < reach) S.z = W.z + Math.sqrt(reach * reach - lat * lat);
      else S = W.clone().add(S.sub(W).setLength(reach));
    }
    const d = S.distanceTo(W);
    const dir = W.clone().sub(S).normalize();
    const pole = new THREE.Vector3(side === 'R' ? 0.7 : -0.7, -1, 0.25).normalize();
    const cosA = THREE.MathUtils.clamp((sd.a * sd.a + d * d - sd.b * sd.b) / (2 * sd.a * d), -1, 1);
    const perp = pole.addScaledVector(dir, -pole.dot(dir)).normalize();
    const E = S.clone().addScaledVector(dir, cosA * sd.a).addScaledVector(perp, Math.sqrt(1 - cosA * cosA) * sd.a);
    const n = new THREE.Vector3().crossVectors(E.clone().sub(S), W.clone().sub(E));
    // upper arm, forearm, hand
    this._setWorldPos(sd.arm, S);
    this._setWorldQuat(sd.arm, frameRotation(sd.bindArm[0], sd.bindArm[1], E.clone().sub(S), n, _q).multiply(sd.armQ));
    this._setWorldQuat(sd.elbow, frameRotation(sd.bindFore[0], sd.bindFore[1], W.clone().sub(E), n, _q).multiply(sd.elbowQ));
    this._setWorldQuat(sd.wrist, handQ);
    // fingers: from straight, each joint bends toward the palm
    for (const [k, chain] of Object.entries(sd.fingers)) {
      const curl = k === 'thumb' ? h.thumb : k === 'index' ? h.index : h.curl;
      chain.forEach((bone, i) => {
        bone.quaternion.copy(sd.fingerQ[k][i]);
        bone.updateMatrixWorld(true);
        if (k === 'thumb' && i === 0 && h.thumbAim) {
          // the thumb is laid along the gun: its first bone turns onto the hold's thumb direction
          const next = chain[1];
          const cur = next.getWorldPosition(new THREE.Vector3()).sub(bone.getWorldPosition(_w)).normalize();
          const want = new THREE.Vector3(...h.thumbAim).applyQuaternion(gripQuat).normalize();
          this._setWorldQuat(bone, new THREE.Quaternion().setFromUnitVectors(cur, want).multiply(bone.getWorldQuaternion(new THREE.Quaternion())));
          return;
        }
        const child = chain[i + 1] || bone.children.find((c) => c.isBone);
        const fdir = child ? child.getWorldPosition(new THREE.Vector3()).sub(bone.getWorldPosition(_w)).normalize() : F;
        // the thumb closes across the palm instead of toward it
        const axis = k === 'thumb'
          ? new THREE.Vector3().crossVectors(fdir, N).add(A.clone().multiplyScalar(side === 'R' ? 0.6 : -0.6)).normalize()
          : new THREE.Vector3().crossVectors(fdir, N).normalize();
        const qw = new THREE.Quaternion().setFromAxisAngle(axis, curl[i] * D).multiply(bone.getWorldQuaternion(new THREE.Quaternion()));
        this._setWorldQuat(bone, qw);
      });
    }
  }
}
