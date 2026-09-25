import * as THREE from 'three';

// Liquid blood for the giant's meals.
//  - BloodSpray: drops drawn as wet, motion-stretched streaks (not round dots). Dense emission along a
//    jet makes the streaks overlap into a continuous stream.
//  - BloodSplats: irregular splatter marks on the floor, stretched along the drop's travel.
//  - SkinStains: blood smeared on the giant's skin (mouth, chin, fist) that follows his bones.
//  - addStump: a wet torn-flesh cap where a body part was bitten off.

const tmp = new THREE.Vector3();

export class BloodSpray {
  constructor(scene, camera, renderer, { max = 5000, ground = null, onLand = null } = {}) {
    this.max = max; this.n = 0; this.camera = camera; this.renderer = renderer;
    this.ground = ground; this.onLand = onLand;
    this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3);
    this.size = new Float32Array(max); this.alpha = new Float32Array(max); this.shade = new Float32Array(max);
    this.life = new Float32Array(max); this.drag = new Float32Array(max); this.splat = new Uint8Array(max);
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.aPos = new THREE.InstancedBufferAttribute(this.pos, 3); this.aVel = new THREE.InstancedBufferAttribute(this.vel, 3);
    this.aSize = new THREE.InstancedBufferAttribute(this.size, 1); this.aAlpha = new THREE.InstancedBufferAttribute(this.alpha, 1);
    this.aShade = new THREE.InstancedBufferAttribute(this.shade, 1);
    for (const a of [this.aPos, this.aVel, this.aSize, this.aAlpha, this.aShade]) a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.aPos); g.setAttribute('iVel', this.aVel); g.setAttribute('iSize', this.aSize);
    g.setAttribute('iAlpha', this.aAlpha); g.setAttribute('iShade', this.aShade);
    g.instanceCount = 0;
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, // the streak basis can mirror the quad
      uniforms: { uShutter: { value: 1 / 60 } },
      vertexShader: `
        attribute vec3 iPos; attribute vec3 iVel; attribute float iSize; attribute float iAlpha; attribute float iShade;
        uniform float uShutter;
        varying vec2 vQ; varying float vH; varying float vA; varying float vS;
        void main(){
          if (iSize <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
          vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
          vec3 vv = (modelViewMatrix * vec4(iVel, 0.0)).xyz;
          // streak along the on-screen motion: length = drop size + distance travelled while the shutter is open
          vec2 d = vv.xy; float sp = length(d);
          d = sp > 1e-4 ? d / sp : vec2(0.0, 1.0);
          vec2 pp = vec2(-d.y, d.x);
          float len = min(iSize + sp * uShutter, iSize * 4.5);
          float wid = iSize / (1.0 + (len / iSize - 1.0) * 0.15); // stretched drops thin out a little
          mv.xy += d * position.y * len + pp * position.x * wid;
          vH = 0.5 * max(len / wid - 1.0, 0.0); // half length of the capsule's straight part, in widths
          vQ = vec2(position.x, position.y * (len / wid));
          vA = iAlpha * smoothstep(0.6, 2.2, -mv.z); vS = iShade; // drops right at the lens fade out
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying vec2 vQ; varying float vH; varying float vA; varying float vS;
        void main(){
          // one smooth silhouette: round head at the front (+y) melting into a tapering tail
          float L = vH + 0.5;
          float t = clamp((vQ.y + L) / (2.0 * L), 0.0, 1.0); // 0 tail .. 1 head
          float hy = L - 0.5;
          float w = mix(0.16, 0.5, smoothstep(0.0, 1.0, t));
          float dy = max(vQ.y - hy, 0.0);                    // past the head centre: round cap
          vec2 k = vec2(vQ.x / max(w, 1e-3) * 0.5, dy);
          float e = length(k) * 2.0;
          e += sin(vQ.y * 2.3 + vS * 17.0) * 0.04; // a slight wobble along the length: no two drops alike
          float a = smoothstep(1.0, 0.72, e) * mix(0.7, 1.0, t) * vA;
          if (a < 0.02) discard;
          // thick in the middle (almost black), thinner and redder toward the edge
          vec3 c = mix(vec3(0.07, 0.003, 0.002), vec3(0.17, 0.008, 0.005), smoothstep(0.2, 1.0, e)) * vS;
          gl_FragColor = vec4(c, a);
        }`,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 5;
    scene.add(this.mesh);
    this.geo = g;
  }

  emit(p, v, size, { life = 3, drag = 0.15, alpha = 1, splat = false } = {}) {
    const i = this.n < this.max ? this.n++ : Math.floor(Math.random() * this.max);
    this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = v.x; this.vel[i * 3 + 1] = v.y; this.vel[i * 3 + 2] = v.z;
    this.size[i] = size; this.alpha[i] = alpha; this.life[i] = life; this.drag[i] = drag; this.splat[i] = splat ? 1 : 0;
    this.shade[i] = 0.75 + Math.random() * 0.5;
  }

  // a bite tearing through a body: a few heavy gobs, ropes of streaks thrown along dir, fine droplets
  gore(p, dir, count = 150, force = 5) {
    const d = (dir ? dir.clone() : new THREE.Vector3(0, 1, 0)).normalize();
    const rnd = () => new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(2);
    // ropes: 3-5 coherent strands, each a line of drops with graded speed, so they read as liquid
    const ropes = 3 + Math.floor(Math.random() * 3);
    for (let s = 0; s < ropes; s++) {
      const rd = d.clone().addScaledVector(rnd(), 0.4).normalize();
      const sp = force * (0.7 + Math.random() * 0.6);
      const m = Math.round(count * 0.12);
      for (let k = 0; k < m; k++) {
        const f = k / m; // leading drops fly fastest, the tail lags and falls short
        const v = rd.clone().multiplyScalar(sp * (1 - f * 0.8)).addScaledVector(rnd(), 0.12);
        this.emit(p.clone().addScaledVector(rnd(), 0.03).addScaledVector(v, -f * 0.03), v, 0.03 + (1 - f) * 0.045 * Math.random() + 0.015, { splat: k % 4 === 0 });
      }
    }
    // gobs
    for (let k = 0; k < 4 + Math.random() * 4; k++) {
      const v = d.clone().multiplyScalar(force * (0.3 + Math.random() * 0.5)).addScaledVector(rnd(), force * 0.3);
      this.emit(p.clone().addScaledVector(rnd(), 0.06), v, 0.09 + Math.random() * 0.07, { splat: true });
    }
    // fine droplets
    for (let k = 0; k < count * 0.12; k++) {
      const v = d.clone().multiplyScalar(force * (0.4 + Math.random())).addScaledVector(rnd(), force * 0.7);
      this.emit(p.clone().addScaledVector(rnd(), 0.05), v, 0.012 + Math.random() * 0.02, { life: 1.4, drag: 0.6, alpha: 0.9 });
    }
  }

  // arterial jet from an open wound; call every frame with a 0..1 pulse strength. Dense and narrow so
  // consecutive frames' streaks join into one stream
  spurt(p, dir, strength = 1) {
    if (strength <= 0.03) return;
    const d = dir.clone().normalize();
    const n = Math.ceil(2 + strength * 7);
    const sp = 1.8 + strength * 3.2;
    for (let k = 0; k < n; k++) {
      const v = d.clone().multiplyScalar(sp * (0.85 + Math.random() * 0.3))
        .add(tmp.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.35 + strength * 0.25));
      const q = p.clone().addScaledVector(v, Math.random() / 30); // spread along the frame's travel: no gaps
      this.emit(q, v, 0.022 + Math.random() * 0.03 * (0.5 + strength), { splat: Math.random() < 0.08 });
    }
  }

  // slow drops/threads falling off something (a bloody mouth or fist)
  drip(p, n = 1, spread = 0.15) {
    for (let k = 0; k < n; k++) {
      const q = p.clone().add(tmp.set((Math.random() - 0.5) * spread, 0, (Math.random() - 0.5) * spread));
      this.emit(q, new THREE.Vector3(0, -0.6 - Math.random(), 0), 0.02 + Math.random() * 0.03, { drag: 0.05, splat: Math.random() < 0.4 });
    }
  }

  update(dt) {
    let top = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; this.size[i] = 0; continue; }
      top = i + 1;
      this.life[i] -= dt;
      const d = 1 - this.drag[i] * dt, j = i * 3;
      this.vel[j] *= d; this.vel[j + 1] = this.vel[j + 1] * d - 9.8 * dt; this.vel[j + 2] *= d;
      this.pos[j] += this.vel[j] * dt; this.pos[j + 1] += this.vel[j + 1] * dt; this.pos[j + 2] += this.vel[j + 2] * dt;
      const gy = this.ground ? this.ground(this.pos[j], this.pos[j + 2]) + 0.01 : 0.01;
      if (this.pos[j + 1] < gy) {
        if (this.splat[i]) this.onLand?.(this.pos[j], gy, this.pos[j + 2], this.size[i], this.vel[j], this.vel[j + 2]);
        this.life[i] = 0; this.alpha[i] = 0; this.size[i] = 0; // it's in the splat now
        continue;
      }
      if (this.life[i] < 0.3) this.alpha[i] *= 0.85;
    }
    this.geo.instanceCount = top;
    for (const a of [this.aPos, this.aVel, this.aSize, this.aAlpha, this.aShade]) a.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- floor splatter
