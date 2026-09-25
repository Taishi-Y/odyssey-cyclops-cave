import * as THREE from 'three';
import { assault, squadActive } from './crewfight.js';
import { voiceKey } from './voices.js';

// The crew as one squad. A leader (Eurylochus, then Perimedes, Polites... whoever still stands) watches the giant
// and ROARS orders; the men obey together:
//   regroup  : close ranks in two rows at a safe distance, facing him
//   attack   : everyone charges at once, each from his own bearing, so they surround his legs
//   flank    : bait team draws his eye from the front, hammer team circles behind and takes his legs
//   scatter  : split into two groups running to opposite sides, so one grab can only get one man
//   fallback : sprint back as a group to a rally point far from him, then regroup
// The player (Odysseus) can give orders too: G = attack, R = scatter.
// Orders are baked by tools/crew_orders.py into assets/voice/orders/ and play much louder than anything else.

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const flat = (v) => V(v.x, 0, v.z);
const R = (a, b) => a + Math.random() * (b - a);
const BASE = (import.meta.env?.BASE_URL || '/') + 'assets/voice/orders/';
const LEADERS = ['Eurylochus', 'Perimedes', 'Polites', 'Lycus', 'Megon', 'Aristo', 'Elpenor', 'Antiphus', 'Theon'];
const LEADER_VOICE = { Eurylochus: 'crewC', Perimedes: 'crewD' };
const SUB = {
  attack: 'All together! Attack! Go for his legs!',
  flank: 'Split up! Half draw his eye, the rest hit him from behind!',
  scatter: 'Scatter! Don\'t bunch up!',
  fallback: 'Fall back! Get out of his reach!',
  regroup: 'On me! Form up!',
};
const LOUD = 2.8; // orders sit well above every other sound

// ---------------------------------------------------------------- audio
async function loadOrders(A) {
  try { A.orderManifest = await (await fetch(BASE + 'manifest.json')).json(); } catch (e) { console.warn('order voices missing', e); return; }
  A.orderBufs = {};
  const files = [...Object.values(A.orderManifest.orders).flat(), ...A.orderManifest.ack].map((x) => x.f);
  await Promise.all(files.map(async (f) => {
    try { A.orderBufs[f] = await A.ctx.decodeAudioData(await (await fetch(BASE + f)).arrayBuffer()); } catch (e) { /* skip */ }
  }));
}

function playBuf(A, b, { pos = null, vol = 1, when = 0, wet = 0.2, rate = 1, voice = null } = {}) {
  const ctx = A.ctx;
  if (voice != null) when = Math.max(when, (A.voiceFreeAt?.(voice) || 0) - ctx.currentTime); // never over his own voice
  const t = ctx.currentTime + when;
  if (voice != null) A.claimVoice?.(voice, t, b.duration / rate);
  const { pan } = pos ? A.spatial(pos) : { pan: 0 };
  const s = ctx.createBufferSource(); s.buffer = b; s.playbackRate.value = rate;
  const g = ctx.createGain(); g.gain.value = vol; // no distance falloff: a shouted order carries across the whole cave
  s.connect(g); A.out(g, wet, pan * 0.3); s.start(t);
  s.onended = () => g.disconnect();
  return b.duration / rate;
}

// the order in the leader's own voice (any leader take if we have none for him). returns its length in seconds
function shoutOrder(G, order, voice, pos) {
  const A = G.audio; if (!A.ctx || !A.orderBufs) return 1.2;
  const all = A.orderManifest.orders[order] || [];
  const mine = all.filter((x) => x.v === voice && A.orderBufs[x.f]);
  const pool = mine.length ? mine : all.filter((x) => x.v !== 'odysseus' && A.orderBufs[x.f]);
  if (!pool.length) return 1.2;
  const fresh = pool.filter((x) => x.f !== A._lastOrder?.[order]);
  const pick = (fresh.length ? fresh : pool)[(Math.random() * (fresh.length || pool.length)) | 0];
  (A._lastOrder ||= {})[order] = pick.f;
  return playBuf(A, A.orderBufs[pick.f], { pos, vol: LOUD, wet: 0.22, voice });
}

