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
  }
}
