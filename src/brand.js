import * as THREE from 'three';
import { floorHeightAt } from './cave.js';
import { Fire } from './fire.js';
import { GRIP } from './player.js';

// The sleep and the blinding, shot like a film:
//  - the giant lies down with mocap (UAL2 'LayToIdle' backwards): crouch, a hand to the floor, sit, lie back,
//    then (Odyssey 9.371) "he lay on his back, his thick neck bent aside", face toward the fire
//  - the brand is a real torch resting in the fire; picking it up is a slowed, low-angle close shot
//  - driving it in: extreme slow motion, close on the eye. The lids flutter, the eye steams and chars, the point twists in
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const flat = (v) => V(v.x, 0, v.z);
const ss = THREE.MathUtils.smoothstep;
const lerp = THREE.MathUtils.lerp;
const Z = V(0, 0, 1), UP = V(0, 1, 0);

// ------------------------------------------------------------------ where he lies
// the fire beside his head, D metres from the eye; body clear of rock; room for the men between face and fire.
// bed.face = the way his face turns (eye -> fire)
export function findBed(g) {
  const F = g.world.firePos, nav = g.nav.giant, cy = g.cy, from = cy.root.position;
  const M = cy.lyingPose();
  const feet = M.lFoot.clone().add(M.rFoot).multiplyScalar(0.5);
  const axis = flat(M.head.clone().sub(feet)).normalize();          // feet -> head, root space
  const pts = [];
  for (let a = -0.1; a <= 1.1; a += 0.08) pts.push(feet.clone().lerp(M.head, a).setY(0));
  let best = null;
  for (let i = 0; i < 48; i++) {
    const yaw = i / 48 * Math.PI * 2;
    const rot = (p) => p.clone().applyAxisAngle(UP, yaw);
    for (const s of [1, -1]) {
      const side = rot(V(axis.z, 0, -axis.x).multiplyScalar(s));   // across the body, toward the fire
      for (const D of [4.2, 4.8, 5.4]) {
        const eye = F.clone().addScaledVector(side, -D);
        const root = eye.clone().sub(rot(M.eye)); root.y = 0;
        let ok = true;
        for (const p of pts) {
          const c = root.clone().add(rot(p));
          for (const o of [-1.6, 0, 1.6]) {
            const q = c.clone().addScaledVector(side, o);
            if (!nav.clear(q.x, q.z) || flat(q).distanceTo(flat(F)) < 2.2) { ok = false; break; }
          }
          if (!ok) break;
        }
        // standing room where he starts to lie down
        if (ok && !nav.clear(root.x, root.z)) ok = false;
        const gap = F.clone().addScaledVector(side, -D * 0.5);
        if (ok && !g.nav.man.clear(gap.x, gap.z)) ok = false;
        if (!ok) continue;
        const cost = root.distanceTo(from) + D * 2;
        if (!best || cost < best.cost) best = { pos: root, yaw, face: side.clone(), cost };
      }
    }
  }
  return best || { pos: V(-15, 0, -12), yaw: null, face: V(1, 0, 0) };
}

async function turnTo(g, yaw, dur = 1.2) {
  const r = g.cy.root, y0 = r.rotation.y;
  let dy = yaw - y0; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  if (Math.abs(dy) < 0.05) return;
  g.cy.play('walk', 0.3, 0.35);
  for (let t = 0; t < dur; t += 1 / 30) { await g.wait(1 / 30); r.rotation.y = y0 + dy * ss(t / dur, 0, 1); }
  r.rotation.y = y0 + dy;
  g.cy.play('idle', 0.4);
}

