import * as THREE from 'three';

// Resolve humanoid roles from arbitrary bone naming (Mixamo, MakeHuman game_engine, etc.)
const ROLES = {
  hips: [/hips$/i, /pelvis/i, /^root$/i],
  spine: [/spine$/i, /spine_?0?1$/i, /spine\.?001/i],
  spine1: [/spine1$/i, /spine_?0?2$/i, /spine\.?002/i],
  spine2: [/spine2$/i, /spine_?0?3$/i, /spine\.?003/i, /chest/i],
  neck: [/neck$/i, /neck_?0?1$/i, /neck/i],
  head: [/head$/i],
  lShoulder: [/leftshoulder/i, /clavicle_?l$/i, /shoulder\.l/i, /clavicle\.l/i],
  rShoulder: [/rightshoulder/i, /clavicle_?r$/i, /shoulder\.r/i, /clavicle\.r/i],
  lArm: [/leftarm$/i, /upperarm_?l$/i, /upper_?arm\.l/i, /upperarm01\.l/i],
  rArm: [/rightarm$/i, /upperarm_?r$/i, /upper_?arm\.r/i, /upperarm01\.r/i],
  lFore: [/leftforearm/i, /lowerarm_?l$/i, /forearm\.l/i, /lowerarm01\.l/i],
  rFore: [/rightforearm/i, /lowerarm_?r$/i, /forearm\.r/i, /lowerarm01\.r/i],
  lHand: [/lefthand$/i, /hand_?l$/i, /hand\.l$/i, /wrist\.l/i],
  rHand: [/righthand$/i, /hand_?r$/i, /hand\.r$/i, /wrist\.r/i],
  lThigh: [/leftupleg/i, /thigh_?l$/i, /thigh\.l/i, /upperleg01\.l/i],
  rThigh: [/rightupleg/i, /thigh_?r$/i, /thigh\.r/i, /upperleg01\.r/i],
  lShin: [/leftleg$/i, /calf_?l$/i, /shin\.l/i, /lowerleg01\.l/i],
  rShin: [/rightleg$/i, /calf_?r$/i, /shin\.r/i, /lowerleg01\.r/i],
  lFoot: [/leftfoot/i, /foot_?l$/i, /foot\.l/i],
  rFoot: [/rightfoot/i, /foot_?r$/i, /foot\.r/i],
};

export function mapBones(root) {
  const bones = [];
  root.traverse((o) => { if (o.isBone) bones.push(o); });
  const clean = (n) => n.replace(/^mixamorig:?/i, '').replace(/^DEF[-_]/i, '');
  const map = {};
  for (const [role, pats] of Object.entries(ROLES)) {
    for (const p of pats) {
      const b = bones.find((b) => p.test(clean(b.name)) && !Object.values(map).includes(b));
      if (b) { map[role] = b; break; }
    }
  }
  return map;
}

const _q = new THREE.Quaternion(), _pq = new THREE.Quaternion(), _wq = new THREE.Quaternion();
// rotate a bone about a WORLD axis (convention independent)
export function rotWorld(bone, axis, angle) {
  if (!bone || !angle) return;
  bone.parent.getWorldQuaternion(_pq);
  bone.getWorldQuaternion(_wq);
  _q.setFromAxisAngle(axis, angle).multiply(_wq);
  bone.quaternion.copy(_pq.invert().multiply(_q));
  bone.updateMatrixWorld(true);
}