function splatTexture(seed) {
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  let s = seed * 9301 + 49297; const R = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  g.fillStyle = 'rgb(58,3,2)';
  // main body: overlapping blobs, pushed forward (+x = direction of travel)
  for (let k = 0; k < 14; k++) { g.beginPath(); g.arc(S * 0.42 + (R() - 0.3) * S * 0.2, S / 2 + (R() - 0.5) * S * 0.16, S * (0.05 + R() * 0.08), 0, 6.283); g.fill(); }
  // spines and satellite droplets thrown forward
  for (let k = 0; k < 22; k++) {
    const a = (R() - 0.5) * 2.2, len = S * (0.12 + R() * 0.3);
    const x0 = S * 0.45, y0 = S / 2, x1 = x0 + Math.cos(a) * len, y1 = y0 + Math.sin(a) * len;
    g.strokeStyle = 'rgb(58,3,2)'; g.lineWidth = 1 + R() * 4; g.lineCap = 'round';
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    g.beginPath(); g.arc(x1 + Math.cos(a) * 6, y1 + Math.sin(a) * 6, 1.5 + R() * 5, 0, 6.283); g.fill();
  }
  for (let k = 0; k < 30; k++) { g.beginPath(); g.arc(S * (0.3 + R() * 0.65), S * (0.15 + R() * 0.7), 0.8 + R() * 2.5, 0, 6.283); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class BloodSplats {
  constructor(scene, max = 260) {
    this.scene = scene; this.max = max; this.list = [];
    this.geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.mats = [0, 1, 2, 3].map((k) => new THREE.MeshStandardMaterial({
      map: splatTexture(k + 1), transparent: true, depthWrite: false, roughness: 0.12, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: -3, color: 0xffffff,
    }));
    this.frame = -1; this.count = 0;
  }
  // size: drop size (m); vx,vz: its horizontal velocity, which stretches and orients the splatter
  add(x, y, z, size, vx = 0, vz = 0, frame = 0) {
    if (frame !== this.frame) { this.frame = frame; this.count = 0; }
    if (this.count++ > 5) return; // a few per frame is plenty
    const sp = Math.hypot(vx, vz);
    const s = 0.1 + size * 5 * (0.7 + Math.random() * 0.6);
    const m = new THREE.Mesh(this.geo, this.mats[Math.floor(Math.random() * this.mats.length)]);
    m.scale.set(s * (1 + Math.min(sp, 6) * 0.25), 1, s);
    m.rotation.y = sp > 0.2 ? Math.atan2(-vz, vx) : Math.random() * 6.283;
    m.position.set(x, y + 0.012 + (this.list.length % 9) * 0.0015, z);
    m.receiveShadow = true;
    this.scene.add(m); this.list.push(m);
    if (this.list.length > this.max) this.scene.remove(this.list.shift());
  }
}

// ---------------------------------------------------------------- blood on the giant's skin
// Stains live in the skin's rest-pose (bind) space, so they ride along with his jaw and fist.
export class SkinStains {
  constructor(character, max = 8) {
    this.max = max;
    this.cy = character;
    this.data = Array.from({ length: max }, () => new THREE.Vector4(0, 0, 0, 0)); // xyz rest pos, w radius
    this.amt = new Float32Array(max);
    this.drip = new Float32Array(max); // how far it runs downward (chin, wrist)
    this.slots = {};
    this.meshes = [];
    character.model.traverse((o) => { if (o.isSkinnedMesh && o.material === character.skin) this.meshes.push(o); });
    const m = character.skin;
    if (!m || !this.meshes.length) return;
    this.mesh = this.meshes[0];
    const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey?.bind(m);
    const self = this;
    m.onBeforeCompile = (s, r) => {
      prev?.call(m, s, r);
      s.uniforms.uStain = { value: self.data };
      s.uniforms.uStainAmt = { value: self.amt };
      s.uniforms.uStainDrip = { value: self.drip };
      if (!s.vertexShader.includes('varying vec3 vOPos')) {
        s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vOPos;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvOPos = position;');
        s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vOPos;');
      }
      s.fragmentShader = s.fragmentShader
        .replace('#include <common>', `#include <common>
uniform vec4 uStain[${max}]; uniform float uStainAmt[${max}]; uniform float uStainDrip[${max}];
float bh(vec3 p){ p = fract(p*0.3183099+.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float bn(vec3 x){ vec3 i=floor(x); vec3 f=fract(x); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(bh(i),bh(i+vec3(1,0,0)),f.x),mix(bh(i+vec3(0,1,0)),bh(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(bh(i+vec3(0,0,1)),bh(i+vec3(1,0,1)),f.x),mix(bh(i+vec3(0,1,1)),bh(i+vec3(1,1,1)),f.x),f.y),f.z); }
float bloodMask(vec3 p){
  float m = 0.0;
  for (int i = 0; i < ${max}; i++) {
    if (uStainAmt[i] <= 0.0) continue;
    vec3 c = uStain[i].xyz; float r = uStain[i].w;
    vec3 d = p - c;
    // below the centre it runs down in rivulets
    float below = max(-d.y, 0.0);
    float streak = smoothstep(0.55, 0.8, bn(vec3(p.x, 0.0, p.z) * (6.0 / r)));
    d.y = d.y < 0.0 ? d.y / (1.0 + uStainDrip[i] * (0.4 + 3.0 * streak)) : d.y;
    float e = length(d) / r + (bn(p * (4.0 / r)) - 0.5) * 0.7 + (bn(p * (13.0 / r)) - 0.5) * 0.25;
    m = max(m, smoothstep(1.0, 0.7, e) * uStainAmt[i]);
  }
  return m;
}`)
        .replace('#include <map_fragment>', `#include <map_fragment>
float bM = bloodMask(vOPos);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.012, 0.008) * (0.7 + 0.3 * bn(vOPos * 60.0)), bM * 0.92);`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.16, bM);`);
    };
    m.customProgramCacheKey = () => (prevKey ? prevKey() : '') + '+blood';
    m.needsUpdate = true;
  }

  // world point + the bone it belongs to -> rest-pose position of the skin mesh
  toRest(world, bone) {
    const mesh = this.mesh, sk = mesh.skeleton, bi = sk.bones.indexOf(bone);
    if (bi < 0) return null;
    mesh.updateMatrixWorld(true);
    // skinning: world = meshWorld * bindMatrixInverse * boneWorld * boneInverse * bindMatrix * rest
    // (in 'attached' mode three keeps bindMatrixInverse = meshWorld^-1, so don't assume it inverts bindMatrix)
    const inv = (m) => new THREE.Matrix4().copy(m).invert();
    const M = inv(mesh.bindMatrix)
      .multiply(inv(sk.boneInverses[bi]))
      .multiply(inv(bone.matrixWorld))
      .multiply(inv(mesh.bindMatrixInverse))
      .multiply(inv(mesh.matrixWorld));
    return world.clone().applyMatrix4(M);
  }

  // grow (or create) a named stain at a world point on the given bone. radius in world metres
  add(name, world, bone, radius, grow = 1, drip = 0) {
    const rest = this.toRest(world, bone); if (!rest) return;
    const scl = this.mesh.matrixWorld.getMaxScaleOnAxis() || 1;
    let i = this.slots[name];
    if (i === undefined) {
      i = Object.keys(this.slots).length; if (i >= this.max) i = this.max - 1;
      this.slots[name] = i; this.data[i].set(rest.x, rest.y, rest.z, 0); this.amt[i] = 0;
    } else this.data[i].lerp(new THREE.Vector4(rest.x, rest.y, rest.z, this.data[i].w), 0.3);
    const r = radius / scl;
    this.data[i].w = Math.max(this.data[i].w, 0) + r * grow * (this.data[i].w > 0 ? 0.35 : 1);
    this.amt[i] = 1;
    this.drip[i] = Math.max(this.drip[i], drip);
  }
}

// ---------------------------------------------------------------- torn stump
const stumpMat = new THREE.MeshStandardMaterial({ color: 0x3d0605, roughness: 0.22, metalness: 0 });
const stumpGeo = (() => {
  const g = new THREE.IcosahedronGeometry(1, 3), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = 0.75 + 0.35 * Math.sin(x * 7.1 + y * 3.3) * Math.sin(z * 6.7 - x * 2.1) + (Math.random() - 0.5) * 0.18;
    p.setXYZ(i, x * n, y * n * 0.55, z * n);
  }
  g.computeVertexNormals();
  return g;
})();
// bone: the bitten-off bone (collapsed to ~0 scale). The cap sits at its joint, on the parent, in world metres
export function addStump(bone, radius) {
  const parent = bone.parent; if (!parent) return null;
  const m = new THREE.Mesh(stumpGeo, stumpMat);
  const at = bone.getWorldPosition(new THREE.Vector3());
  const dir = at.clone().sub(parent.getWorldPosition(new THREE.Vector3())).normalize();
  m.position.copy(at);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.lengthSq() > 0 ? dir : new THREE.Vector3(0, 1, 0));
  m.scale.setScalar(radius);
  m.castShadow = true;
  parent.updateMatrixWorld(true);
  parent.attach(m);
  return m;
}