// mocap: he crouches, puts a hand down, sits heavily and lies back
export async function lieDown(g, yawWant = null) {
  const cy = g.cy, r = cy.root;
  cy.roll = null;
  r.rotation.order = 'YXZ'; r.rotation.x = 0; r.rotation.z = 0;
  cy.ik.R = null; cy.ik.L = null; cy.lookAt = null; cy.headLift = 0; cy.faceTurn = null;
  cy.eyeOpen = 1;
  if (yawWant != null) await turnTo(g, yawWant);
  const SPEED = 0.4;
  const a = cy.playClip('lay', { reverse: true, speed: SPEED, fade: 0.7 });
  const dur = a.getClip().duration / SPEED;
  let sat = false, laid = false;
  g.audio.sfx?.('giantBreath', { pos: cy.eyeWorld(), vol: 0.9 });
  for (let t = 0; t < dur; t += 1 / 30) {
    await g.wait(1 / 30);
    const k = t / dur;
    cy.eyeOpen = 1 - ss(k, 0.55, 1);
    const hips = cy.bones.Hips.getWorldPosition(V());
    // backside meets the floor, then the shoulders: two heavy thuds, dust
    if (!sat && k > 0.5) { sat = true; g.audio.stomp(hips, 1.3); g.player.shake = Math.max(g.player.shake, 0.8); g.particles.dust(V(hips.x, floorHeightAt(hips.x, hips.z), hips.z), 30, 5); g.haptic?.(60); }
    if (!laid && k > 0.88) {
      laid = true;
      const sp = cy.bones.Spine2.getWorldPosition(V());
      g.audio.stomp(sp, 1.6); g.player.shake = 1; g.particles.dust(V(sp.x, floorHeightAt(sp.x, sp.z), sp.z), 40, 6); g.haptic?.(90);
    }
  }
  cy.eyeOpen = 0;
  g.cyState.lying = true;
  cy.lying = true;
  await sleepPose(g, 1.6);
}

// on his back, the neck rolled aside so the face (and the eye) turn to the fire and its light
export async function sleepPose(g, dur = 0) {
  const cy = g.cy;
  const target = g.bed?.face ? cy.eyeWorld().addScaledVector(g.bed.face, 10) : g.world.firePos.clone();
  cy.lying = true;
  // the whole body rolls onto its side toward the fire (not just the neck), so the face and the eye are in plain view
  if (!cy.roll) startRoll(cy, target);
  cy.faceTurn = { target, w: dur ? 0 : 1 };
  cy.pillow = 0;
  for (let t = 0; t < dur; t += 1 / 30) { await g.wait(1 / 30); const k = ss(t / dur, 0, 1); cy.faceTurn.w = k * 0.5; applyRoll(cy, k); }
  cy.faceTurn.w = 0.5; applyRoll(cy, 1);
}

// ------------------------------------------------------------------ lying on his side
// roll the lying body about its own long axis (hips -> head) so the face turns toward target
const ROLL = 1.35; // radians: a little short of a full quarter turn, the top shoulder falls slightly forward
export function startRoll(cy, target) {
  const r = cy.root; r.updateMatrixWorld(true);
  const P = (b) => cy.bones[b].getWorldPosition(V());
  const hips = P('Hips'), head = P('Head');
  const axis = head.clone().sub(hips); axis.y = 0; axis.normalize();
  const pivot = hips.clone().lerp(head, 0.5);
  const e = cy.eyeDir(), tgt = flat(target.clone().sub(cy.eyeWorld())).normalize();
  const sgn = axis.clone().cross(e).dot(tgt) >= 0 ? 1 : -1;
  // on the back the spine rests at back-thickness; on the side it rests at shoulder half-width
  const floor = floorHeightAt(pivot.x, pivot.z);
  const halfW = P('LeftArm').distanceTo(P('RightArm')) * 0.5 + cy.height * 0.035;
  const lift = Math.max(0, halfW - (pivot.y - floor));
  cy.roll = { axis, pivot, sgn, lift, q0: r.quaternion.clone(), p0: r.position.clone(), k: 0 };
}
export function applyRoll(cy, k) {
  const R = cy.roll; if (!R) return;
  R.k = k;
  const q = new THREE.Quaternion().setFromAxisAngle(R.axis, R.sgn * ROLL * k);
  cy.root.quaternion.copy(q).multiply(R.q0);
  cy.root.position.copy(R.p0).sub(R.pivot).applyQuaternion(q).add(R.pivot);
  cy.root.position.y += R.lift * k;
}
export async function unroll(g, dur = 0.8) {
  const cy = g.cy; if (!cy.roll) return;
  const k0 = cy.roll.k;
  for (let t = 0; t < dur; t += 1 / 30) { await g.wait(1 / 30); applyRoll(cy, k0 * (1 - ss(t / dur, 0, 1))); }
  applyRoll(cy, 0); cy.roll = null;
}

