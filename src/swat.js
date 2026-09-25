import * as THREE from 'three';
import { floorHeightAt, rockField } from './cave.js';
import { crewBark } from './voices.js';

// The giant loses his temper: after enough cuts and arrows (cyState.anger) he drops low and swats the floor
// with the back of his hand, a flat sweep that catches the men standing in front of him. Whoever it catches
// is thrown across the cave and smashed against the rock. The first man hit gets the special shot: the world
// drops into slow motion and the camera flies alongside him until he hits the wall.

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const flat = (v) => V(v.x, 0, v.z);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const bearing = (from, to) => Math.atan2(to.x - from.x, to.z - from.z);
const SLOW = 0.14;            // world speed while a man is in the air
const ANGER_MAX = 1;          // anger that sets it off

// anger builds with every wound (crewfight hitGiant +0.2, arrows in the body +0.35) and cools slowly
export function addAnger(G, amt) { const st = G.cyState; st.anger = Math.min(1.5, (st.anger || 0) + amt); }

// the men he can reach with a sweep: out in the open, 2.5-11 m (scaled) from his feet, grouped on one side
export function swatTargets(G) {
  const cy = G.cy, cp = cy.root.position, H = cy.height / 13;
  const men = G.soldiers.filter((s) => s.alive && s.root.visible && !s.cower && !s.escaped && !s.sitting &&
    ['fight', 'hide', 'panic', 'idle', 'frozen', 'gather'].includes(s.state));
  const inReach = men.map((s) => ({ s, d: flat(s.root.position).distanceTo(flat(cp)), b: bearing(cp, s.root.position) }))
    .filter((m) => m.d > 2.5 * H && m.d < 11 * H).sort((a, b) => a.d - b.d);
  if (!inReach.length) return [];
  const b0 = inReach[0].b;
  return inReach.filter((m) => Math.abs(wrap(m.b - b0)) < 1.15).slice(0, 4);
}

export function wantsSwat(G) {
  const st = G.cyState;
  return G.phase === 'night' && st.mode === 'tend' && (st.anger || 0) >= ANGER_MAX && !G._swatting && !st.grabbing &&
    !G._eating && !G.player.grabbed && !(st.stun > 0) && G.time > (st.swatCd || 0);
}

