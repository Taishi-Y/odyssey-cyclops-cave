import { crewBark } from './voices.js';
import * as THREE from 'three';

// ============================================================================================
// Metal Gear style: Soliton radar, "!" alert, ALERT / EVASION / CAUTION phases, distractions
// GTA style: weapon wheel (slow-mo), character switch with sky-cam, mission banners
// ============================================================================================

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const flat = (v) => V(v.x, 0, v.z);

// ---------------------------------------------------------------- Soliton radar
export class Radar {
  constructor(game) {
    this.g = game;
    const wrap = document.createElement('div');
    wrap.id = 'radar';
    wrap.innerHTML = '<canvas width="360" height="360"></canvas><div class="rlabel">SOLITON</div>';
    document.getElementById('hud').appendChild(wrap);
    this.el = wrap;
    this.cv = wrap.querySelector('canvas');
    this.ctx = this.cv.getContext('2d');
    this.range = 26; // metres from centre to edge
    this.t = 0;
  }
  update(dt) {
    this.t += dt;
    const G = this.g, P = G.player, c = this.ctx, W = 360, R = W / 2;
    const jam = G.alertPhase === 'ALERT';
    this.el.classList.toggle('jam', jam);
    c.clearRect(0, 0, W, W);
    c.save();
    c.beginPath(); c.arc(R, R, R - 2, 0, Math.PI * 2); c.clip();
    c.fillStyle = jam ? 'rgba(40,0,0,0.72)' : 'rgba(0,26,20,0.66)'; c.fillRect(0, 0, W, W);
    if (jam) {
      // radar jammed during an alert (static)
      for (let i = 0; i < 900; i++) { c.fillStyle = `rgba(255,${80 + Math.random() * 60},60,${Math.random() * 0.5})`; c.fillRect(Math.random() * W, Math.random() * W, 3, 2); }
      c.restore();
      return;
    }
    // grid
    c.strokeStyle = 'rgba(80,255,190,0.12)'; c.lineWidth = 1;
    for (let i = 0; i <= 8; i++) { c.beginPath(); c.moveTo(i * 45, 0); c.lineTo(i * 45, W); c.stroke(); c.beginPath(); c.moveTo(0, i * 45); c.lineTo(W, i * 45); c.stroke(); }
    // rotate so that "up" is where the camera looks
    const s = R / this.range;
    const yaw = P.yaw;
    const toScreen = (p) => {
      const dx = p.x - P.pos.x, dz = p.z - P.pos.z;
      const rx = dx * Math.cos(yaw) - dz * Math.sin(yaw);
      const rz = dx * Math.sin(yaw) + dz * Math.cos(yaw);
      return [R + rx * s, R + rz * s];
    };
    // cave outline: sample walkable air in a coarse grid
    c.fillStyle = 'rgba(60,200,150,0.16)';
    for (let x = -this.range; x <= this.range; x += 2) for (let z = -this.range; z <= this.range; z += 2) {
      const wx = P.pos.x + x, wz = P.pos.z + z;
      if (G.isAir(wx, wz)) { const [sx, sy] = toScreen({ x: wx, z: wz }); c.fillRect(sx - 6, sy - 6, 12, 12); }
    }
    // straw piles (hiding / disguise spots)
    c.fillStyle = 'rgba(230,200,90,0.8)';
    for (const it of G.world.interact) if (it.id === 'straw') { const [x, y] = toScreen(it.pos); c.beginPath(); c.arc(x, y, 6, 0, 7); c.fill(); }
    // objective waypoint (GTA-style yellow marker)
    const obj = G.objectivePoint?.();
    if (obj) {
      let [x, y] = toScreen(obj);
      const dx = x - R, dy = y - R, m = Math.hypot(dx, dy);
      if (m > R - 16) { x = R + dx / m * (R - 16); y = R + dy / m * (R - 16); }
      c.fillStyle = '#ffd24a'; c.beginPath(); c.moveTo(x, y - 11); c.lineTo(x + 9, y + 7); c.lineTo(x - 9, y + 7); c.closePath(); c.fill();
    }
    // sheep
    c.fillStyle = 'rgba(220,220,220,0.55)';
    for (const sh of G.flock.sheep) { if (sh.out) continue; const [x, y] = toScreen(sh.pos); c.fillRect(x - 2, y - 2, 4, 4); }
    // crewmen
    c.fillStyle = '#7fd0ff';
    for (const so of G.soldiers) { if (!so.alive || !so.root.visible) continue; const [x, y] = toScreen(so.root.position); c.beginPath(); c.arc(x, y, 4.5, 0, 7); c.fill(); }
    // the giant + his field of view
    if (G.cy.root.visible) {
      const cp = G.cy.root.position, [x, y] = toScreen(cp);
      const sleeping = G.cyState.mode === 'sleep' || G.cy.blind;
      if (!sleeping) {
        const h = G.cy.root.rotation.y - yaw; // heading in radar space
        const half = Math.acos(G.VIEW_DOT), len = G.VIEW_RANGE * s;
        const a0 = Math.atan2(Math.cos(h), Math.sin(h));
        const grd = c.createRadialGradient(x, y, 4, x, y, len);
        const col = G.alertPhase === 'CAUTION' ? '255,200,60' : G.alertPhase === 'EVASION' ? '255,140,40' : '80,190,255';
        grd.addColorStop(0, `rgba(${col},0.55)`); grd.addColorStop(1, `rgba(${col},0.02)`);
        c.fillStyle = grd; c.beginPath(); c.moveTo(x, y); c.arc(x, y, len, a0 - half, a0 + half); c.closePath(); c.fill();
      }
      c.fillStyle = '#ff4d3a'; c.beginPath(); c.arc(x, y, 10, 0, 7); c.fill();
      c.strokeStyle = '#ffb0a0'; c.lineWidth = 2; c.stroke();
    }
    // noise rings (knocks / stones)
    for (const n of G.noiseRings) { const [x, y] = toScreen(n.p); c.strokeStyle = `rgba(255,255,255,${n.t})`; c.lineWidth = 2; c.beginPath(); c.arc(x, y, (1 - n.t) * 60 + 6, 0, 7); c.stroke(); }
    // player
    c.fillStyle = '#fff'; c.beginPath(); c.moveTo(R, R - 10); c.lineTo(R + 7, R + 7); c.lineTo(R - 7, R + 7); c.closePath(); c.fill();
    // sweep
    const sw = (this.t * 1.6) % (Math.PI * 2);
    c.strokeStyle = 'rgba(120,255,200,0.25)'; c.lineWidth = 3; c.beginPath(); c.moveTo(R, R); c.lineTo(R + Math.cos(sw) * R, R + Math.sin(sw) * R); c.stroke();
    c.restore();
  }
}