// gets up off his back (the mocap forwards)
export async function standUp(g, speed = 0.55) {
  const cy = g.cy, r = cy.root;
  if (cy.faceTurn) cy.faceTurn.w = 0;
  await unroll(g);
  cy.ik.R = null; cy.ik.L = null; cy.lookAt = null; cy.headLift = 0;
  const ft = cy.faceTurn, p0 = cy.pillow || 0;
  const a = cy.playClip('lay', { speed, fade: 0.3 });
  const dur = a.getClip().duration / speed;
  for (let t = 0; t < dur; t += 1 / 30) {
    await g.wait(1 / 30);
    if (ft) ft.w = 1 - ss(t / (dur * 0.4), 0, 1);
    cy.pillow = p0 * (1 - ss(t / (dur * 0.25), 0, 1));
    if (t > dur * 0.5) cy.lying = false;
    r.rotation.x = lerp(r.rotation.x, 0, 0.1); r.rotation.z = lerp(r.rotation.z, 0, 0.1);
  }
  cy.faceTurn = null; cy.pillow = 0; cy.lying = false;
  r.rotation.x = 0; r.rotation.z = 0;
  r.position.y = floorHeightAt(r.position.x, r.position.z);
  cy.play('idle', 0.6);
  g.cyState.lying = false;
}

// ------------------------------------------------------------------ the torch in the fire
export function placeBrand(g) {
  const W = g.world, S = W.stakeLog, F = W.firePos, L = W.torchLen;
  if (!g.brandFire) {
    g._brandTip = V(0, 0, L * 0.93);
    g.brandFire = new Fire(g.scene, V(), { size: 0.32, count: 14, light: false, smoke: true, cards: 2 });
    W.updaters.push((dt, t) => updateBrand(g, dt, t));
  }
  // rag head resting on the burning logs, the handle angled down to the floor on the far side from his face
  const u = g.bed?.face ? flat(g.bed.face).normalize() : V(1, 0, 0);
  const tip = F.clone().addScaledVector(u, 0.3); tip.y = floorHeightAt(F.x, F.z) + 0.42;
  const dy = tip.y - floorHeightAt(tip.x, tip.z) - 0.06, h = Math.sqrt(Math.max(0.1, L * L - dy * dy));
  const butt = tip.clone().addScaledVector(u, h); butt.y = floorHeightAt(butt.x, butt.z) + 0.06;
  S.position.copy(butt); S.up.copy(UP); S.lookAt(tip);
  S.rotateZ(Math.random() * Math.PI * 2);
  S.visible = true;
  const log = W.interact.find((i) => i.id === 'log'); log.pos.copy(S.position); log.enabled = true;
  g._brandSpent = false; g._brandOnFloor = false;
}

// put the burning torch down on the floor in front of you (it keeps burning and lighting the rock); E picks it up again
export function dropBrand(g) {
  const P = g.player, W = g.world, S = W.stakeLog, L = W.torchLen;
  if (!P.carrying) return;
  const fwd = V(-Math.sin(P.yaw), 0, -Math.cos(P.yaw));
  const side = V(fwd.z, 0, -fwd.x);
  const butt = P.pos.clone().addScaledVector(fwd, 0.5).addScaledVector(side, -L * 0.45); butt.y = floorHeightAt(butt.x, butt.z) + 0.06;
  const tip = butt.clone().addScaledVector(side, L); tip.y = floorHeightAt(tip.x, tip.z) + 0.12;
  S.position.copy(butt); S.up.copy(UP); S.lookAt(tip);
  S.visible = true;
  P.setCarry(null);
  const log = W.interact.find((i) => i.id === 'log'); log.pos.copy(S.position); log.enabled = true;
  g._brandOnFloor = true;
  if (g.phase === 'stakeHot') g.setPhase('sleep');
}
// picking it back up off the floor: no cutscene
export function takeBrand(g) {
  const P = g.player, S = g.world.stakeLog;
  P.setCarry(S); S.visible = false; g._brandOnFloor = false; g.stakeHeat = 1;
  if (g.phase === 'sleep') g.setPhase('stakeHot');
}