export async function rageSwat(G, targets = swatTargets(G)) {
  if (G._swatting || !targets.length) return false;
  const cy = G.cy, st = G.cyState, r = cy.root, H = cy.height / 13;
  G._swatting = true; st.grabbing = true; st.walkTarget = null; st.path = null; st.anger = 0; st.swatCd = G.time + 20;
  const cp = r.position.clone();
  // aim the sweep through the middle of the group
  let sx = 0, sz = 0; for (const m of targets) { sx += Math.sin(m.b); sz += Math.cos(m.b); }
  const mid = Math.atan2(sx, sz);
  const rad = THREE.MathUtils.clamp(targets.reduce((a, m) => a + m.d, 0) / targets.length, 4.5 * H, 7 * H);
  const h0 = r.rotation.y;
  // the right hand swings from his right (heading - pi/2) across the front to his left
  const a0 = mid - 1.45, a1 = mid + 1.35;
  const handAt = (a, radius, y) => { const x = cp.x + Math.sin(a) * radius, z = cp.z + Math.cos(a) * radius; return V(x, floorHeightAt(x, z) + y, z); };
  // the first man the hand will reach: the camera frames the hand coming at him before the blow lands
  const first = targets.slice().sort((p, q) => wrap(p.b - a0) - wrap(q.b - a0))[0];
  try {
    // wind up: a furious roar, he turns on them and cocks the arm out and back, dropping into a crouch
    G.audio.roar(cy.eyeWorld(), { dur: 2.2, vol: 1.8, pitch: 0.85 });
    G.audio.boom?.('impact', 0.8);
    G.say?.('He\'s going to swat us!', 1.4, 'Eurylochus');
    crewBark(G, 'spotted', { n: 2 });
    G.player.shake = Math.max(G.player.shake, 0.5);
    st.heading = mid;
    const W = 0.85;
    for (let t = 0; t < W; t += G.dt || 1 / 60) {
      await G.wait(0);
      const u = Math.min(1, t / W), e = u * u * (3 - 2 * u);
      r.rotation.y = h0 + wrap(mid - h0) * e;
      cy.forceSquat = 0.55 * e; cy.squatRate = 6;
      cy.ik.R = { target: handAt(a0 - 0.35, rad * 0.9, 3.2 * H), w: e, noSquat: true };
      if (u > 0.3 && !G.swatCam) startHandCam(G, first.s, a0 - 0.35);
      if (u > 0.7 && G.swatCam?.hand) G.swatSlow = true; // slow motion from the top of the backswing: the whole blow plays slow
    }
    // the sweep: flat and fast along the floor
    G.audio.whoosh?.(0.6);
    const S = 0.6, hit = new Set();
    let prevA = a0;
    for (let t = 0; t < S; t += G.dt || 1 / 60) {
      await G.wait(0);
      const u = Math.min(1, t / S), e = u * u * (1.6 - 0.6 * u);   // accelerates into the blow
      const a = a0 + (a1 - a0) * e;
      r.rotation.y = mid + (e - 0.5) * 0.5;                          // the shoulders follow the arm through
      cy.forceSquat = 0.55 + 0.4 * Math.sin(u * Math.PI); cy.squatRate = 10;
      cy.ik.R = { target: handAt(a, rad, 0.7 * H), w: 1, noSquat: true };
      const hc = G.swatCam?.hand ? G.swatCam : null;
      if (hc) { hc.a = a; G.swatSlow = true; } // the whole swing plays in slow motion, from the moment the hand starts across
      const hp = cy.handWorld('R');
      if (Math.random() < 0.5) G.particles.dust(V(hp.x, floorHeightAt(hp.x, hp.z) + 0.2, hp.z), 4, 1.5);
      for (const m of targets) {
        if (hit.has(m.s) || !m.s.alive || m.s.state === 'grabbed') continue;
        const rel = wrap(m.b - prevA), span = wrap(a - prevA);
        if (rel >= -0.05 && rel <= span + 0.05) { hit.add(m.s); fling(G, m.s, a, wantsStar(G)); }
      }
      // anyone else (Odysseus included) standing right where the hand passes gets bowled over too
      for (const s of G.soldiers) {
        if (hit.has(s) || !s.alive || !s.root.visible || s.cower || s.state === 'grabbed' || s.state === 'flung' || s.state === 'crawlOut') continue;
        if (flat(s.root.position).distanceTo(flat(hp)) < 1.6 * H) { hit.add(s); fling(G, s, a, wantsStar(G)); }
      }
      const P = G.player;
      if (!P.dead && !P.grabbed && flat(P.pos).distanceTo(flat(hp)) < 1.5 * H && P.pos.y < hp.y + 2) {
        const tg = V(Math.cos(a), 0, -Math.sin(a));
        P.vel.copy(tg.multiplyScalar(9)).add(V(0, 5, 0)); P.shake = 1.4; G.haptic?.([80, 40, 80]);
      }
      prevA = a;
    }
    if (!hit.size) { G.audio.stomp(cp, 0.8); crewBark(G, 'spotted', { n: 2 }); }
    // follow-through and recover
    for (let t = 0; t < 0.9; t += G.dt || 1 / 60) {
      await G.wait(0);
      const k = 1 - t / 0.9;
      cy.forceSquat = 0.55 * k;
      cy.ik.R = { target: handAt(a1 + 0.2, rad * 0.9, (0.7 + (1 - k) * 2) * H), w: k, noSquat: true };
    }
    if (hit.size) {
      G.audio.roar(cy.eyeWorld(), { dur: 1.8, vol: 1.3, pitch: 0.95 });
      crewBark(G, 'witness', { n: 3, delay: 0.6 });
    }
  } finally {
    if (G.swatCam?.hand) endSwatCam(G); // the sweep missed everyone: hand the camera back
    cy.ik.R = null; cy.forceSquat = 0; cy.squatRate = 1.2;
    st.grabbing = false; st.heading = r.rotation.y; st.alert = Math.max(st.alert, 0.9); G._swatting = false;
  }
  return true;
}

// a man takes the full back of the hand: thrown along the sweep, up and out, tumbling
function fling(G, s, a, star) {
  const H = G.cy.height / 13;
  const tg = V(Math.cos(a), 0, -Math.sin(a)), out = V(Math.sin(a), 0, Math.cos(a));
  const vel = tg.multiplyScalar(15 + Math.random() * 4).addScaledVector(out, 5 + Math.random() * 3).add(V(0, 6.5 + Math.random() * 2, 0)).multiplyScalar(Math.sqrt(H));
  const axis = V(0, 1, 0).cross(vel.clone().setY(0).normalize()).normalize();
  s.state = 'flung'; s.swing = null; s.fp = null; s.post = null;
  s.fly = { vel, axis, spin: 7 + Math.random() * 5, t: 0, phase: 'air', wall: false };
  s.play('run', 0.05, 2.6); // legs and arms thrashing in the air
  const p = s.root.position.clone().add(V(0, 1.2, 0));
  G.audio.impact(p, 'flesh');
  G.audio.sfx?.('hitPunch', { pos: p, vol: 1, rate: 0.7 });
  G.audio.scream(p);
  G.gore?.gore?.(p, vel.clone().normalize(), 40, 3); G.particles.blood(p, vel.clone().normalize(), 30, 3);
  G.player.shake = Math.max(G.player.shake, 0.6);
  if (star) startSwatCam(G, s);
}

