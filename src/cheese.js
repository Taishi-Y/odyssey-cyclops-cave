import * as THREE from 'three';
import { Poser, mapBones } from './rig.js';
import { floorHeightAt } from './cave.js';

// Before the giant comes home one man (Elpenor, the glutton) squats under the lit sacks tearing at the cheese
// and stuffing his mouth with both hands. The rest just hang about round him: standing, shifting, looking at the
// sacks, the sheep, each other. Pure intro flavour: it ends the moment they are told to hide.

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const R = (a, b) => a + Math.random() * (b - a);
const CENTER = V(2, 0, -2); // chamber centre: "out from the wall" points toward it
const chunkMat = new THREE.MeshStandardMaterial({ color: 0xe0cc8a, roughness: 0.6 });
const EATER = 'Elpenor';

function chunk() { // a broken-off wedge of cheese
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.07, 10, 1, false, 0, 1.4), chunkMat);
  m.castShadow = true;
  return m;
}
function hold(G, s, bone) {
  if (!bone) return null;
  const c = chunk(); s.root.updateMatrixWorld(true); bone.getWorldPosition(c.position);
  G.scene.add(c); bone.attach(c); c.position.set(0, 0.06, 0.03);
  return c;
}

export function setupCheeseCrew(G, clear) {
  const W = G.world;
  // the wheels stacked under the lit sacks are the spot everyone gathers round
  const pile = W.cheeseWheels?.length ? W.cheeseWheels.reduce((c, w) => c.add(w.position), V(0, 0, 0)).divideScalar(W.cheeseWheels.length) : V(19.6, 0, -11.8);
  const toC = Math.atan2(CENTER.z - pile.z, CENTER.x - pile.x);
  const others = G.soldiers.filter((s) => s.name !== EATER);
  const place = (s, x, z, look) => {
    [x, z] = clear(x, z);
    s.home = V(x, floorHeightAt(x, z), z);
    s.root.position.copy(s.home);
    s.root.rotation.y = Math.atan2(look.x - x, look.z - z);
  };
  const eater = G.soldiers.find((s) => s.name === EATER);
  if (eater) {
    const a = toC;
    place(eater, pile.x + Math.cos(a) * 1.1, pile.z + Math.sin(a) * 1.1, pile);
    const b = eater.bmap || mapBones(eater.root);
    eater.chore = { kind: 'eat', t: 0, look: pile.clone(), poser: new Poser(eater.root, b), chunks: [hold(G, eater, b.lHand)].filter(Boolean) };
  }
  // two men fumble at the rope knots of the lowest lit sacks, trying to untie them
  const lit = (W.cheeseSacks || []).filter((k) => k.knot.x > 7 && k.knot.x < 21 && k.knot.z < -11)
    .sort((a, b) => a.knot.y - 0.9 * a.sc - (b.knot.y - 0.9 * b.sc));
  const untiers = others.filter((s) => !s.cower).slice(0, Math.min(2, lit.length));
  untiers.forEach((s, k) => {
    const sack = lit[k], out = CENTER.clone().sub(sack.knot).setY(0).normalize();
    place(s, sack.knot.x + out.x * 0.5, sack.knot.z + out.z * 0.5, sack.knot);
    s.chore = { kind: 'untie', t: R(0, 3), look: sack.knot.clone(), sack, poser: new Poser(s.root, s.bmap || mapBones(s.root)) };
  });
  const crowd = others.filter((s) => !untiers.includes(s));
  // the rest stand about in a loose crowd on the open side, 2.5 to 6 m off, facing roughly toward him
  crowd.forEach((s, k) => {
    const a = toC + (k / Math.max(1, crowd.length - 1) - 0.5) * 3.2 + R(-0.15, 0.15), rad = R(2.6, 6);
    const x = pile.x + Math.cos(a) * rad, z = pile.z + Math.sin(a) * rad;
    place(s, x, z, pile);
    s.root.rotation.y += R(-0.6, 0.6);
    s.chore = { kind: 'idle', t: R(0, 5), next: R(2, 7), look: null };
  });
}

// game start: everyone begins bunched round Odysseus and dashes off to the cheese on the back wall
export function startCheeseRun(G, clear) {
  const P = G.player.pos, fwd = V(-Math.sin(G.player.yaw), 0, -Math.cos(G.player.yaw));
  const n = G.soldiers.length;
  G.soldiers.forEach((s, k) => {
    if (!s.chore) return;
    // a loose half ring beside and ahead of him (not behind the camera, not in its face)
    const a = Math.atan2(fwd.z, fwd.x) + (k / Math.max(1, n - 1) - 0.5) * 3.6 + R(-0.2, 0.2), rad = R(1.8, 4);
    const [x, z] = clear(P.x + Math.cos(a) * rad, P.z + Math.sin(a) * rad);
    s.root.position.set(x, floorHeightAt(x, z), z);
    s.root.rotation.y = Math.atan2(s.home.x - x, s.home.z - z);
    s.path = null; s.goal = null;
    s.chore.delay = R(0.1, 0.9);
    s.chore.rush = R(3.4, 4.3);
  });
}