// now and then one man roars back ("YES!!", "TOGETHER!!") in their own voices, each a different word, loosely timed
function acknowledge(G, leader, delay) {
  const A = G.audio; if (!A.ctx || !A.orderBufs) return;
    const men = G.soldiers.filter((s) => s.alive && s !== leader && s.state === 'fight')
    .sort(() => Math.random() - 0.5).slice(0, Math.random() < 0.5 ? 2 : 3);
  const used = new Set(), leaderV = leader ? voiceKey(LEADER_VOICE[leader.name] || 'crewC') : 'odysseus';
  let t = delay + R(0, 0.4);
  for (const s of men) {
    if (voiceKey(s.voice) === leaderV) continue;
    if ((A.voiceFreeAt?.(s.voice) || 0) > A.ctx.currentTime + t) continue;
    const ok = (x) => A.orderBufs[x.f] && !used.has(x.t);
    const mine = A.orderManifest.ack.filter((x) => x.v === s.voice && ok(x));
    const pool = mine.length ? mine : A.orderManifest.ack.filter(ok);
    if (!pool.length) return;
    const x = pool[(Math.random() * pool.length) | 0]; used.add(x.t);
    const d = playBuf(A, A.orderBufs[x.f], { pos: s.root.position.clone().setY(s.root.position.y + 1.6), vol: 1.3, when: t, wet: 0.35, voice: s.voice });
    t += d + R(0.2, 0.9);
  }
}

// ---------------------------------------------------------------- geometry
// a walkable point at bearing `ang` / radius `rad` from c (shrinks and swings the bearing until one is free)
function freeSpot(G, c, ang, rad) {
  const nav = G.nav.man;
  for (const k of [1, 0.85, 0.7, 0.55, 0.4]) {
    for (const da of [0, 0.3, -0.3, 0.6, -0.6, 1, -1]) {
      const x = c.x + Math.sin(ang + da) * rad * k, z = c.z + Math.cos(ang + da) * rad * k;
      if (nav.clear(x, z)) return V(x, 0, z);
    }
  }
  return V(c.x + Math.sin(ang) * rad * 0.4, 0, c.z + Math.cos(ang) * rad * 0.4);
}

const bearing = (from, to) => Math.atan2(to.x - from.x, to.z - from.z);

function centroid(men) {
  const c = V(0, 0, 0); for (const s of men) c.add(flat(s.root.position));
  return men.length ? c.divideScalar(men.length) : c;
}

// ---------------------------------------------------------------- brain
function pickLeader(men) {
  for (const n of LEADERS) { const s = men.find((m) => m.name === n); if (s) return s; }
  return men[0] || null;
}

export function issueOrder(G, order, { byPlayer = false } = {}) {
  const sq = G.squad; if (!sq) return;
  const men = G.soldiers.filter((s) => s.alive && s.state === 'fight');
  if (!men.length) return;
  if (G.cyState.mode === 'blind' && (order === 'attack' || order === 'flank')) order = 'scatter'; // nobody charges a blind, flailing giant
  const cp = flat(G.cy.root.position);
  const c = centroid(men);
  const h = G.cy.root.rotation.y; // the giant faces +Z rotated by this
  sq.order = order; sq.since = 0; sq.byPlayer = byPlayer; sq.hold = byPlayer ? 9 : 0;
  sq.len = R(0, 1);
  // number the men round the giant by bearing; alternate teams so each team is spread all round him
  men.sort((a, b) => bearing(cp, a.root.position) - bearing(cp, b.root.position));
  men.forEach((s, i) => { s.sq = i; s.team = i % 2; s.fp = null; s.swing = null; s.post = null; });
  const out = bearing(cp, c.lengthSq() ? c : cp.clone().add(V(0, 0, 1)));
  if (order === 'regroup' || order === 'fallback') {
    const d = order === 'fallback' ? 17 : Math.max(12, flat(c).distanceTo(cp));
    sq.rally = freeSpot(G, cp, out, d);
  }
  if (order === 'scatter') sq.scatter = [out + 1.35, out - 1.35];
  if (order === 'flank') sq.front = h; // bait in front of his face, hammer behind his heels
  // shout it
  const leader = byPlayer ? null : sq.leader;
  const who = byPlayer ? 'Odysseus' : leader?.name || '';
  const pos = byPlayer ? G.player.pos.clone().setY(G.player.pos.y + 1.6) : leader?.root.position.clone().setY(leader.root.position.y + 1.6);
  const voice = byPlayer ? 'odysseus' : LEADER_VOICE[leader?.name] || 'crewC';
  const dur = shoutOrder(G, order, voice, pos);
  acknowledge(G, leader, Math.min(dur, 2.2) + 0.1);
  G.say(SUB[order], Math.max(2.2, dur + 0.5), who);
  G._barkAny = Math.max(G._barkAny || 0, G.time + 3); // no panic barks right after an order
  if (leader) { leader.shoutT = Math.min(dur, 2.5); }
}