// per-frame for a flung man (called from updateSoldiers after his mixer ran). returns true while it owns him
export function updateFlung(G, s, dt) {
  const f = s.fly; if (!f) return false;
  const r = s.root; f.t += dt;
  const centre = () => r.localToWorld(V(0, 0.9, 0));
  if (f.phase === 'air' || f.phase === 'drop') {
    const prev = centre();
    f.vel.y -= 9.8 * dt; f.vel.multiplyScalar(1 - 0.04 * dt);
    r.position.addScaledVector(f.vel, dt);
    r.rotateOnWorldAxis(f.axis, f.spin * dt);
    r.updateMatrixWorld(true);
    const cur = centre();
    const dir = cur.clone().sub(prev), len = dir.length();
    const h = len > 1e-5 ? G.physics.raycastSegment(prev, cur.clone().addScaledVector(dir.normalize(), 0.3)) : null;
    const n = h?.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : null;
    const fy = floorHeightAt(r.position.x, r.position.z);
    const inRock = rockField(cur.x, cur.y, cur.z) > 0.05;
    if (f.phase === 'air' && ((h && n && Math.abs(n.y) < 0.75) || (inRock && cur.y > fy + 0.8))) {
      smash(G, s, h ? h.point : prev, n || flat(prev.clone().sub(cur)).normalize());
    } else if (r.position.y <= fy + 0.05 && f.vel.y < 0) {
      r.position.y = fy + 0.05;
      if (f.phase === 'air' && f.vel.length() > 7) { // skids and bounces off the floor
        f.vel.y = -f.vel.y * 0.35; f.vel.x *= 0.55; f.vel.z *= 0.55; f.spin *= 0.6;
        G.audio.impact(r.position, 'flesh'); G.particles.dust(r.position.clone().add(V(0, 0.2, 0)), 14, 1.2);
      } else land(G, s);
    }
    // keep him out of solid rock whatever happens: sliding down the wall, no limb goes into it
    if (f.phase === 'drop' && clearOfRock(s, f.n, true)) { f.vel.x = f.vel.z = 0; }
  } else if (f.phase === 'pinned') {
    clearOfRock(s, f.n); // the pose settles into the splayed one over a few frames: keep the arms and head out of the rock
    // a beat stuck to the rock, then he peels off and drops
    if (f.t > 0.28) { f.phase = 'drop'; f.vel = f.n.clone().multiplyScalar(1.2); f.spin = 2.5; f.axis = V(0, 1, 0).cross(f.n).normalize(); }
  }
  return true;
}

function smash(G, s, at, n) {
  const f = s.fly, r = s.root;
  n = n.clone(); n.y = Math.max(-0.2, Math.min(0.4, n.y)); n.normalize();
  const speed = f.vel.length();
  // splayed against the wall, back to the rock
  r.position.add(at.clone().addScaledVector(n, 0.3).sub(r.localToWorld(V(0, 0.9, 0))));
  r.lookAt(r.position.clone().add(n)); r.rotateX(-0.25);
  r.updateMatrixWorld(true);
  f.phase = 'pinned'; f.t = 0; f.n = n; f.wall = true; f.vel.set(0, 0, 0);
  s.play('sad_pose', 0.05);
  clearOfRock(s, n);
  G.audio.impact(at, 'rock'); G.audio.impact(at, 'flesh');
  G.audio.crunch?.(at);
  G.audio.stomp(at, 0.6);
  G.audio.boom?.('impact', 0.9);
  G.gore?.gore?.(at, n, 160, 4); G.particles.blood(at, n, 90, 4);
  G.particles.dust(at, 30, 1.2);
  if (G.decals) G.decals.add(V(at.x, floorHeightAt(at.x, at.z) + 0.02, at.z).addScaledVector(n, 0.8), 0.9);
  const d = G.player.pos.distanceTo(at);
  G.player.shake = Math.max(G.player.shake, Math.min(1.2, 14 / (d + 6)) * Math.min(1, speed / 10));
  G.haptic?.([50, 30, 90]);
  if (G.swatCam?.s === s) G.swatCam.impactAt = G.realTime;
}

