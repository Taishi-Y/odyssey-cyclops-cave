import * as THREE from 'three';
import { makeBronzeMaterial } from './materials.js';
import { rotWorld } from './rig.js';

// The crew fight back: while the giant is awake at night the braver men (no torch, not the cowering ones)
// take turns darting in to hack at his shins with their bronze swords, then run clear before he can grab them.
// The sword is a scene-level mesh re-posed onto the right fist every frame, so it follows any animation.

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
const _a = V(0, 0, 0), _b = V(0, 0, 0), _c = V(0, 0, 0), _d = V(0, 0, 0), _q = new THREE.Quaternion();
const flat = (v) => V(v.x, 0, v.z);

let SWORD_GEO = null;
function swordMesh() {
  if (!SWORD_GEO) {
    // xiphos: leaf-shaped double-edged blade ~60 cm, short crossguard, wrapped grip, round pommel (+Y = blade)
    const blade = new THREE.CylinderGeometry(0.005, 0.04, 0.66, 4, 1); blade.scale(1, 1, 0.25); blade.translate(0, 0.39, 0);
    const guard = new THREE.BoxGeometry(0.14, 0.026, 0.035); guard.translate(0, 0.05, 0);
    const grip = new THREE.CylinderGeometry(0.014, 0.014, 0.1, 8); grip.translate(0, -0.005, 0);
    const pommel = new THREE.SphereGeometry(0.022, 8, 6); pommel.translate(0, -0.065, 0);
    SWORD_GEO = { blade, guard, grip, pommel };
  }
  const g = new THREE.Group();
  const bronze = makeBronzeMaterial();
  const steel = new THREE.MeshStandardMaterial({ color: 0xd8c090, metalness: 1, roughness: 0.22 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x2a1a0f, roughness: 0.9 });
  for (const [k, m] of [['blade', steel], ['guard', bronze], ['grip', wood], ['pommel', bronze]]) {
    const mesh = new THREE.Mesh(SWORD_GEO[k], m); mesh.castShadow = true; g.add(mesh);
  }
  g.userData.steel = steel;
  return g;
}

export function equipSwords(G) {
  for (const s of G.soldiers) {
    if (s.torch || s.torchTip) continue;
    s.sword = swordMesh();
    G.scene.add(s.sword);
    s.brave = !s.cower;
  }
}

// rotate `bone` (weight w) so the direction bone -> child points along dir
function aim(bone, child, dir, w) {
  if (!bone || !child || w <= 0) return;
  bone.getWorldPosition(_a); child.getWorldPosition(_b);
  _c.subVectors(_b, _a).normalize();
  const ang = Math.acos(THREE.MathUtils.clamp(_c.dot(dir), -1, 1));
  if (ang < 1e-3) return;
  rotWorld(bone, _d.copy(_c).cross(dir).normalize(), ang * w);
}

// overhead chop, u in [0,1): wind up high behind the head, chop down to the front, recover
function swingPose(s, u) {
  const b = s.bmap; if (!b.rArm || !b.rFore || !b.rHand) return;
  const q = s.root.quaternion;
  const fwd = V(0, 0, 1).applyQuaternion(q), right = V(-1, 0, 0).applyQuaternion(q);
  const up = UP.clone();
  const K = [ // [t, upper arm dir, forearm dir]
    [0.0, V(0.1, -1, 0.3), V(0, -1, 0.8)],
    [0.35, V(0.35, 1, -0.25), V(0, 0.5, -1)],
    [0.55, V(0.2, 0.15, 1), V(0, -0.35, 1)],
    [0.75, V(0.15, -0.5, 1), V(0, -0.8, 0.8)],
    [1.0, V(0.1, -1, 0.3), V(0, -1, 0.8)],
  ];
  let i = 0; while (i < K.length - 2 && u > K[i + 1][0]) i++;
  const k = THREE.MathUtils.smoothstep((u - K[i][0]) / (K[i + 1][0] - K[i][0]), 0, 1);
  const toWorld = (v) => right.clone().multiplyScalar(v.x).addScaledVector(up, v.y).addScaledVector(fwd, v.z).normalize();
  const ua = toWorld(K[i][1].clone().lerp(K[i + 1][1], k));
  const fa = toWorld(K[i][2].clone().lerp(K[i + 1][2], k));
  const w = Math.min(1, Math.sin(Math.min(1, u) * Math.PI) * 3);
  // lean into the blow
  if (b.spine1) rotWorld(b.spine1, right, (u > 0.35 && u < 0.8 ? 0.25 : -0.12) * w);
  aim(b.rArm, b.rFore, ua, w);
  aim(b.rFore, b.rHand, fa, w);
}

// put the sword in the right fist, blade continuing the forearm line (tipped forward)
function poseSword(s) {
  const b = s.bmap, sw = s.sword;
  if (!sw) return;
  sw.visible = s.root.visible && s.alive && s.state !== 'crawlOut';
  if (!sw.visible || !b.rHand || !b.rFore) return;
  b.rFore.getWorldPosition(_a); b.rHand.getWorldPosition(_b);
  _c.subVectors(_b, _a).normalize();
  const fwd = V(0, 0, 1).applyQuaternion(s.root.quaternion);
  const dir = _c.clone().multiplyScalar(0.6).addScaledVector(fwd, 0.8).normalize();
  sw.position.copy(_b).addScaledVector(_c, 0.07);
  sw.quaternion.copy(_q.setFromUnitVectors(UP, dir));
}