// the flame on the head of the torch, wherever the torch is (in the fire, in your hand, in a cutscene)
export function brandHolder(g) {
  const P = g.player, S = g.world.stakeLog;
  if (g._brandSpent) return null;
  if (g._brandCine) return g._brandCine;
  if (P.carrying) return (P.thirdPerson || P.forceAvatar) && P.tpCarryMesh ? P.tpCarryMesh : P.carryMesh;
  return S.visible ? S : null;
}
export function updateBrand(g, dt, t) {
  const f = g.brandFire; if (!f) return;
  const o = brandHolder(g);
  f.group.visible = !!o;
  if (!o) return;
  o.updateWorldMatrix(true, false);
  o.localToWorld(f.group.position.copy(g._brandTip));
  const k = (g._brandFlare || 0);
  f.group.scale.setScalar(1 + k * 1.4);
  g._brandFlare = Math.max(0, k - dt * 1.5);
  f.update(dt, t);
}
export function brandTipWorld(g, v = V()) { const o = brandHolder(g); return o ? o.localToWorld(v.copy(g._brandTip)) : v.copy(g.world.firePos); }

// ------------------------------------------------------------------ cinematic helpers
function bars(on) {
  let el = document.getElementById('cinebars');
  if (!el) {
    el = document.createElement('div'); el.id = 'cinebars';
    el.innerHTML = '<div></div><div></div>';
    const css = document.createElement('style');
    css.textContent = '#cinebars>div{position:fixed;left:0;right:0;height:0;background:#000;z-index:40;pointer-events:none;transition:height .45s ease}#cinebars>div:first-child{top:0}#cinebars>div:last-child{bottom:0}#cinebars.on>div{height:11vh}body.cine #prompt,body.cine .hud-hide-cine{opacity:0}';
    document.head.appendChild(css); document.body.appendChild(el);
  }
  el.classList.toggle('on', on);
  document.body.classList.toggle('cine', on);
}
// real-time loop (the world may be crawling in slow motion): f(k, t, dt) each real frame for dur seconds
async function realLoop(g, dur, f) {
  const t0 = g.realTime || 0;
  let last = t0;
  for (;;) {
    await g.realFrame();
    const now = g.realTime || 0, t = now - t0;
    f(Math.min(1, t / dur), Math.min(t, dur), now - last);
    last = now;
    if (t >= dur) break;
  }
}
function aimObject(o, pos, dir, roll = 0) {
  o.quaternion.setFromUnitVectors(Z, dir);
  if (roll) o.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(dir, roll));
  o.position.copy(pos);
}