// leader AI + player orders. call once per frame before the soldiers move
export function updateSquad(G, dt) {
  const A = G.audio;
  if (A.ctx && !A._ordersLoading) A._ordersLoading = loadOrders(A);
  const sq = (G.squad ||= { order: null, since: 0, hold: 0 });
  const I = G.input;
  const on = squadActive(G);
  if (!on) { sq.order = null; return; }
  const men = G.soldiers.filter((s) => s.alive && s.state === 'fight');
  if (!men.length) { sq.order = null; return; }
  sq.leader = pickLeader(men);
  sq.since += dt; sq.hold -= dt;
  for (const s of men) if (s.shoutT > 0) s.shoutT -= dt;
  // Odysseus gives the order himself
  if (!G.player.dead && !G.player.locked) {
    if (I.pressed('KeyG')) return issueOrder(G, 'attack', { byPlayer: true });
    if (I.pressed('KeyR')) return issueOrder(G, 'scatter', { byPlayer: true });
  }
  const st = G.cyState, cp = flat(G.cy.root.position), c = centroid(men);
  const blind = st.mode === 'blind';
  // he is reaching / walking over to take someone: get out of his way. once he has a man in his fist, go and save him
  const held = G.soldiers.some((m) => m.alive && m.state === 'grabbed');
  const threat = st.grabbing || (G._eating && !held);
  const closeIn = flat(c).distanceTo(cp) < 7;
  const o = sq.order;
  if (!o) return issueOrder(G, 'regroup');
  // a grab or his whole bulk bearing down on the knot of men overrides anything, even a player order
  if ((threat || (closeIn && (o === 'regroup' || o === 'fallback'))) && o !== 'scatter' && sq.since > 1.2) return issueOrder(G, 'scatter');
  if (sq.hold > 0) return;
  if (!blind && st.stun > 0 && o !== 'attack' && sq.since > 1) return issueOrder(G, 'attack'); // eye hit: he reels, everyone in NOW
  if (!blind && held && o !== 'attack' && o !== 'flank' && sq.since > 1.5) return issueOrder(G, 'attack'); // he's eating one of us: hack his legs till he drops him
  switch (o) {
    case 'scatter': if (sq.since > 5 + sq.len * 2 && !threat) issueOrder(G, blind ? 'regroup' : 'fallback'); break;
    case 'fallback': if (sq.since > 5 + sq.len * 2) issueOrder(G, 'regroup'); break;
    case 'regroup': if (!blind && sq.since > 6 + sq.len * 4) issueOrder(G, Math.random() < 0.55 ? 'flank' : 'attack'); break;
    case 'attack': case 'flank': if (sq.since > 11 + sq.len * 5 && !held) issueOrder(G, 'fallback'); break;
  }
}

