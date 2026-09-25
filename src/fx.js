import * as THREE from 'three';

// Blood / dust / spark particles (CPU simulated, GPU drawn as soft points)
export class Particles {
  constructor(scene, max = 3000, { ground = null, onLand = null } = {}) {
    this.max = max; this.n = 0;
    this.ground = ground; this.onLand = onLand; // floor height fn, callback when a heavy drop hits the floor
    this.splat = new Uint8Array(max);
    this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4); this.life = new Float32Array(max); this.size = new Float32Array(max); this.drag = new Float32Array(max); this.grav = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      vertexShader: `attribute vec4 color; attribute float size; varying vec4 vC; void main(){ vC = color; vec4 mv = modelViewMatrix*vec4(position,1.0); gl_PointSize = size * 300.0 / -mv.z; gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `varying vec4 vC; void main(){ float d = length(gl_PointCoord-0.5); if(d>0.5) discard; float a = smoothstep(0.5,0.1,d)*vC.a; gl_FragColor = vec4(vC.rgb, a); }`,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false; this.points.renderOrder = 4;
    scene.add(this.points);
    this.geo = g;
  }
  emit(p, v, { color = [0.25, 0.01, 0.005, 0.95], life = 1.2, size = 0.05, drag = 0.5, grav = 9.8, splat = false } = {}) {
    const i = this.n < this.max ? this.n++ : Math.floor(Math.random() * this.max);
    this.pos.set([p.x, p.y, p.z], i * 3); this.vel.set([v.x, v.y, v.z], i * 3);
    this.col.set(color, i * 4); this.life[i] = life; this.size[i] = size; this.drag[i] = drag; this.grav[i] = grav;
    this.splat[i] = splat ? 1 : 0;
  }
  // a bite tearing through a body: a burst of heavy drops thrown along dir, fine spray, and a red mist
  gore(p, dir, count = 150, force = 5) {
    const d = dir ? dir.clone().normalize() : new THREE.Vector3(0, 1, 0);
    const red = () => [0.42 + Math.random() * 0.2, 0.012, 0.008, 1];
    for (let k = 0; k < count; k++) {
      const r = new THREE.Vector3((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2);
      const heavy = Math.random() < 0.35;
      const v = d.clone().multiplyScalar(force * (0.5 + Math.random() * 0.9)).addScaledVector(r, force * (heavy ? 0.45 : 0.8));
      const q = p.clone().addScaledVector(r, 0.12);
      this.emit(q, v, heavy
        ? { color: red(), life: 2.5 + Math.random(), size: 0.07 + Math.random() * 0.1, drag: 0.25, splat: Math.random() < 0.5 }
        : { color: red(), life: 0.7 + Math.random() * 0.8, size: 0.025 + Math.random() * 0.05, drag: 0.8 });
    }
    for (let k = 0; k < count * 0.15; k++) { // mist hanging in the air
      const v = d.clone().multiplyScalar(force * 0.25 * Math.random()).add(new THREE.Vector3((Math.random() - 0.5), Math.random() * 0.4, (Math.random() - 0.5)).multiplyScalar(1.2));
      this.emit(p.clone(), v, { color: [0.3, 0.01, 0.006, 0.35], life: 0.6 + Math.random() * 0.6, size: 0.35 + Math.random() * 0.4, drag: 2.5, grav: 0.8 });
    }
  }
  // arterial jet from an open wound; call every frame with a 0..1 pulse strength
  spurt(p, dir, strength = 1, scale = 1) {
    if (strength <= 0.02) return;
    const d = dir.clone().normalize();
    const n = Math.ceil(strength * 5);
    for (let k = 0; k < n; k++) {
      const v = d.clone().multiplyScalar((2 + Math.random() * 2.5) * strength)
        .add(new THREE.Vector3((Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5)).multiplyScalar(0.9));
      this.emit(p, v, { color: [0.45 + Math.random() * 0.15, 0.012, 0.008, 1], life: 1.6 + Math.random(), size: (0.04 + Math.random() * 0.06 * strength) * scale, drag: 0.3, splat: Math.random() < 0.12 });
    }
  }
  // slow drops falling off something (a bloody mouth or fist)
  drip(p, n = 1, spread = 0.15, scale = 1) {
    for (let k = 0; k < n; k++) {
      const q = p.clone().add(new THREE.Vector3((Math.random() - 0.5) * spread, 0, (Math.random() - 0.5) * spread));
      this.emit(q, new THREE.Vector3(0, -0.3, 0), { color: [0.38, 0.01, 0.006, 1], life: 2.5, size: (0.04 + Math.random() * 0.04) * scale, drag: 0.1, splat: Math.random() < 0.3 });
    }
  }
  blood(p, dir, count = 60, force = 4) {
    for (let k = 0; k < count; k++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 1.2, (Math.random() - 0.5) * 2).normalize().multiplyScalar(force * (0.3 + Math.random()));
      if (dir) v.addScaledVector(dir, force * 0.8);
      this.emit(p, v, { color: [0.22 + Math.random() * 0.1, 0.01, 0.005, 0.95], life: 0.8 + Math.random() * 0.8, size: 0.02 + Math.random() * 0.06 });
    }
  }
  dust(p, count = 30, spread = 1, color = [0.35, 0.3, 0.25, 0.35]) {
    for (let k = 0; k < count; k++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * spread, Math.random() * spread * 0.6, (Math.random() - 0.5) * spread);
      this.emit(p.clone().add(new THREE.Vector3((Math.random() - 0.5) * spread, 0, (Math.random() - 0.5) * spread)), v, { color, life: 1.5 + Math.random() * 2, size: 0.3 + Math.random() * 0.6, drag: 1.5, grav: -0.1 });
    }
  }
  sparks(p, n = 12) {
    for (let k = 0; k < n; k++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 3, (Math.random() - 0.5) * 3);
      this.emit(p, v, { color: [4, 1.5, 0.4, 1], life: 0.4 + Math.random() * 0.5, size: 0.015, drag: 0.3 });
    }
  }
  update(dt) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { this.col[i * 4 + 3] = 0; continue; }
      this.life[i] -= dt;
      const d = 1 - this.drag[i] * dt;
      this.vel[i * 3] *= d; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.grav[i] * dt; this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const gy = this.ground && this.grav[i] > 0 ? this.ground(this.pos[i * 3], this.pos[i * 3 + 2]) + 0.02 : 0.02;
      if (this.pos[i * 3 + 1] < gy && this.grav[i] > 0) {
        this.pos[i * 3 + 1] = gy; this.vel[i * 3] = this.vel[i * 3 + 1] = this.vel[i * 3 + 2] = 0;
        if (this.splat[i]) { this.splat[i] = 0; this.onLand?.(this.pos[i * 3], gy, this.pos[i * 3 + 2], this.size[i]); }
      }
      if (this.life[i] < 0.4) this.col[i * 4 + 3] *= 0.9;
    }
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.color.needsUpdate = true; this.geo.attributes.size.needsUpdate = true;
  }
}

// persistent blood pools on the floor
export class Decals {
  constructor(scene) {
    this.scene = scene;
    const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
    for (let i = 0; i < 18; i++) { g.fillStyle = `rgba(60,4,2,${0.5 + Math.random() * 0.4})`; g.beginPath(); g.arc(64 + (Math.random() - 0.5) * 60, 64 + (Math.random() - 0.5) * 60, 6 + Math.random() * 22, 0, 6.28); g.fill(); }
    this.tex = new THREE.CanvasTexture(c); this.tex.colorSpace = THREE.SRGBColorSpace;
    this.mat = new THREE.MeshStandardMaterial({ map: this.tex, transparent: true, roughness: 0.15, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  }
  add(p, size = 1) {
    this.list = this.list || [];
    if (!this.plane) this.plane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(this.plane, this.mat);
    m.scale.set(size, 1, size);
    m.position.copy(p).add(new THREE.Vector3(0, 0.03 + (this.list.length % 7) * 0.002, 0)); m.rotation.y = Math.random() * 6.28; m.receiveShadow = true;
    this.scene.add(m); this.list.push(m);
    if (this.list.length > 220) this.scene.remove(this.list.shift()); // oldest small splats go first
  }
}