// ------------------------------------------------------------------ picking it up
// crouch beside the handle, reach, close the fist, and draw the burning head up out of the coals (slowed, low angle)
export async function pickUpBrand(g) {
  if (g._picking) return; g._picking = true;
  const P = g.player, W = g.world, S = W.stakeLog, L = W.torchLen, F = W.firePos;
  P.locked = true; P.forceAvatar = true;
  const gripOf = () => S.localToWorld(V(0, 0, L * GRIP));
  const grip0 = gripOf(), tip0 = S.localToWorld(g._brandTip.clone());
  const along = flat(tip0.clone().sub(grip0)).normalize();        // handle -> fire
  const side = V(along.z, 0, -along.x);
  // kneel on the side of the handle you came from, just back from the grip
  const s = Math.sign(flat(P.pos.clone().sub(grip0)).dot(side)) || 1;
  const kneel = grip0.clone().addScaledVector(side, 0.55 * s).addScaledVector(along, -0.25); kneel.y = floorHeightAt(kneel.x, kneel.z);
  const from = P.pos.clone();
  const faceYaw = () => { const d = grip0.clone().sub(P.pos); return Math.atan2(d.x, d.z); };
  P.scriptPose = { faceYaw: faceYaw(), crouch: false, look: grip0.clone() };
  // camera: low, on the other side of the torch, looking across the coals at his hand and face
  const camA = F.clone().addScaledVector(side, -2.6 * s).addScaledVector(along, -1.2); camA.y = floorHeightAt(camA.x, camA.z) + 0.55;
  const camB = camA.clone().addScaledVector(along, -0.5).add(V(0, 0.55, 0));
  g.camOverride = camA.clone(); g.camTarget = grip0.clone().lerp(tip0, 0.45);
  g.cineSlow = 0.55;
  bars(true);
  g.audio.sfx?.('rustle', { pos: grip0, vol: 0.6 });
  // step in and kneel, the right hand going out to the handle
  await realLoop(g, 0.9, (k) => {
    P.pos.lerpVectors(from, kneel, ss(k, 0, 0.7));
    P.scriptPose.faceYaw = faceYaw(); P.scriptPose.crouch = k > 0.3;
    P.scriptPose.reachR = gripOf(); P.scriptPose.wR = ss(k, 0.35, 1);
  });
  // the fist closes: a little shower of sparks where the head shifts in the embers
  g.audio.sfx?.('scrape', { pos: tip0, vol: 0.5, rate: 1.3 });
  g.particles.sparks(tip0, 14);
  await realLoop(g, 0.25, () => {});
  // draw it up: the head lifts out of the fire trailing sparks and falling embers, the flame blooms in the air
  const hand = () => (P.avatar?.rig ? P.avatar.rig.rHand.getWorldPosition(V()) : P.pos.clone().add(V(0, 1, 0)));
  const dir0 = tip0.clone().sub(grip0).normalize();
  const fwd = along.clone(), liftTo = () => P.pos.clone().addScaledVector(fwd, 0.45).addScaledVector(side, -0.12 * s).add(V(0, 1.35, 0));
  const upDir = fwd.clone().multiplyScalar(0.5).add(V(0, 0.84, 0)).normalize();
  let whoosh = false, nextEmber = 0;
  g.audio.sfx?.('effort', { pos: P.pos, vol: 0.6 });
  await realLoop(g, 1.5, (k, t) => {
    const e = ss(k, 0, 1);
    P.scriptPose.crouch = k < 0.55;
    P.scriptPose.reachR = grip0.clone().lerp(liftTo(), e);
    P.scriptPose.look = tip0.clone().lerp(liftTo().addScaledVector(upDir, 1.2), e);
    const dir = dir0.clone().lerp(upDir, ss(k, 0.1, 0.9)).normalize();
    const hp = hand();
    aimObject(S, hp.clone().addScaledVector(dir, -L * GRIP), dir);
    const tip = S.localToWorld(g._brandTip.clone());
    if (!whoosh && k > 0.18) {
      whoosh = true; g._brandFlare = 1;
      g.audio.sfx?.('whoosh', { pos: tip, vol: 0.9, rate: 0.7 });
      g.audio.sfx?.('sizzle', { pos: tip, vol: 0.5 });
      g.particles.sparks(tip, 40); g.particles.dust(F.clone().add(V(0, 0.3, 0)), 14, 0.8, [0.5, 0.45, 0.4, 0.3]);
    }
    if (t > nextEmber) { nextEmber = t + 0.06; g.particles.sparks(tip, 4 + (k < 0.5 ? 6 : 1)); }
    g.camOverride.lerpVectors(camA, camB, e);
    g.camTarget.copy(hp).lerp(tip, 0.55);
  });
  // now it's in your hand for good
  P.setCarry(S); S.visible = false;
  g.stakeHeat = 1; g._picking = false;
  g.cineSlow = 0; g.camOverride = null; g.camTarget = null;
  P.scriptPose = null; P.forceAvatar = false; P.locked = false;
  bars(false);
  if (g.phase === 'sleep') { g.setPhase('stakeHot'); g.say('It\'s burning. Wake that eye, then put it out', 3, 'Odysseus'); }
  else g.say('A torch. Now I can see the rock around me', 3, 'Odysseus');
}