// movement for this frame while the chore lasts
export function cheeseStep(G, s, dt) {
  const c = s.chore; if (!c) return { target: null, anim: 'idle' };
  c.t += dt;
  const r = s.root;
  if (c.delay > 0) { c.delay -= dt; return { target: null, anim: 'idle' }; } // a beat before he breaks into a run
  const far = r.position.distanceTo(s.home);
  if (far > 0.6) return far > 2.5 && c.rush ? { target: s.home, speed: c.rush, anim: 'run' } : { target: s.home, speed: 1.1, anim: 'walk' };
  c.rush = 0; // arrived: from here on he just shuffles
  if (c.kind === 'idle') {
    // every few seconds glance somewhere else: the sacks, the eater, the flock, a mate, the way they came in
    if (c.t > c.next) {
      c.t = 0; c.next = R(3, 8);
      const pick = Math.random();
      const mates = G.soldiers.filter((m) => m !== s && m.alive), mate = mates[(Math.random() * mates.length) | 0]?.root.position || null;
      c.look = pick < 0.35 ? G.world.cheeseWheels?.[0]?.position || null : pick < 0.55 ? G.flock?.center || mate : pick < 0.85 ? mate : V(3, 0, 12);
    }
    if (!c.look) return { target: null, anim: 'idle' };
  }
  const L = c.look || s.home;
  let dh = Math.atan2(L.x - r.position.x, L.z - r.position.z) - r.rotation.y; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
  if (Math.abs(dh) > 0.05) r.rotation.y += dh * Math.min(1, dt * (c.kind === 'idle' ? 1.5 : 4));
  return { target: null, anim: c.kind === 'eat' ? 'm_crouch_idle' : 'idle' };
}

// arms (IK) on top of the clip for the eater. call after the mixer has posed him
export function poseCheese(G, s, t) {
  const c = s.chore; if (!c || c.kind === 'idle') return;
  const r = s.root, p = c.poser, b = p.b;
  if (r.position.distanceTo(s.home) > 0.6 || !b.head) return;
  r.updateMatrixWorld(true);
  if (c.kind === 'untie') {
    // both hands at the knot under the peg, picking at it: small quick circles, out of step with each other,
    // now and then a harder tug down on the sack
    const k = c.sack.knot, sc = c.sack.sc, side = V(Math.cos(r.rotation.y), 0, -Math.sin(r.rotation.y));
    const neck = V(k.x, k.y - 0.08 * sc, k.z);
    const tug = (c.t % 4.5) < 0.5 ? Math.sin(((c.t % 4.5) / 0.5) * Math.PI) * 0.12 : 0;
    const f = t * 7 + c.t;
    const lh = neck.clone().addScaledVector(side, 0.06 + Math.cos(f) * 0.025).add(V(0, Math.sin(f) * 0.03 - tug, 0));
    const rh = neck.clone().addScaledVector(side, -0.06 - Math.cos(f * 1.3 + 2) * 0.025).add(V(0, Math.sin(f * 1.3 + 2) * 0.03 - tug, 0));
    p.reach('L', lh, 1); p.reach('R', rh, 1);
    p.look(neck, 1);
    return;
  }
  // wolfing it down: quick bites, one after another
  const u = (c.t % 1.1) / 1.1, w = u < 0.3 ? Math.sin((u / 0.3) * Math.PI * 0.5) : u < 0.75 ? 1 : 1 - (u - 0.75) / 0.25;
  const fwd = V(Math.sin(r.rotation.y), 0, Math.cos(r.rotation.y));
  const mouth = b.head.getWorldPosition(V(0, 0, 0)).addScaledVector(fwd, 0.12).add(V(0, -0.07, 0));
  p.reach('L', mouth, Math.max(0, Math.min(1, w)));
  p.frame();
  if (w > 0.8) b.head.rotateX(Math.sin(t * 16) * 0.07); // chewing
  if (b.spine1) b.spine1.rotateX(0.18); // hunched over the pile
}

// intro over: drop the chunks, back on flat feet
export function endCheese(G) {
  for (const s of G.soldiers) {
    const c = s.chore; if (!c) continue;
    for (const k of c.chunks || []) k.visible = false;
    s.root.position.y = floorHeightAt(s.root.position.x, s.root.position.z);
    s.chore = null;
  }
}