function land(G, s) {
  const f = s.fly, r = s.root;
  f.phase = 'down'; f.vel.set(0, 0, 0);
  // crumpled on his back where he fell
  const yaw = Math.atan2(r.matrixWorld.elements[8], r.matrixWorld.elements[10]);
  r.rotation.set(0, yaw, 0); r.rotateX(-Math.PI / 2);
  r.position.y = floorHeightAt(r.position.x, r.position.z) + 0.12;
  s.play('sad_pose', 0.05); s.mixer.update(0.3); // he is no longer updated once dead: settle the pose now
  clearOfRock(s, f.n, true);
  G.audio.impact(r.position, 'flesh');
  G.particles.dust(r.position.clone().add(V(0, 0.2, 0)), 16, 1.2);
  G.particles.blood(r.position.clone().add(V(0, 0.3, 0)), V(0, 1, 0), 20, 1.5);
  s.alive = false; s.state = 'dead'; s.fly = null;
  if (s.torchLight) s.torchLight.intensity = 0;
  G.eaten = (G.eaten || 0) + 1;
  if (G.swatCam?.s === s && !G.swatCam.impactAt) G.swatCam.impactAt = G.realTime;
}

// push a man's whole body (head, hands, feet...) out of the rock it has sunk into. dir: preferred way out
// (the wall normal); without one, or when it doesn't help, the rock's own gradient. flatOnly keeps him at his height.
// returns true if he had to be moved
const _parts = ['head', 'neck', 'spine2', 'hips', 'lHand', 'rHand', 'lFore', 'rFore', 'lFoot', 'rFoot', 'lShin', 'rShin', 'lShoulder', 'rShoulder'];
function clearOfRock(s, dir = null, flatOnly = false) {
  const r = s.root, b = s.bmap || {};
  const pts = _parts.map((k) => b[k]).filter(Boolean);
  const MARGIN = -0.1, STEP = 0.05;
  let moved = false;
  for (let i = 0; i < 40; i++) {
    r.updateMatrixWorld(true);
    let worst = null, wv = MARGIN;
    const w = V(0, 0, 0);
    for (const bone of pts) {
      bone.getWorldPosition(w);
      if (w.y < floorHeightAt(w.x, w.z) + 0.25) continue; // lying on the floor is not being in the wall
      const f = rockField(w.x, w.y, w.z); if (f > wv) { wv = f; worst = w.clone(); }
    }
    if (!worst) break;
    let out = dir ? dir.clone() : null;
    if (!out || i > 12) { // way out along the rock's gradient (downhill in the field)
      const e = 0.15, { x, y, z } = worst;
      out = V(rockField(x - e, y, z) - rockField(x + e, y, z), rockField(x, y - e, z) - rockField(x, y + e, z), rockField(x, y, z - e) - rockField(x, y, z + e));
    }
    if (flatOnly) out.y = 0;
    if (out.lengthSq() < 1e-8) break;
    r.position.addScaledVector(out.normalize(), STEP);
    moved = true;
  }
  if (moved) r.updateMatrixWorld(true);
  return moved;
}

// ---------------------------------------------------------------- the special shot
// the hand shot owns the camera until the first man is thrown, then the same shot follows him
const wantsStar = (G) => !G.swatCam || (G.swatCam.hand && G.swatCam.on);

// before the blow: frame the swinging hand and the man it is about to hit (world still at full speed)
function startHandCam(G, target, a) {
  const cam = G.camera;
  G.swatCam = { s: null, hand: true, target, a, w: 0, on: true, t0: G.realTime, impactAt: 0, pos: cam.position.clone(), look: target.root.position.clone().add(V(0, 1, 0)), lock: !G.player.locked };
  if (G.swatCam.lock) G.player.locked = true;
}

function startSwatCam(G, s) {
  const cam = G.camera, c = G.swatCam;
  if (c?.hand) { c.hand = false; c.s = s; c.t0 = G.realTime; G.swatSlow = true; return; } // keep the shot going, now on him
  G.swatCam = { s, w: 0, on: true, t0: G.realTime, impactAt: 0, pos: cam.position.clone(), look: s.root.position.clone().add(V(0, 1, 0)), lock: !G.player.locked };
  if (G.swatCam.lock) G.player.locked = true;
  G.swatSlow = true;
}