// ---------------------------------------------------------------- one man following the order
// returns { target, speed, anim } for the shared mover in game.updateSoldiers
export function squadStep(G, s, dt) {
  const sq = G.squad, st = G.cyState, r = s.root;
  const cp = flat(G.cy.root.position);
  const away = flat(r.position).sub(cp); const dist = away.length(); away.normalize();
  const blind = st.mode === 'blind';
  // the hand is coming down right next to me: everyone for himself for a moment
  if (st.grabbing && dist < 9 && s.fp !== 'dodge') { s.fp = 'dodge'; s.fT = R(1.5, 2.5); s.swing = null; }
  if (s.fp === 'dodge') {
    s.fT -= dt;
    if (s.fT > 0 && dist < 14) return { target: r.position.clone().addScaledVector(away, 4), speed: 4.8, anim: 'run' };
    s.fp = null;
  }
  const order = sq?.order || 'regroup';
  const n = Math.max(1, G.soldiers.filter((m) => m.alive && m.state === 'fight').length);
  const i = s.sq ?? 0;
  const face = () => { const d = cp.clone().sub(flat(r.position)); let dh = Math.atan2(d.x, d.z) - r.rotation.y; dh = Math.atan2(Math.sin(dh), Math.cos(dh)); r.rotation.y += dh * Math.min(1, dt * 5); };
  // stand at a post (re-picked every ~0.5 s as he moves); face him once there
  const hold = (make, run = true) => {
    s.postT = (s.postT || 0) - dt;
    // once settled, ignore small drifts of the post (he shuffles a step, the spot slides 1-2 m): re-posting on every
    // re-pick made the men run a few steps, stop, run again every half second
    if (!s.post || s.postT < 0) { const p = make(); if (!s.post || !s.atPost || flat(p).distanceTo(flat(s.post)) > 2.5) s.post = p; s.postT = 0.5; }
    const d = flat(r.position).distanceTo(s.post);
    s.atPost = d < (s.atPost ? 1.4 : 0.7);
    if (!s.atPost) return { target: s.post, speed: run || d > 5 ? 4.3 : 1.6, anim: run || d > 5 ? 'run' : 'walk' };
    face();
    return { target: null, anim: blind ? 'sneak_pose' : 'idle' };
  };
  switch (order) {
    case 'attack': {
      if (s.sword) return assault(G, s, dt, (s.sqAng ??= (i / n) * Math.PI * 2 + R(-0.2, 0.2)));
      return hold(() => freeSpot(G, cp, G.cy.root.rotation.y + (s.team ? 0.5 : -0.5), 7.5)); // torch men wave fire in his face
    }
    case 'flank': {
      const front = sq.front ?? G.cy.root.rotation.y;
      if (s.sword && s.team === 1) {
        // hammer: circle round to his heels first, then go in
        const behind = front + Math.PI + (i / n - 0.5) * 1.2;
        if (!s.flanked) {
          const p = freeSpot(G, cp, behind, 8);
          if (flat(r.position).distanceTo(p) > 1.5 && Math.abs(Math.atan2(Math.sin(bearing(cp, r.position) - behind), Math.cos(bearing(cp, r.position) - behind))) > 0.6)
            return { target: p, speed: 4.3, anim: 'run' };
          s.flanked = true;
        }
        return assault(G, s, dt, behind);
      }
      s.flanked = false;
      return hold(() => freeSpot(G, cp, front + (i / n - 0.5) * 1.4, 8.5)); // bait: in his face, just out of reach
    }
    case 'scatter': {
      s.flanked = false; s.sqAng = null;
      const dir = (sq.scatter || [0, Math.PI])[s.team] + (((i >> 1) % 3) - 1) * 0.3;
      return hold(() => freeSpot(G, cp, dir, 15));
    }
    case 'fallback': case 'regroup': default: {
      s.flanked = false; s.sqAng = null;
      const rally = sq.rally || freeSpot(G, cp, bearing(cp, r.position), 12);
      // two rows facing him, 1.3 m apart
      const f = cp.clone().sub(rally).normalize(), side = V(f.z, 0, -f.x);
      const perRow = Math.ceil(n / 2), row = i < perRow ? 0 : 1, col = (row ? i - perRow : i) - (perRow - 1) / 2;
      const slot = rally.clone().addScaledVector(side, col * 1.3).addScaledVector(f, -row * 1.4);
      return hold(() => (G.nav.man.clear(slot.x, slot.z) ? slot : rally.clone()), order === 'fallback' || flat(r.position).distanceTo(slot) > 5);
    }
  }
}

// the leader throws his sword arm up while he shouts (after the mixer has posed him)
export function poseLeader(G) {
  const L = G.squad?.leader;
  if (!L || !(L.shoutT > 0) || L.state !== 'fight' || L.fp === 'strike') return;
  const b = L.bmap; if (!b?.rArm || !b?.rFore) return;
  const w = Math.min(1, L.shoutT * 3);
  const fwd = V(0, 0, 1).applyQuaternion(L.root.quaternion);
  const up = V(0, 1, 0).addScaledVector(fwd, 0.35).normalize();
  for (const [bone, child] of [[b.rArm, b.rFore], [b.rFore, b.rHand]]) {
    if (!bone || !child) continue;
    const a = bone.getWorldPosition(V(0, 0, 0)), c = child.getWorldPosition(V(0, 0, 0)).sub(a).normalize();
    const ang = Math.acos(THREE.MathUtils.clamp(c.dot(up), -1, 1)); if (ang < 1e-3) continue;
    const axis = c.clone().cross(up).normalize();
    const pq = bone.parent.getWorldQuaternion(new THREE.Quaternion());
    const q = new THREE.Quaternion().setFromAxisAngle(axis, ang * w);
    const wq = bone.getWorldQuaternion(new THREE.Quaternion()).premultiply(q);
    bone.quaternion.copy(pq.invert().multiply(wq));
    bone.updateMatrixWorld(true);
  }
}
