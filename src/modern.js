import * as THREE from 'three';
import { rockField } from './cave.js';

// ============================================================================================
// Modern action-adventure layer:
//  - Stealth awareness meter (The Last of Us / Assassin's Creed)
//  - QTEs: button-mash grab escape + timing strike (God of War)
//  - Photo mode (free camera, depth of field, filters, save PNG)
//  - Pickups that heal / resupply (Zelda)
//  - Haptics (phone vibration) + camera juice (hit-stop, FOV kick)
// ============================================================================================
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const hud = () => document.getElementById('hud');

// ---------------------------------------------------------------- awareness meter
export class StealthMeter {
  constructor(game) {
    this.g = game;
    this.el = document.createElement('div'); this.el.id = 'aware';
    this.el.innerHTML = '<svg viewBox="0 0 60 60"><path class="bg" d="M30 6 L54 50 L6 50 Z"/><path class="fg" d="M30 6 L54 50 L6 50 Z"/></svg><div class="arrow"></div>';
    hud().appendChild(this.el);
    this.fg = this.el.querySelector('.fg');
    this.hidden = document.createElement('div'); this.hidden.id = 'hiddenTag'; this.hidden.textContent = 'HIDDEN'; hud().appendChild(this.hidden);
    this.len = 0; this.shown = 0;
  }
  update(dt) {
    const G = this.g, st = G.cyState, cam = G.camera;
    const a = THREE.MathUtils.clamp(st.alert || 0, 0, 1.2);
    const active = G.cy.root.visible && (st.mode === 'tend' || st.mode === 'blind') && a > 0.04 && G.alertPhase !== 'ALERT';
    this.shown = THREE.MathUtils.lerp(this.shown, active ? 1 : 0, Math.min(1, dt * 8));
    this.el.style.opacity = this.shown;
    this.hidden.classList.toggle('on', !!G.player.hiddenInStraw);
    if (this.shown < 0.02) return;
    // fill: white -> orange -> red
    const f = Math.min(1, a);
    this.fg.style.clipPath = `inset(${(1 - f) * 100}% 0 0 0)`;
    this.fg.style.fill = f < 0.5 ? '#f4efe6' : f < 0.85 ? '#ffa53a' : '#ff3b2f';
    // place it over the giant's head, or clamp to the screen edge pointing toward him
    const p = G.cy.eyeWorld().add(V(0, 3, 0)).project(cam);
    let x = p.x, y = p.y;
    const behind = p.z > 1;
    if (behind) { x = -x; y = -y; }
    const off = behind || Math.abs(x) > 0.9 || Math.abs(y) > 0.85;
    if (off) { const m = Math.max(Math.abs(x) / 0.9, Math.abs(y) / 0.8); x /= m; y /= m; }
    this.el.style.left = `${(x * 0.5 + 0.5) * 100}%`; this.el.style.top = `${(-y * 0.5 + 0.5) * 100}%`;
    this.el.classList.toggle('edge', off);
    this.el.querySelector('.arrow').style.transform = `rotate(${Math.atan2(-y, x) * 180 / Math.PI + 90}deg)`;
  }
}

// ---------------------------------------------------------------- QTE
export class QTE {
  constructor(game) {
    this.g = game;
    this.el = document.createElement('div'); this.el.id = 'qte'; hud().appendChild(this.el);
    this.el.addEventListener('touchstart', (e) => { this.tap = true; e.preventDefault(); }, { passive: false });
    this.el.addEventListener('mousedown', () => { this.tap = true; });
    // count presses straight from the keyboard so none are lost between frames
    this.presses = 0;
    addEventListener('keydown', (e) => { if (!e.repeat && (e.code === 'KeyE' || e.code === 'Space')) this.presses++; });
    addEventListener('mousedown', (e) => { if (this.el.classList.contains('on') && e.button === 0) this.presses++; });
  }
  take() { const n = this.presses + (this.tap ? 1 : 0) + (this.g.input.touchE ? 1 : 0); this.presses = 0; this.tap = false; this.g.input.touchE = false; return n; }
  // mash E (or tap) N times within the time limit (real seconds)
  async mash({ label = 'MASH', key = 'KeyE', count = 10, time = 2.2 } = {}) {
    const G = this.g, I = G.input;
    let n = 0, t = time;
    this.el.className = 'on mash';
    this.take();
    while (t > 0 && n < count) {
      await G.realFrame();
      t -= G.lastRealDt;
      const k = this.take();
      if (k) { n += k; G.haptic(25); G.player.shake = Math.max(G.player.shake, 0.4); }
      this.el.innerHTML = `<div class="key">E</div><div class="lbl">${label}</div><div class="bar"><div style="width:${(n / count) * 100}%"></div></div><div class="time" style="width:${(t / time) * 100}%"></div>`;
    }
    this.el.className = '';
    return n >= count;
  }
  // press E while the shrinking ring overlaps the target ring
  async timing({ label = 'STRIKE', key = 'KeyE', dur = 1.6 } = {}) {
    const G = this.g, I = G.input;
    let t = 0; this.el.className = 'on timing'; this.take();
    const target = 0.3; // ring scale where the window is
    while (t < dur) {
      await G.realFrame();
      t += G.lastRealDt;
      const s = 1.4 - (t / dur) * 1.3; // 1.4 -> 0.1
      this.el.innerHTML = `<div class="tgt"></div><div class="shrink" style="transform:translate(-50%,-50%) scale(${s})"></div><div class="key">E</div><div class="lbl">${label}</div>`;
      if (this.take()) {
        const ok = Math.abs(s - target) < 0.14;
        this.el.className = 'on timing ' + (ok ? 'good' : 'bad');
        await G.realWait(0.35); this.el.className = '';
        return ok;
      }
    }
    this.el.className = ''; return false;
  }
}