function endSwatCam(G) {
  const c = G.swatCam; if (!c || !c.on) return;
  c.on = false; G.swatSlow = false;
  if (c.lock) G.player.locked = false;
}

// real-time (runs at full speed while the world crawls). called after the player placed the camera
export function updateSwatCam(G, dtReal) {
  const c = G.swatCam; if (!c) return false;
  const s = c.s, now = G.realTime;
  // hold the slow motion through the flight and a moment after the impact, then let go
  if (c.on && ((c.impactAt && now - c.impactAt > 1.1) || now - c.t0 > 6)) endSwatCam(G);
  c.w = THREE.MathUtils.clamp(c.w + (c.on ? dtReal / 0.25 : -dtReal / 0.6), 0, 1);
  if (!c.on && c.w <= 0) { G.swatCam = null; return false; }
  if (c.hand) return handShot(G, c, dtReal);
  // after the impact the world snaps back to speed for the crunch, then slows again briefly
  if (c.impactAt) G.swatSlow = c.on && now - c.impactAt > 0.12;
  // alongside and a little behind him, looking at him and where he is going
  const body = s.root.localToWorld(V(0, 0.9, 0));
  const v = s.fly?.vel && s.fly.vel.lengthSq() > 0.5 ? s.fly.vel.clone() : null;
  const dir = v ? flat(v).normalize() : flat(body.clone().sub(G.cy.root.position)).normalize();
  const side = V(0, 1, 0).cross(dir).normalize();
  const sd = c.side ||= (side.dot(G.camera.position.clone().sub(body)) >= 0 ? 1 : -1);
  let want = body.clone().addScaledVector(dir, -3.2).addScaledVector(side, 3.4 * sd).add(V(0, 1.4, 0));
  if (c.impactAt) want = body.clone().addScaledVector(dir, -5).addScaledVector(side, 4 * sd).add(V(0, 1.8, 0)); // pull back to see the wall
  // never inside rock: pull toward him until clear
  for (let i = 0; i < 6 && (rockField(want.x, want.y, want.z) > -0.4 || G.physics.raycastSegment(body, want)); i++) want.lerp(body, 0.3);
  const fy = floorHeightAt(want.x, want.z); if (want.y < fy + 0.6) want.y = fy + 0.6;
  const k = Math.min(1, dtReal * (c.impactAt ? 3 : 7));
  c.pos.lerp(want, c.w < 1 ? 1 : k);
  const lookWant = body.clone().addScaledVector(v ? v.clone().normalize() : dir, c.impactAt ? 0 : 1.2);
  c.look.lerp(lookWant, Math.min(1, dtReal * 9));
  const cam = G.camera, from = cam.position.clone(), fq = cam.quaternion.clone();
  const e = c.w * c.w * (3 - 2 * c.w);
  cam.position.lerpVectors(from, c.pos, e);
  cam.lookAt(c.look);
  cam.quaternion.copy(fq.slerp(cam.quaternion.clone(), e));
  cam.fov = THREE.MathUtils.lerp(cam.fov, 58, e); cam.updateProjectionMatrix();
  return true;
}

// low and outside the sweep, a little ahead of the man: the back of the hand comes across the floor at him
function handShot(G, c, dtReal) {
  const cy = G.cy, man = c.target.root.position.clone().add(V(0, 1, 0)), hand = cy.handWorld('R');
  const out = flat(man.clone().sub(cy.root.position)).normalize();
  const tg = V(Math.cos(c.a), 0, -Math.sin(c.a)); // the way the hand is travelling
  let want = man.clone().addScaledVector(out, 6.5).addScaledVector(tg, 3).add(V(0, 1.6, 0));
  for (let i = 0; i < 6 && (rockField(want.x, want.y, want.z) > -0.4 || G.physics.raycastSegment(man, want)); i++) want.lerp(man, 0.3);
  const fy = floorHeightAt(want.x, want.z); if (want.y < fy + 0.6) want.y = fy + 0.6;
  c.pos.lerp(want, c.w < 1 ? 1 : Math.min(1, dtReal * 4));
  c.look.lerp(man.clone().lerp(hand, 0.45), Math.min(1, dtReal * 8));
  const cam = G.camera, fq = cam.quaternion.clone(), e = c.w * c.w * (3 - 2 * c.w);
  cam.position.lerp(c.pos, e);
  cam.lookAt(c.look);
  cam.quaternion.copy(fq.slerp(cam.quaternion.clone(), e));
  cam.fov = THREE.MathUtils.lerp(cam.fov, 62, e); cam.updateProjectionMatrix();
  return true;
}

export { SLOW as SWAT_SLOW };