// ------------------------------------------------------------------ into the eye
// extreme slow motion, close on the eye: the burning head comes in, the lids flutter against the heat,
// then the point goes in and he twists it like a shipwright's drill (9.384): steam, hiss, the eye cooks and darkens
export async function stabEyeCine(g) {
  const P = g.player, cy = g.cy, W = g.world, L = W.torchLen, S = W.stakeLog;
  const eye0 = cy.eyeWorld(), n = cy.eyeDir();
  const Re = cy.E.r * cy.eyeGroup.getWorldScale(V()).x;
  // approach from the player's side of the face, level
  // eye -> outward (level), the torch comes in along -a
  const a = (flat(n).lengthSq() > 0.05 ? flat(n) : flat(P.pos.clone().sub(eye0))).normalize();
  const dir = a.clone().negate().add(V(0, -0.06, 0)).normalize();
  const side = V(a.z, 0, -a.x).normalize();
  const gripAt = (tip) => tip.clone().addScaledVector(dir, -L * (0.93 - GRIP));
  const tipAt = (dist) => eye0.clone().addScaledVector(a, Re * 0.9 + dist);
  // Odysseus plants his feet behind the handle and rams it in with both hands
  const stand = () => { const gp = gripAt(tipAt(0)); const p = gp.clone().addScaledVector(a, 0.5); p.y = floorHeightAt(p.x, p.z); return p; };
  P.setCarry(null);
  P.locked = true; P.forceAvatar = true;
  P.pos.copy(stand());
  P.scriptPose = { faceYaw: Math.atan2(-a.x, -a.z), look: eye0.clone() };
  S.visible = true; g._brandCine = S;
  bars(true);
  g.cineSlow = 0.12;
  // camera: 3/4 close-up, the eye filling a good part of the frame, pushing in slowly
  const camA = eye0.clone().addScaledVector(a, 1.9).addScaledVector(side, 1.5).add(V(0, 0.35, 0));
  const camB = eye0.clone().addScaledVector(a, 0.95).addScaledVector(side, 0.8).add(V(0, 0.18, 0));
  g.camOverride = camA.clone(); g.camTarget = eye0.clone().addScaledVector(a, 0.25);
  const eyeMat = cy.eyeMesh?.material, eyeCol0 = eyeMat?.color.clone();
  if (eyeMat) { eyeMat.emissive ||= new THREE.Color(); eyeMat.emissiveIntensity = 1; }
  let roll = 0, dist = 1.5;
  const setTorch = (d, rl, jit = 0) => {
    const tip = tipAt(d).add(V((Math.random() - 0.5) * jit, (Math.random() - 0.5) * jit, (Math.random() - 0.5) * jit));
    aimObject(S, gripAt(tip), dir, rl);
    const gp = gripAt(tip);
    P.scriptPose.reachR = gp; P.scriptPose.reachL = gp.clone().addScaledVector(dir, 0.4); P.scriptPose.wR = 1; P.scriptPose.wL = 1;
    return tip;
  };
  g.audio.sfx?.('heart', { vol: 0.9 });
  // 1) the approach: heat on the eye, the lid twitches and flutters, the pupil glistens in the firelight
  let nextBlink = 0.3;
  await realLoop(g, 1.7, (k, t) => {
    dist = lerp(1.5, 0, ss(k, 0, 1) ** 1.4);
    const tip = setTorch(dist, roll);
    g.stakeGlow.position.copy(tip); g.stakeGlow.intensity = 14 + Math.random() * 4;
    g.camOverride.lerpVectors(camA, camB, ss(k, 0, 1) * 0.5);
    // twitching lids: short half-blinks, faster as the heat comes closer
    if (t > nextBlink) { nextBlink = t + lerp(0.5, 0.12, k); cy.blink = 0.5 + Math.random() * 0.4; }
    cy.eyeOpen = 1 - (Math.sin((cy.blink || 0) * Math.PI) * 0.6 * (0.4 + k));
    if (eyeMat) eyeMat.emissive.setRGB(0.5, 0.12, 0.02).multiplyScalar(k * k * 0.25);
    if (k > 0.6 && Math.random() < 0.3) g.particles.dust(tip.clone().lerp(eye0, 0.5), 1, 0.08, [0.75, 0.72, 0.7, 0.25]); // first wisps of steam
  });
  // 2) contact: hiss, a burst of steam and sparks, the body jolts
  const hit = tipAt(0);
  g.post.grade.uniforms.get('uFlash').value = 0.3;
  g.audio.sfx?.('sizzle', { pos: hit, vol: 1.4, rate: 0.8 });
  g.audio.sfx?.('squelch', { pos: hit, vol: 1.1, rate: 0.7 });
  g.audio.sfx?.('subdrop', { vol: 1 });
  g.audio.sizzle(true);
  g.audio.cyGroan?.(hit, { vol: 1.2 });
  g.particles.sparks(hit, 70);
  for (let i = 0; i < 26; i++) g.particles.dust(hit.clone().addScaledVector(a, 0.1), 1, 0.35, [0.85, 0.82, 0.8, 0.35]);
  g.gore.spurt?.(hit, a.clone().add(V(0, 0.5, 0)).normalize(), 0.5);
  cy.jolt = 0.8; cy.joltSide = 1;
  P.shake = 0.5; g.haptic([80, 40, 200]);
  // 3) in it goes, twisting: the lids clench and flutter round the shaft, the eye boils and blackens
  let nextSteam = 0, nextFlutter = 0, nextSpurt = 0.3;
  await realLoop(g, 2.6, (k, t, dt) => {
    const pen = lerp(0, Re * 1.8, ss(k, 0, 0.85));
    roll += dt * lerp(9, 4, k);
    const tip = setTorch(-pen, roll, 0.01);
    g.stakeGlow.position.copy(tip); g.stakeGlow.intensity = 18 + Math.random() * 6;
    g._brandFlare = Math.max(g._brandFlare || 0, 0.3);
    g.camOverride.lerpVectors(camA, camB, 0.5 + ss(k, 0, 1) * 0.5).add(V((Math.random() - 0.5) * 0.012, (Math.random() - 0.5) * 0.012, 0));
    if (t > nextFlutter) { nextFlutter = t + 0.07 + Math.random() * 0.1; cy.blink = 0.6 + Math.random() * 0.4; }
    cy.eyeOpen = 0.55 - Math.sin((cy.blink || 0) * Math.PI) * 0.35;   // can't close on the shaft: spasming half-blinks
    if (t > nextSteam) {
      nextSteam = t + 0.03;
      g.particles.dust(eye0.clone().addScaledVector(a, Re).add(V((Math.random() - 0.5) * Re, 0, (Math.random() - 0.5) * Re)), 2, 0.3, [0.8, 0.78, 0.76, 0.3]);
      if (Math.random() < 0.4) g.particles.sparks(eye0.clone().addScaledVector(a, Re * 0.8), 3);
    }
    if (t > nextSpurt) { nextSpurt = t + 0.35 + Math.random() * 0.3; g.gore.spurt?.(eye0.clone().addScaledVector(a, Re), a.clone().add(V(0, -0.3, 0)).applyAxisAngle(a, Math.random() * 6).normalize(), 0.35); }
    if (Math.random() < dt * 5) cy.jolt = Math.max(cy.jolt || 0, 0.35);
    // the eye cooks: white -> red-hot glow -> charred black
    if (eyeMat) {
      const hot = ss(k, 0, 0.45) * (1 - ss(k, 0.6, 1) * 0.6);
      eyeMat.emissive.setRGB(1, 0.28, 0.05).multiplyScalar(hot * 0.9);
      eyeMat.color.copy(eyeCol0).lerp(new THREE.Color(0.12, 0.02, 0.01), ss(k, 0.2, 1));
    }
    P.shake = Math.max(P.shake, 0.15);
  });
  // back to full speed on his shriek
  g.audio.sizzle(false);
  if (eyeMat) eyeMat.emissive.setRGB(0.25, 0.04, 0.01);
  g.cineSlow = 0; g.camOverride = null; g.camTarget = null;
  g._brandCine = null; g._brandSpent = true;
  // the torch stays behind, smoking, dropped beside his head
  const drop = eye0.clone().addScaledVector(a, 1.6); drop.y = floorHeightAt(drop.x, drop.z) + 0.06;
  aimObject(S, drop, flat(side).normalize());
  P.scriptPose = null; P.forceAvatar = false;
  bars(false);
  W.interact.find((i) => i.id === 'log').enabled = false;
}