// Procedural overlay poses on top of whatever the animation mixer produced.
export class Poser {
  constructor(root, bones) { this.root = root; this.b = bones; this.right = new THREE.Vector3(); this.fwd = new THREE.Vector3(); this.up = new THREE.Vector3(0, 1, 0); }
  frame() {
    const q = this.root.getWorldQuaternion(new THREE.Quaternion());
    this.right.set(1, 0, 0).applyQuaternion(q);
    this.fwd.set(0, 0, 1).applyQuaternion(q);
    this.up.set(0, 1, 0).applyQuaternion(q);
  }
  // squat (0..1): knees forward, hips down (caller lowers the root); bend (0..1): torso pitches forward
  squatBend(squat, bend, sign = 1) {
    this.frame();
    const b = this.b, R = this.right;
    const a = squat * 1.15 * sign;
    rotWorld(b.lThigh, R, -a); rotWorld(b.rThigh, R, -a);
    rotWorld(b.lShin, R, a * 2); rotWorld(b.rShin, R, a * 2);
    rotWorld(b.lFoot, R, -a); rotWorld(b.rFoot, R, -a);
    const t = bend * 0.55 * sign;
    rotWorld(b.spine, R, t); rotWorld(b.spine1, R, t * 0.6); rotWorld(b.spine2, R, t * 0.4);
    rotWorld(b.neck, R, -t * 0.7);
  }
  // look toward a world point with the head/neck
  look(target, w = 1) {
    if (!this.b.head || w <= 0) return;
    const hp = this.b.head.getWorldPosition(new THREE.Vector3());
    const d = target.clone().sub(hp).normalize();
    this.frame();
    const yaw = Math.atan2(d.dot(this.right), d.dot(this.fwd));
    const pitch = Math.asin(THREE.MathUtils.clamp(d.dot(this.up), -1, 1));
    rotWorld(this.b.neck, this.up, THREE.MathUtils.clamp(yaw, -1, 1) * 0.5 * w);
    rotWorld(this.b.head, this.up, THREE.MathUtils.clamp(yaw, -1, 1) * 0.5 * w);
    rotWorld(this.b.head, this.right, -THREE.MathUtils.clamp(pitch, -0.8, 0.8) * 0.7 * w);
  }
  // CCD IK from shoulder to hand toward a world target
  reach(side, target, w) {
    if (w <= 0.001) return;
    if (this.collide) target = this.clampTarget(target.clone());
    const b = this.b;
    const chain = side === 'R' ? [b.rHand, b.rFore, b.rArm, b.rShoulder] : [b.lHand, b.lFore, b.lArm, b.lShoulder];
    if (chain.some((x) => !x)) return;
    const eff = chain[0];
    const e = new THREE.Vector3(), j = new THREE.Vector3(), a = new THREE.Vector3(), c = new THREE.Vector3(), q = new THREE.Quaternion();
    for (let it = 0; it < 8; it++) {
      for (let k = 1; k < chain.length; k++) {
        const bone = chain[k];
        eff.getWorldPosition(e); bone.getWorldPosition(j);
        a.copy(e).sub(j).normalize(); c.copy(target).sub(j).normalize();
        const ang = Math.acos(THREE.MathUtils.clamp(a.dot(c), -1, 1));
        if (ang < 1e-3) continue;
        const axis = a.clone().cross(c).normalize();
        rotWorld(bone, axis, ang * w * (k === 3 ? 0.2 : 0.7));
      }
    }
    if (this.collide) this.elbowOut(chain, w);
  }
  // the mixamo clips were made for a slim body: swing each free-hanging arm out from the shoulder until the
  // elbow, forearm and hand clear the giant's belly, hips and thighs
  armsClear(skip = {}) {
    const C = this.collide, b = this.b; if (!C || !b.hips || !b.neck) return;
    this.frame();
    const V3 = THREE.Vector3, P = (x) => x.getWorldPosition(new V3());
    const A = P(b.hips).addScaledVector(this.up, -C.rTorso * 1.1), B = P(b.neck);
    const body = new THREE.Line3(A, B), tmp = new V3();
    const legs = [[b.lThigh, b.lShin], [b.rThigh, b.rShin]].filter(([t, s]) => t && s).map(([t, s]) => new THREE.Line3(P(t), P(s)));
    const pen = (p) => {
      let d = p.distanceTo(body.closestPointToPoint(p, true, tmp)) - (C.rTorso + C.rHand * 0.6);
      for (const l of legs) d = Math.min(d, p.distanceTo(l.closestPointToPoint(p, true, tmp)) - (C.rTorso * 0.55 + C.rHand * 0.6));
      return d;
    };
    for (const [side, arm, fore, hand] of [['R', b.rArm, b.rFore, b.rHand], ['L', b.lArm, b.lFore, b.lHand]]) {
      if (skip[side] || !arm || !fore || !hand) continue;
      const sp = P(arm), out = sp.clone().sub(P(b.spine1 || b.hips)); out.addScaledVector(this.up, -out.dot(this.up)).normalize();
      for (let it = 0; it < 10; it++) {
        const ep = P(fore), hp = P(hand);
        const worst = Math.min(pen(ep), pen(ep.clone().lerp(hp, 0.5)), pen(hp));
        if (worst > 0 && it > 0) break;
        const dir = ep.sub(sp).normalize(), axis = dir.clone().cross(out);
        if (axis.lengthSq() < 1e-6) break;
        rotWorld(arm, axis.normalize(), it === 0 ? 0.12 : 0.09);
      }
      // a forearm folded across the belly: open the elbow away from the body
      for (let it = 0; it < 8; it++) {
        const ep = P(fore), hp = P(hand);
        if (pen(hp) > 0 && pen(ep.clone().lerp(hp, 0.5)) > 0) break;
        const push = hp.clone().sub(body.closestPointToPoint(hp, true, tmp)).add(out.clone().multiplyScalar(0.5));
        push.addScaledVector(this.up, -push.dot(this.up)).normalize();
        const axis = hp.sub(ep).normalize().cross(push);
        if (axis.lengthSq() < 1e-6) break;
        rotWorld(fore, axis.normalize(), 0.1);
      }
    }
  }
  // keep a reach target outside the body: torso capsule (hips..neck) and head sphere
  clampTarget(target) {
    const C = this.collide, b = this.b; if (!C || !b.hips || !b.neck) return target;
    const A = b.hips.getWorldPosition(new THREE.Vector3()), B = b.neck.getWorldPosition(new THREE.Vector3());
    const seg = new THREE.Line3(A, B), cp = seg.closestPointToPoint(target, true, new THREE.Vector3());
    let d = target.clone().sub(cp), r = C.rTorso + C.rHand;
    if (d.length() < r) {
      this.frame();
      d.addScaledVector(this.up, -d.dot(this.up)); // push out sideways/forward, never up or down
      if (d.lengthSq() < 1e-6) d.copy(this.fwd);
      if (d.dot(this.fwd) < 0 && Math.abs(d.dot(this.right)) < C.rTorso * 0.6) d.addScaledVector(this.fwd, C.rTorso); // behind the back: go round the front
      target = cp.addScaledVector(d.normalize(), r);
    }
    if (b.head) {
      const hc = b.head.getWorldPosition(new THREE.Vector3()).addScaledVector(this.up, C.rHead * 0.6);
      const dh = target.clone().sub(hc), rh = C.rHead + C.rHand * 0.5;
      if (dh.length() < rh) target = hc.addScaledVector(dh.lengthSq() > 1e-6 ? dh.normalize() : this.fwd, rh);
    }
    return target;
  }
  // twist the upper arm about the shoulder->hand line (hand stays put) so the elbow points out and down, away from the ribs
  elbowOut([hand, fore, arm], w) {
    const sp = arm.getWorldPosition(new THREE.Vector3()), hp = hand.getWorldPosition(new THREE.Vector3()), ep = fore.getWorldPosition(new THREE.Vector3());
    const axis = hp.clone().sub(sp); if (axis.lengthSq() < 1e-6) return; axis.normalize();
    const spine = this.b.spine1 || this.b.hips; if (!spine) return;
    this.frame();
    const out = sp.clone().sub(spine.getWorldPosition(new THREE.Vector3())); out.addScaledVector(this.up, -out.dot(this.up)).normalize();
    const pole = out.multiplyScalar(1).addScaledVector(this.up, -0.9).addScaledVector(this.fwd, -0.25);
    const proj = (v) => v.addScaledVector(axis, -v.dot(axis));
    const e = proj(ep.clone().sub(sp)), p = proj(pole);
    if (e.lengthSq() < 1e-6 || p.lengthSq() < 1e-6) return;
    e.normalize(); p.normalize();
    let ang = Math.acos(THREE.MathUtils.clamp(e.dot(p), -1, 1));
    if (e.clone().cross(p).dot(axis) < 0) ang = -ang;
    rotWorld(arm, axis, ang * w);
  }
}