// ---------------------------------------------------------------- "!" / "?" above the giant + phase HUD
export class AlertSystem {
  constructor(game) {
    this.g = game;
    this.mark = document.createElement('div'); this.mark.id = 'alertmark'; document.getElementById('hud').appendChild(this.mark);
    this.phaseEl = document.createElement('div'); this.phaseEl.id = 'phasebar'; document.getElementById('hud').appendChild(this.phaseEl);
    this.phase = 'NORMAL'; this.timer = 0; this.markT = 0;
  }
  spotted() {
    const G = this.g;
    if (this.phase !== 'ALERT') {
      this.showMark('!');
      G.audio.alertSting?.();
      G.slowPunch = 0.5; // brief freeze-frame punch, like the MGS "!" moment
      crewBark(G, 'spotted', { n: 2, delay: 0.3 });
    }
    this.phase = 'ALERT'; this.timer = 20;
  }
  suspicious() {
    if (this.phase === 'NORMAL' && this.markT <= 0) { this.showMark('?'); this.g.audio.huh?.(); }
  }
  showMark(ch) { this.mark.textContent = ch; this.mark.className = ch === '!' ? 'bang' : 'huh'; this.markT = 1.4; }
  update(dt) {
    const G = this.g, st = G.cyState;
    this.markT -= dt;
    if (this.markT <= 0) this.mark.className = '';
    else {
      // follow the giant's head on screen
      const p = G.cy.eyeWorld().add(V(0, 2.2, 0)).project(G.camera);
      this.mark.style.left = `${(p.x * 0.5 + 0.5) * 100}%`; this.mark.style.top = `${(-p.y * 0.5 + 0.5) * 100}%`;
      this.mark.style.visibility = p.z < 1 ? 'visible' : 'hidden';
    }
    // phase machine
    const hunting = st.alert > 1 && (st.mode === 'tend' || st.mode === 'blind');
    if (hunting) this.timer = Math.max(this.timer, 12);
    if (this.phase === 'ALERT' && !hunting) { this.timer -= dt; if (this.timer < 12) this.phase = 'EVASION'; }
    else if (this.phase === 'EVASION') { if (hunting) this.phase = 'ALERT'; this.timer -= dt; if (this.timer <= 0) { this.phase = 'CAUTION'; this.timer = 20; } }
    else if (this.phase === 'CAUTION') { if (hunting) this.spotted(); this.timer -= dt; if (this.timer <= 0) this.phase = 'NORMAL'; }
    if (st.mode === 'sleep' || st.mode === 'script' || G.cy.blind && this.phase === 'NORMAL') { /* keep */ }
    G.alertPhase = this.phase;
    const show = this.phase !== 'NORMAL';
    this.phaseEl.className = show ? this.phase.toLowerCase() : '';
    if (show) this.phaseEl.innerHTML = `<b>${this.phase}</b><span>${Math.max(0, this.timer).toFixed(2)}</span>`;
  }
}

