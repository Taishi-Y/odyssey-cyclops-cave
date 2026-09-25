import * as THREE from 'three';

// Makes the bow readable: glowing trails behind flying arrows, a predicted arc while drawing,
// a landing marker, and an expanding flash where an arrow hits.
const TRAIL_N = 26;

const glowTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'); const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.35, 'rgba(255,220,160,0.6)'); r.addColorStop(1, 'rgba(255,160,60,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();

const ringTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.strokeStyle = 'rgba(255,230,180,1)'; g.lineWidth = 9; g.beginPath(); g.arc(64, 64, 52, 0, Math.PI * 2); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();

export class ArrowFX {
  constructor(scene, camera, player, physics) {
    Object.assign(this, { scene, camera, player, physics });
    this.trails = new Map();
    this.trailMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    // predicted arc (dots) + landing marker
    this.PREV_N = 48;
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.PREV_N * 3), 3));
    this.preview = new THREE.Points(pg, new THREE.PointsMaterial({ map: glowTex, size: 11 * Math.min(2, window.devicePixelRatio || 1), sizeAttenuation: false, color: 0xffd9a0, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    this.preview.frustumCulled = false; this.preview.visible = false; this.preview.renderOrder = 5;
    scene.add(this.preview);
    this.marker = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: ringTex, color: 0xffc070, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
    this.marker.visible = false; this.marker.renderOrder = 5;
    scene.add(this.marker);
    this.flashes = [];
    this.t = 0;
    // weak-point highlight drawn on the giant's eye while it is under the aim
    this.eyeGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTex, color: 0xff3a2a, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, toneMapped: false }));
    this.eyeGlow.visible = false; this.eyeGlow.renderOrder = 6;
    scene.add(this.eyeGlow);
    this.aimZone = null; this.eyeHot = 0;
  }

  // tip glow sprite attached to a flying arrow
  decorate(p) {
    if (p.kind !== 'arrow') return;
    p.mesh.scale.setScalar(2.4);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffcf8a, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    s.scale.setScalar(0.25); s.position.z = 0.4; p.mesh.add(s); p.glow = s;
  }

  impact(pt, normal, p) {
    const big = p?.kind === 'arrow' || p?.kind === 'spear';
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: ringTex, color: 0xffd28a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
    m.position.copy(pt);
    if (normal) m.lookAt(pt.clone().add(normal)); else m.lookAt(this.camera.position);
    m.position.addScaledVector(normal || new THREE.Vector3(), 0.03);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffe0b0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    s.position.copy(pt);
    this.scene.add(m, s);
    this.flashes.push({ m, s, t: 0, max: big ? 1.4 : 0.8 });
    if (p?.glow) { p.glow.material.opacity = 0.5; }
  }

  trailFor(p) {
    let tr = this.trails.get(p);
    if (!tr) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_N * 2 * 3), 3));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(TRAIL_N * 2 * 3), 3));
      const idx = [];
      for (let i = 0; i < TRAIL_N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      g.setIndex(idx);
      const mesh = new THREE.Mesh(g, this.trailMat); mesh.frustumCulled = false; mesh.renderOrder = 5;
      this.scene.add(mesh);
      tr = { mesh, pts: [], fade: 1 };
      this.trails.set(p, tr);
    }
    return tr;
  }

  updateTrails(dt) {
    const live = new Set(this.player.projectiles.filter((p) => p.kind !== 'stone'));
    for (const p of live) {
      if (!p.mesh.userData.fxDone) { p.mesh.userData.fxDone = true; this.decorate(p); }
      const tr = this.trailFor(p);
      if (!p.stuck) { tr.pts.unshift(p.pos.clone()); if (tr.pts.length > TRAIL_N) tr.pts.pop(); }
      else tr.fade -= dt * 2.5;
    }
    // trails of arrows that hit a creature and vanished just fade out
    for (const [p, tr] of this.trails) {
      if (!live.has(p)) tr.fade -= dt * 2.5;
      if (p.glow && p.stuck) p.glow.material.opacity = Math.max(0, p.glow.material.opacity - dt * 1.5);
      if (tr.fade <= 0 || p.taken) { this.scene.remove(tr.mesh); tr.mesh.geometry.dispose(); this.trails.delete(p); continue; }
      this.buildRibbon(tr, p.kind === 'spear' ? 0.05 : 0.06);
    }
  }

  buildRibbon(tr, width) {
    const pos = tr.mesh.geometry.attributes.position, col = tr.mesh.geometry.attributes.color;
    const cam = this.camera.getWorldPosition(new THREE.Vector3());
    const n = tr.pts.length, side = new THREE.Vector3(), dir = new THREE.Vector3(), view = new THREE.Vector3();
    for (let i = 0; i < TRAIL_N; i++) {
      const k = Math.min(i, n - 1);
      if (k < 0) { pos.setXYZ(i * 2, 0, 0, 0); pos.setXYZ(i * 2 + 1, 0, 0, 0); continue; }
      const p = tr.pts[k];
      const q = tr.pts[Math.min(k + 1, n - 1)], r = tr.pts[Math.max(k - 1, 0)];
      dir.subVectors(r, q); if (dir.lengthSq() < 1e-8) dir.set(0, 0, 1);
      view.subVectors(cam, p);
      side.crossVectors(dir, view).normalize();
      const f = 1 - i / (TRAIL_N - 1);              // 1 at the arrow, 0 at the tail
      const w = width * (0.25 + 0.75 * f);
      pos.setXYZ(i * 2, p.x + side.x * w, p.y + side.y * w, p.z + side.z * w);
      pos.setXYZ(i * 2 + 1, p.x - side.x * w, p.y - side.y * w, p.z - side.z * w);
      const a = f * f * tr.fade * (i < n ? 1 : 0);
      col.setXYZ(i * 2, 1.0 * a, 0.78 * a, 0.45 * a); col.setXYZ(i * 2 + 1, 1.0 * a, 0.78 * a, 0.45 * a);
    }
    pos.needsUpdate = true; col.needsUpdate = true;
  }

  // simulate the shot the player would release right now (same numbers as Player.fireArrow/throwSpear)
  updatePreview() {
    const P = this.player;
    const weapon = P.weapon === 'bow' ? (P.arrows > 0 ? 'bow' : null) : P.weapon === 'spear' ? (P.spears > 0 ? 'spear' : null) : null;
    const aiming = !!weapon && !P.carrying && !P.dead && (P.drawing || P.aim > 0.5);
    const show = aiming && weapon === 'bow' && P.drawing && P.draw > 0.05;
    this.preview.visible = show; this.marker.visible = false;
    const prevZone = this.aimZone; this.aimZone = null;
    if (!aiming) return;
    // just aiming (not drawn yet): judge with a full-power shot
    const power = P.drawing ? Math.max(weapon === 'bow' ? 0.2 : 0.3, P.draw) : 1;
    const { o, d } = P.aimRay();
    let pos, vel;
    if (weapon === 'bow') { pos = o.clone().addScaledVector(d, 0.6); vel = d.clone().multiplyScalar(22 + power * 48); }
    else { pos = o.clone().addScaledVector(d, 0.8).add(new THREE.Vector3(0, -0.1, 0)); vel = d.clone().multiplyScalar(16 + power * 20).add(new THREE.Vector3(0, 1.2, 0)); }
    const arr = this.preview.geometry.attributes.position;
    const step = 1 / 60; let k = 0, hit = null, zone = null;
    const prev = new THREE.Vector3();
    for (let s = 0; s < 150; s++) {
      prev.copy(pos);
      vel.y -= 9.8 * step; vel.multiplyScalar(1 - 0.02 * step); pos.addScaledVector(vel, step);
      zone = this.zoneTest?.(prev, pos);
      if (zone) break;
      hit = this.physics.raycastSegment(prev, pos);
      if (hit) break;
      if (show && k < this.PREV_N && s % 2 === 0 && prev.distanceTo(o) > 1.5) { arr.setXYZ(k++, pos.x, pos.y, pos.z); }
    }
    this.aimZone = zone ? zone.z.name : null;
    if (this.aimZone !== prevZone) this.onTargetChange?.(this.aimZone);
    if (!show) return;
    for (let i = k; i < this.PREV_N; i++) arr.setXYZ(i, 0, -9999, 0);
    arr.needsUpdate = true;
    this.preview.geometry.setDrawRange(0, k);
    const full = P.draw >= 0.999;
    const weak = this.aimZone === 'eye';
    this.preview.material.color.set(weak ? 0xff4030 : full ? 0xffb050 : 0xffe2b8);
    const at = zone ? zone.at : hit ? hit.point : null;
    if (at) {
      const n = zone ? this.camera.getWorldPosition(new THREE.Vector3()).sub(at).normalize()
        : hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
      this.marker.visible = !weak; // the eye gets its own highlight
      this.marker.position.copy(at).addScaledVector(n, 0.04);
      this.marker.lookAt(at.clone().add(n));
      const pulse = 0.35 + 0.08 * Math.sin(this.t * 10);
      // keep the marker readable at any range (~same size on screen)
      const dist = at.distanceTo(this.camera.getWorldPosition(new THREE.Vector3()));
      this.marker.scale.setScalar((pulse + (1 - power) * 0.25) * Math.max(1, dist * 0.09));
      this.marker.material.color.set(zone ? 0xff6a50 : full ? 0xff9a30 : 0xffd7a0);
    }
  }

  updateEyeGlow(dt) {
    const eye = this.aimZone === 'eye' ? this.eyeTarget?.() : null;
    this.eyeHot = THREE.MathUtils.clamp(this.eyeHot + (eye ? dt * 8 : -dt * 5), 0, 1);
    this.eyeGlow.visible = this.eyeHot > 0.01;
    if (!this.eyeGlow.visible) return;
    if (eye) this.eyeGlow.position.copy(eye);
    const dist = this.eyeGlow.position.distanceTo(this.camera.getWorldPosition(new THREE.Vector3()));
    // shrinks onto the eye as it locks on, then pulses
    const s = dist * 0.05 * (1 + (1 - this.eyeHot) * 1.5 + 0.12 * Math.sin(this.t * 14));
    this.eyeGlow.scale.setScalar(s);
    this.eyeGlow.material.opacity = this.eyeHot;
  }

  update(dt) {
    this.t += dt;
    this.updateTrails(dt);
    this.updatePreview();
    this.updateEyeGlow(dt);
    for (const f of this.flashes) {
      f.t += dt; const k = f.t / 0.45;
      f.m.scale.setScalar(0.15 + k * f.max); f.m.material.opacity = Math.max(0, 1 - k);
      f.s.scale.setScalar(0.9 * f.max * (1 - k * 0.5)); f.s.material.opacity = Math.max(0, 1 - k * 1.6);
      if (k >= 1) { this.scene.remove(f.m, f.s); f.m.geometry.dispose(); f.m.material.dispose(); f.s.material.dispose(); f.dead = true; }
    }
    this.flashes = this.flashes.filter((f) => !f.dead);
  }
}