// ---------------------------------------------------------------- photo mode
export class PhotoMode {
  constructor(game) {
    this.g = game; this.on = false;
    const el = document.createElement('div'); el.id = 'photo';
    el.innerHTML = `
      <div class="title">PHOTO MODE</div>
      <label>Focus distance <input type="range" id="pm-focus" min="0.5" max="40" step="0.1" value="6"></label>
      <label>Aperture (blur) <input type="range" id="pm-bokeh" min="0" max="8" step="0.1" value="3"></label>
      <label>Field of view <input type="range" id="pm-fov" min="20" max="90" step="1" value="55"></label>
      <label>Exposure <input type="range" id="pm-exp" min="-0.4" max="0.4" step="0.01" value="0"></label>
      <label>Filter <select id="pm-filter"><option value="film">Film</option><option value="bw">Black & White</option><option value="warm">Firelight</option><option value="teal">Teal Night</option></select></label>
      <label><input type="checkbox" id="pm-hide"> Hide Odysseus</label>
      <div class="row"><button id="pm-shot">SAVE PHOTO</button><button id="pm-exit">EXIT (P)</button></div>
      <div class="help">WASD move · mouse / drag look · Q/E down/up · Shift fast</div>`;
    document.body.appendChild(el);
    this.el = el;
    const $ = (id) => el.querySelector(id);
    $('#pm-exit').onclick = () => this.toggle(false);
    $('#pm-shot').onclick = () => this.save();
    for (const id of ['#pm-focus', '#pm-bokeh', '#pm-fov', '#pm-exp', '#pm-filter', '#pm-hide']) $(id).oninput = () => this.apply();
    this.$ = $;
    // drag to look with the mouse (outside the panel)
    addEventListener('mousedown', (e) => { if (this.on && !e.target.closest('#photo')) { this.drag = { x: e.clientX, y: e.clientY }; } });
    addEventListener('mouseup', () => (this.drag = null));
    addEventListener('mousemove', (e) => { if (!this.on || !this.drag) return; this.yaw -= (e.clientX - this.drag.x) * 0.004; this.pitch -= (e.clientY - this.drag.y) * 0.004; this.drag = { x: e.clientX, y: e.clientY }; });
    // drag to look on touch
    let last = null;
    addEventListener('touchstart', (e) => { if (!this.on || e.target.closest('#photo')) return; last = e.touches[0]; }, { passive: true });
    addEventListener('touchmove', (e) => { if (!this.on || !last) return; const t = e.touches[0]; this.yaw -= (t.clientX - last.clientX) * 0.005; this.pitch -= (t.clientY - last.clientY) * 0.005; last = t; }, { passive: true });
    el.addEventListener('touchstart', (e) => { if (e.target.closest('label,button,select,input')) return; last = e.touches[0]; }, { passive: true });
    el.addEventListener('touchmove', (e) => { if (!last) return; const t = e.touches[0]; this.yaw -= (t.clientX - last.clientX) * 0.005; this.pitch -= (t.clientY - last.clientY) * 0.005; last = t; }, { passive: true });
  }
  toggle(on = !this.on) {
    const G = this.g;
    if (on === this.on || G.ended) return;
    this.on = on;
    this.el.classList.toggle('on', on);
    document.body.classList.toggle('photo', on);
    if (on) {
      this.pos = G.camera.position.clone();
      const e = new THREE.Euler().setFromQuaternion(G.camera.quaternion, 'YXZ');
      this.yaw = e.y; this.pitch = e.x;
      this.savedFov = G.camera.fov;
      document.exitPointerLock?.();
      G.post.dof.enabled = true;
      this.apply();
    } else {
      G.post.dof.enabled = false;
      G.post.grade.uniforms.get('uFilter').value = 0;
      G.post.grade.uniforms.get('uExposure').value = 0;
      G.player.avatar && (G.player.avatar.root.visible = true);
      G.camera.fov = this.savedFov; G.camera.updateProjectionMatrix();
      if (!G.input.touch) G.renderer.domElement.requestPointerLock?.()?.catch?.(() => {});
    }
  }
  apply() {
    const G = this.g, $ = this.$;
    const dof = G.post.dofEffect;
    dof.cocMaterial.focusDistance = +$('#pm-focus').value;
    dof.cocMaterial.focusRange = Math.max(0.5, +$('#pm-focus').value * 0.35);
    dof.bokehScale = +$('#pm-bokeh').value;
    G.camera.fov = +$('#pm-fov').value; G.camera.updateProjectionMatrix();
    G.post.grade.uniforms.get('uExposure').value = +$('#pm-exp').value;
    G.post.grade.uniforms.get('uFilter').value = { film: 0, bw: 1, warm: 2, teal: 3 }[$('#pm-filter').value];
    this.hideAvatar = $('#pm-hide').checked;
  }
  update(dtReal) {
    const G = this.g, I = G.input;
    if (!this.on) return;
    I.mouse.dx = I.mouse.dy = 0;
    this.pitch = THREE.MathUtils.clamp(this.pitch, -1.5, 1.5);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    const f = V(0, 0, -1).applyQuaternion(q), r = V(1, 0, 0).applyQuaternion(q);
    const sp = (I.down('ShiftLeft') ? 6 : 2) * dtReal;
    const prev = this.pos.clone();
    if (I.down('KeyW')) this.pos.addScaledVector(f, sp); if (I.down('KeyS')) this.pos.addScaledVector(f, -sp);
    if (I.down('KeyD')) this.pos.addScaledVector(r, sp); if (I.down('KeyA')) this.pos.addScaledVector(r, -sp);
    if (I.down('KeyE')) this.pos.y += sp; if (I.down('KeyQ')) this.pos.y -= sp;
    // keep the camera within reach of the player
    const P = G.player.pos, off = this.pos.clone().sub(P);
    if (off.length() > 12) this.pos.copy(P).add(off.setLength(12));
    if (rockField(this.pos.x, this.pos.y, this.pos.z) > -0.3 && this.pos.z < 30) this.pos.copy(prev); // stay inside the cave
    G.camera.position.copy(this.pos); G.camera.quaternion.copy(q);
    if (G.player.avatar) G.player.avatar.root.visible = !this.hideAvatar;
  }
  save() {
    const G = this.g;
    this.el.style.visibility = 'hidden';
    G.post.composer.render(0);
    const url = G.renderer.domElement.toDataURL('image/png');
    this.el.style.visibility = '';
    const a = document.createElement('a'); a.href = url; a.download = `odyssey-${Date.now()}.png`; a.click();
    G.haptic(40);
    const fl = document.createElement('div'); fl.className = 'shutter'; document.body.appendChild(fl); setTimeout(() => fl.remove(), 400);
  }
}