// ---------------------------------------------------------------- GTA weapon wheel
export class WeaponWheel {
  constructor(game) {
    this.g = game;
    const el = document.createElement('div'); el.id = 'wheel';
    this.items = [
      { id: 'bow', label: 'BOW', sub: () => `${game.player.arrows} arrows`, ang: -90 },
      { id: 'spear', label: 'SPEAR', sub: () => `${game.player.spears}`, ang: 30 },
      { id: 'stone', label: 'STONE', sub: () => `${game.player.stones} · distraction`, ang: 150 },
    ];
    el.innerHTML = `<div class="ring"></div>${this.items.map((it) => `<div class="slot" data-id="${it.id}" style="--a:${it.ang}deg"><b>${it.label}</b><small></small></div>`).join('')}<div class="center"></div>`;
    document.getElementById('hud').appendChild(el);
    this.el = el; this.open = false; this.sel = null; this.vec = new THREE.Vector2();
    el.querySelectorAll('.slot').forEach((s) => s.addEventListener('touchstart', (e) => { this.sel = s.dataset.id; this.highlight(); e.preventDefault(); }, { passive: false }));
  }
  setOpen(o) {
    if (o === this.open) return;
    this.open = o; this.el.classList.toggle('open', o);
    if (o) { this.vec.set(0, 0); this.sel = this.g.player.weapon; this.highlight(); this.g.audio.whoosh?.(0.15); }
    else if (this.sel) { this.g.player.weapon = this.sel; this.g.player.updateWeaponView(); }
  }
  highlight() {
    this.el.querySelectorAll('.slot').forEach((s) => {
      s.classList.toggle('sel', s.dataset.id === this.sel);
      const it = this.items.find((i) => i.id === s.dataset.id); s.querySelector('small').textContent = it.sub();
    });
    const it = this.items.find((i) => i.id === this.sel);
    this.el.querySelector('.center').textContent = it ? it.label : '';
  }
  update(input) {
    this.setOpen(input.down('Tab') || input.down('KeyQwheel'));
    if (!this.open) return;
    // steer the selection with the mouse (movement is consumed so the camera doesn't turn)
    this.vec.x += input.mouse.dx; this.vec.y += input.mouse.dy; input.mouse.dx = input.mouse.dy = 0;
    if (this.vec.length() > 30) {
      this.vec.clampLength(0, 80);
      const a = Math.atan2(this.vec.y, this.vec.x) * 180 / Math.PI;
      let best = null, bd = 999;
      for (const it of this.items) { let d = Math.abs(((a - it.ang + 540) % 360) - 180); if (d < bd) { bd = d; best = it.id; } }
      if (best !== this.sel) { this.sel = best; this.highlight(); this.g.audio.click?.(0.08, 3000); }
    }
    for (const [k, id] of [['Digit1', 'bow'], ['Digit2', 'spear'], ['Digit3', 'stone']]) if (input.pressed(k)) { this.sel = id; this.highlight(); }
  }
}

// ---------------------------------------------------------------- GTA V character switch (sky-cam)
export class CharacterSwitch {
  constructor(game) {
    this.g = game; this.busy = false;
    const el = document.createElement('div'); el.id = 'switcher'; document.getElementById('hud').appendChild(el); this.el = el;
  }
  async switchTo(soldier) {
    const G = this.g, P = G.player;
    if (this.busy || !soldier || !soldier.alive) return;
    this.busy = true;
    const from = P.pos.clone(), to = soldier.root.position.clone();
    G.cinematic = true; P.locked = true;
    const cam = G.camera, start = cam.position.clone();
    const high = (p) => p.clone().add(V(0, 26, 0.01));
    const look = (p) => cam.lookAt(p);
    const fly = async (a, b, target, dur) => {
      for (let t = 0; t < dur; t += 1 / 60) {
        await G.wait(1 / 60 * (G.timeScale || 1));
        const k = THREE.MathUtils.smootherstep(t / dur, 0, 1);
        G.camOverride = a.clone().lerp(b, k); G.camTarget = target(k);
      }
    };
    G.audio.whoosh?.(0.5);
    this.el.className = 'on';
    await fly(start, high(from), (k) => from.clone().lerp(from, k), 0.55);          // pull up
    await fly(high(from), high(to), (k) => from.clone().lerp(to, k), 0.8);          // pan across
    // swap bodies: the old Odysseus position is taken by the crewman
    soldier.root.position.copy(from); soldier.home = from.clone();
    P.pos.copy(to); P.vel.set(0, 0, 0); P.lastSafe = to.clone();
    G.audio.whoosh?.(0.5);
    await fly(high(to), to.clone().add(V(0, 1.8, 2.5)), (k) => to.clone(), 0.55);   // drop in
    G.camOverride = null; G.camTarget = null; this.el.className = '';
    P.locked = false; G.cinematic = false; this.busy = false;
    G.say(`You are now with ${soldier.name}'s group`, 2);
  }
}