// nearest point of the giant's shins to p (the only part a man can reach)
function shinPoint(G, p) {
  const B = G.cy.bones; let best = null;
  for (const [knee, foot] of [[B.LeftLeg, B.LeftFoot], [B.RightLeg, B.RightFoot]]) {
    if (!knee || !foot) continue;
    const seg = new THREE.Line3(knee.getWorldPosition(V(0, 0, 0)), foot.getWorldPosition(V(0, 0, 0)));
    const cp = seg.closestPointToPoint(V(p.x, p.y + 1.3, p.z), true, V(0, 0, 0));
    const d = flat(cp).distanceTo(flat(p));
    if (!best || d < best.d) best = { d, at: cp, foot: foot.getWorldPosition(V(0, 0, 0)) };
  }
  return best;
}

export function fightActive(G) {
  const st = G.cyState;
  return G.phase === 'night' && G.cy.root.visible && !G.cy.blind && (st.mode === 'tend' || st.mode === 'script') && !G.player.dead;
}
// the squad (squad.js) moves as one while the giant is awake at night, and while he gropes around blind
export function squadActive(G) {
  return fightActive(G) || (G.phase === 'blind' && G.cyState.mode === 'blind' && G.cy.root.visible && !G.player.dead);
}

// one attack run from bearing `ang` (world yaw around the giant): charge the nearer shin coming in from that side,
// hack 2-3 times, then break off to 7 m on the same side and go again. returns { target, speed, anim }
export function assault(G, s, dt, ang) {
  const r = s.root, cp = G.cy.root.position;
  const side = V(Math.sin(ang), 0, Math.cos(ang));
  s.fT = (s.fT || 0) - dt;
  if (s.fp !== 'charge' && s.fp !== 'strike' && s.fp !== 'recover') { s.fp = 'charge'; s.fT = 7; }
  switch (s.fp) {
    case 'charge': {
      const leg = shinPoint(G, r.position);
      const goal = leg ? flat(leg.foot).addScaledVector(side, 1.0 + (s.sq % 3) * 0.3) : flat(cp).addScaledVector(side, 2.5);
      if (flat(r.position).distanceTo(goal) < 0.9 || (leg && leg.d < 1.5) || s.fT < 0) { s.fp = 'strike'; s.swings = 2 + ((Math.random() * 2) | 0); s.swing = 0; s.fT = 6; }
      return { target: goal, speed: 4.4, anim: 'run' };
    }
    case 'strike': {
      const leg = shinPoint(G, r.position);
      const look = leg ? leg.at : cp;
      const d = flat(look).sub(flat(r.position)); let dh = Math.atan2(d.x, d.z) - r.rotation.y; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      r.rotation.y += dh * Math.min(1, dt * 10);
      const prev = s.swing;
      s.swing += dt / 0.85;
      if (prev < 0.55 && s.swing >= 0.55) {
        if (leg && leg.d < 2.1) hitGiant(G, s, leg.at);
        else G.audio.whoosh?.(0.12);
      }
      if (prev < 0.3 && s.swing >= 0.3 && Math.random() < 0.35) G.audio.whoosh?.(0.08);
      if (s.swing >= 1) { s.swing = 0; if (--s.swings <= 0 || s.fT < 0) { s.fp = 'recover'; s.fT = 1.2 + Math.random() * 1.2; s.swing = null; } }
      if (leg && leg.d > 2.8) { s.fp = 'charge'; s.swing = null; s.fT = 5; }
      return { target: null, anim: 'idle' };
    }
    default: { // recover: sprint back out to 7 m on our side, then straight back in
      if (s.fT < 0) { s.fp = 'charge'; s.fT = 7; }
      return { target: flat(cp).addScaledVector(side, 7), speed: 4.6, anim: 'run' };
    }
  }
}

function hitGiant(G, s, at) {
  const st = G.cyState;
  const dir = flat(at).sub(flat(s.root.position)).normalize();
  G.audio.impact(at, 'flesh');
  G.particles.blood(at, dir.clone().negate().setY(0.4), 18, 1.6);
  s.hitAt = G.time;
  st.cuts = (st.cuts || 0) + 1;
  st.lastCutBy = s;
  st.anger = Math.min(1.5, (st.anger || 0) + 0.2); // every cut makes him angrier (swat.js)
  if (st.mode === 'tend') { st.alert = Math.min(2, st.alert + 0.35); st.noiseAt = at.clone(); }
  if (Math.random() < 0.3) G.audio.roar(G.cy.eyeWorld(), { dur: 0.9, vol: 0.45, pitch: 1.15, pain: true });
  const d = G.player.pos.distanceTo(at);
  if (d < 12) G.player.shake = Math.max(G.player.shake, 0.08);
}

// enter / leave fighting for the whole crew, and pose sword arms (after the mixer has run)
export function updateCrewFight(G) {
  const on = squadActive(G);
  for (const s of G.soldiers) {
    if (!s.alive) continue;
    if (on && !s.cower && (s.state === 'hide' || s.state === 'idle') && !s.sitting) {
      s.state = 'fight'; s.fp = null; s.fT = 0;
    } else if (!on && s.state === 'fight') { s.state = 'hide'; s.swing = null; s.fp = null; }
    if (s.state === 'fight' && s.swing != null && s.fp === 'strike') swingPose(s, s.swing);
    poseSword(s);
  }
}