// ---------------------------------------------------------------- pickups
export class Pickups {
  constructor(game) {
    this.g = game; this.items = [];
  }
  add(obj, kind, amount) { this.items.push({ obj, kind, amount, taken: false }); obj.userData.pickup = true; }
  nearest(pos) {
    let best = null, bd = 1.8;
    for (const it of this.items) { if (it.taken) continue; const d = it.obj.getWorldPosition(V(0, 0, 0)).distanceTo(pos); if (d < bd) { bd = d; best = it; } }
    return best;
  }
  prompt(it) { return it.kind === 'cheese' ? '[E] Eat cheese (+HP)' : it.kind === 'arrows' ? '[E] Take arrows' : '[E] Take stones'; }
  take(it) {
    const G = this.g, P = G.player;
    it.taken = true; it.obj.visible = false;
    if (it.kind === 'cheese') { P.hp = Math.min(100, P.hp + it.amount); G.popText(`+${it.amount} HP`); G.audio.crunch?.(P.pos); }
    if (it.kind === 'arrows') { P.arrows += it.amount; G.popText(`+${it.amount} ARROWS`); G.audio.impact?.(P.pos, 'wood'); }
    if (it.kind === 'stones') { P.stones += it.amount; G.popText(`+${it.amount} STONES`); G.audio.impact?.(P.pos, 'rock'); }
    P.updateWeaponView(); G.haptic(20);
  }
}
