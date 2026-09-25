import * as THREE from 'three';
import { mapBones, rotWorld, Poser } from './rig.js';
import { rockField, floorHeightAt } from './cave.js';

// A few of the crew are too frightened to move: once the giant is in the cave they creep to the nearest wall,
// sit with their back against the rock, hug their knees and bury their face. While sitting the pose is frozen
// (no animation mixer, no path finding). If the giant grabs one, the gate opens, or he is moved, he stands up again.

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

// rotate `bone` so the direction from it to `child` points along `dir` (world space)
function aim(bone, child, dir) {
  if (!bone || !child) return;
  bone.getWorldPosition(_a); child.getWorldPosition(_b);
  _c.subVectors(_b, _a).normalize();
  const d = dir.clone().normalize();
  const ang = Math.acos(THREE.MathUtils.clamp(_c.dot(d), -1, 1));
  if (ang < 1e-3) return;
  rotWorld(bone, _c.clone().cross(d).normalize(), ang);
}
const firstBoneChild = (b) => b && b.children.find((c) => c.isBone);

// nearest rock face around `from`: a spot just in front of it, facing away from the wall
export function findCowerSpot(from) {
  let best = null;
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2, dir = V(Math.sin(a), 0, Math.cos(a));
    const y = floorHeightAt(from.x, from.z) + 0.7;
    for (let r = 0.5; r < 9; r += 0.25) {
      const x = from.x + dir.x * r, z = from.z + dir.z * r;
      if (rockField(x, y, z) > 0) {
        if (!best || r < best.r) best = { r, dir };
        break;
      }
    }
  }
  if (!best) return null;
  const d = Math.max(0, best.r - 0.8);
  const pos = V(from.x + best.dir.x * d, 0, from.z + best.dir.z * d);
  pos.y = floorHeightAt(pos.x, pos.z);
  return { pos, yaw: Math.atan2(-best.dir.x, -best.dir.z) };
}

function sitDown(s, yaw) {
  const r = s.root;
  const b = s._bones || (s._bones = mapBones(r));
  // start from a clean standing frame
  s.mixer.stopAllAction(); s.current = null; s.play('idle', 0); s.mixer.update(0.001);
  const bones = []; r.traverse((o) => { if (o.isBone) bones.push(o); });
  s._rest = bones.map((o) => [o, o.quaternion.clone(), o.position.clone()]);
  r.rotation.set(0, yaw, 0); r.scale.y = r.scale.x;
  r.position.y = floorHeightAt(r.position.x, r.position.z);
  r.updateMatrixWorld(true);
  const q = r.getWorldQuaternion(new THREE.Quaternion());
  const U = V(0, 1, 0), F = V(0, 0, 1).applyQuaternion(q);
  const L = b.lThigh.getWorldPosition(V(0, 0, 0)).sub(b.rThigh.getWorldPosition(V(0, 0, 0))).setY(0).normalize();
  const mix = (u, f, l = 0) => U.clone().multiplyScalar(u).addScaledVector(F, f).addScaledVector(L, l);
  // curl the back and bury the face
  aim(b.spine, b.spine1, mix(0.9, 0.25));
  aim(b.spine1, b.spine2, mix(0.75, 0.6));
  aim(b.spine2, b.neck, mix(0.5, 0.85));
  aim(b.neck, b.head, mix(0.3, 1));
  // knees drawn up to the chest, feet flat in front
  for (const [th, sh, ft, side] of [[b.lThigh, b.lShin, b.lFoot, 1], [b.rThigh, b.rShin, b.rFoot, -1]]) {
    aim(th, sh, mix(0.72, 0.68, 0.1 * side));
    aim(sh, ft, mix(-0.8, 0.6, 0.02 * side));
    aim(ft, firstBoneChild(ft), mix(-0.1, 1));
  }
  r.updateMatrixWorld(true);
  // arms wrapped round the shins, hands clasped in front
  const kl = b.lShin.getWorldPosition(V(0, 0, 0)), kr = b.rShin.getWorldPosition(V(0, 0, 0));
  const knees = kl.clone().add(kr).multiplyScalar(0.5);
  const clasp = knees.addScaledVector(F, 0.12).addScaledVector(U, -0.2);
  const poser = new Poser(r, b);
  poser.reach('L', clasp.clone().addScaledVector(L, 0.05), 1);
  poser.reach('R', clasp.clone().addScaledVector(L, -0.05), 1);
  // lower the body until he sits on the ground
  r.updateMatrixWorld(true);
  const hy = b.hips.getWorldPosition(V(0, 0, 0)).y;
  r.position.y -= hy - (floorHeightAt(r.position.x, r.position.z) + 0.1);
  r.updateMatrixWorld(true);
  s.sitting = true;
}

function standUp(s) {
  if (!s.sitting) return;
  for (const [o, q, p] of s._rest || []) { o.quaternion.copy(q); o.position.copy(p); }
  s.root.position.y = floorHeightAt(s.root.position.x, s.root.position.z);
  s.mixer.stopAllAction(); s.current = null; s.play('idle', 0);
  s.sitting = false;
}

// returns true when the soldier was fully handled (sitting still) and the normal update must be skipped
export function updateCower(G, s, dt) {
  const scared = G.phase !== 'intro' && (s.state === 'hide' || s.state === 'panic' || s.state === 'idle');
  if (!scared) { standUp(s); s.cowerT = 0; return false; }
  const r = s.root;
  if (!s.cowerSpot) s.cowerSpot = findCowerSpot(r.position) || { pos: r.position.clone(), yaw: r.rotation.y };
  const spot = s.cowerSpot;
  const dist = Math.hypot(r.position.x - spot.pos.x, r.position.z - spot.pos.z);
  if (s.sitting) {
    if (dist > 0.6) { standUp(s); s.cowerSpot = null; return false; } // moved (e.g. swapped bodies)
    return true;
  }
  // creep over to the wall (the regular hide logic walks him home), then sit
  if (s.state === 'idle') s.state = 'hide';
  s.home = spot.pos.clone();
  s.cowerT = (s.cowerT || 0) + dt;
  if (dist < 1.3 || s.cowerT > 20) {
    if (dist >= 1.3) s.cowerSpot = { pos: r.position.clone(), yaw: spot.yaw }; // could not reach it: sit where he is
    else r.position.set(spot.pos.x, spot.pos.y, spot.pos.z);
    sitDown(s, s.cowerSpot.yaw);
    return true;
  }
  return false;
}
