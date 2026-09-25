import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { floorHeightAt } from './cave.js';

// Sheep: "Realistic Woolly Sheep - Thick Curled Fleece" by Pigcraft (CC-BY 4.0), decimated from 1.9M to 5k
// triangles in Blender with the fleece baked into colour + normal maps (work/sheep/build_sheep.py).
// One InstancedMesh draws the whole flock. Legs and head are animated in the vertex shader from per-vertex
// weights computed at load time, so the mesh stays in one piece (no seams) and costs one draw call.
const SCALE = 1.2;

// per-vertex rig: which leg (0 front-left, 1 front-right, 2 back-left, 3 back-right) and how strongly, plus head weight
function rigGeometry(g) {
  const p = g.attributes.position, n = p.count;
  const box = new THREE.Box3().setFromBufferAttribute(p), size = box.getSize(new THREE.Vector3());
  const minY = box.min.y, H = size.y, L = size.x;
  // leg centres from the low vertices, one per quadrant
  const acc = [0, 1, 2, 3].map(() => [0, 0, 0]);
  const quad = (x, z) => (x > 0 ? 0 : 2) + (z > 0 ? 0 : 1);
  for (let i = 0; i < n; i++) {
    if (p.getY(i) - minY > H * 0.12) continue;
    const q = quad(p.getX(i), p.getZ(i)); acc[q][0] += p.getX(i); acc[q][1] += p.getZ(i); acc[q][2]++;
  }
  const hipY = minY + H * 0.52;
  const legs = acc.map((a) => new THREE.Vector3(a[0] / Math.max(1, a[2]), hipY, a[1] / Math.max(1, a[2])));
  const neck = new THREE.Vector3(box.max.x - L * 0.3, minY + H * 0.72, 0);
  const leg = new Float32Array(n * 2), head = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const q = quad(x, z);
    leg[i * 2] = q;
    leg[i * 2 + 1] = THREE.MathUtils.smoothstep(hipY - y, 0.0, H * 0.22);
    head[i] = THREE.MathUtils.smoothstep(x - neck.x, -L * 0.06, L * 0.1) * THREE.MathUtils.smoothstep(y - minY, H * 0.5, H * 0.68);
  }
  g.setAttribute('aLeg', new THREE.BufferAttribute(leg, 2));
  g.setAttribute('aHead', new THREE.BufferAttribute(head, 1));
  return { legs, neck };
}

function animateMaterial(m, rig) {
  const L = rig.legs, N = rig.neck;
  const v3 = (v) => `vec3(${v.x.toFixed(4)}, ${v.y.toFixed(4)}, ${v.z.toFixed(4)})`;
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec2 aLeg; attribute float aHead; attribute vec4 aAnim; // aAnim: leg swing, graze, look, -
mat3 rotZ(float a){ float c=cos(a), s=sin(a); return mat3(c,s,0., -s,c,0., 0.,0.,1.); }
mat3 rotY(float a){ float c=cos(a), s=sin(a); return mat3(c,0.,-s, 0.,1.,0., s,0.,c); }`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
vec3 animPos = position;
{
  int k = int(aLeg.x + 0.5);
  vec3 hip = k == 0 ? ${v3(L[0])} : k == 1 ? ${v3(L[1])} : k == 2 ? ${v3(L[2])} : ${v3(L[3])};
  float sw = (k == 0 || k == 3 ? aAnim.x : -aAnim.x) * 0.7 * aLeg.y;
  mat3 R = rotZ(sw);
  animPos = hip + R * (animPos - hip); objectNormal = R * objectNormal;
  mat3 Hd = rotY(aAnim.z * aHead) * rotZ(-aAnim.y * 1.15 * aHead);
  animPos = ${v3(N)} + Hd * (animPos - ${v3(N)}); objectNormal = Hd * objectNormal;
  animPos.y -= aAnim.y * 0.22 * aHead; // reach down to the grass
}`)
      .replace('#include <begin_vertex>', 'vec3 transformed = animPos;');
  };
  m.customProgramCacheKey = () => 'sheep-anim';
}

export class Flock {
  constructor(scene, count = 40, center = new THREE.Vector3(12, 0, -6), radius = 6) {
    this.count = count;
    this.anim = new Float32Array(count * 4);
    this.body = null;
    this.ready = new GLTFLoader().loadAsync('assets/models/sheep/sheep.glb').then((gltf) => {
      let src = null; gltf.scene.traverse((o) => { if (o.isMesh && !src) src = o; });
      const g = src.geometry; g.scale(SCALE, SCALE, SCALE);
      const rig = rigGeometry(g);
      g.setAttribute('aAnim', new THREE.InstancedBufferAttribute(this.anim, 4).setUsage(THREE.DynamicDrawUsage));
      const m = src.material; m.roughness = 1; m.metalness = 0;
      animateMaterial(m, rig);
      this.body = new THREE.InstancedMesh(g, m, count);
      this.body.castShadow = true; this.body.receiveShadow = true; this.body.frustumCulled = false;
      this.body.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < count; i++) this.body.setColorAt(i, new THREE.Color().setScalar(this.sheep[i].tint));
      scene.add(this.body);
    });
    this.sheep = [];
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * radius;
      const pos = new THREE.Vector3(center.x + Math.cos(a) * d, 0, center.z + Math.sin(a) * d);
      this.sheep.push({
        pos, vel: new THREE.Vector3(), heading: Math.random() * Math.PI * 2, size: 0.85 + Math.random() * 0.3,
        phase: Math.random() * 10, goal: null, idle: Math.random() * 5, bleat: 0, stuck: [], out: false, graze: 0,
        tint: 0.8 + Math.random() * 0.25,
      });
    }
    this.center = center.clone(); this.radius = radius;
    this.mode = 'pen';       // pen | wander | exit
    this.exitPoint = null;
    this.M = new THREE.Matrix4(); this.Q = new THREE.Quaternion(); this.S = new THREE.Vector3(); this.P = new THREE.Vector3();
    this.onBleat = null;
  }

  update(dt, t, ctx) {
    const { player, cyclops, nav } = ctx;
    const tmp = new THREE.Vector3();
    for (let i = 0; i < this.count; i++) {
      const s = this.sheep[i];
      if (s.out) continue;
      // steering
      const desired = new THREE.Vector3();
      if (this.mode === 'exit' && this.exitPoint) {
        // stream toward the gate in a loose single file
        const target = s.pos.z < this.exitPoint.z - 6 ? new THREE.Vector3(this.exitPoint.x * 0.6, 0, this.exitPoint.z - 5) : this.exitPoint;
        desired.subVectors(target, s.pos).setY(0);
        const d = desired.length();
        desired.normalize().multiplyScalar(i < this.released ? 1.05 : 0.0);
        if (s.pos.z > this.exitPoint.z + 2) s.out = true;
        if (d < 1 && this.exitPoint2) this.exitPoint = this.exitPoint2;
      } else {
        s.idle -= dt;
        if (s.idle < 0) {
          s.idle = 3 + Math.random() * 8;
          if (Math.random() < 0.55) {
            const a = Math.random() * 6.28, r = Math.random() * this.radius;
            s.goal = new THREE.Vector3(this.center.x + Math.cos(a) * r, 0, this.center.z + Math.sin(a) * r);
          } else s.goal = null;
        }
        if (s.goal) {
          desired.subVectors(s.goal, s.pos).setY(0);
          if (desired.length() < 0.5) s.goal = null;
          else desired.normalize().multiplyScalar(0.45);
        }
      }
      // flee the player if he's upright and close (unless disguised)
      if (player && !player.disguised) {
        tmp.subVectors(s.pos, player.pos).setY(0);
        const d = tmp.length();
        if (d < 2.6) { desired.add(tmp.normalize().multiplyScalar((2.6 - d) * 1.4)); if (Math.random() < dt * 0.4) s.bleat = 1; }
      }
      // separation
      for (let j = 0; j < this.count; j++) {
        if (j === i) continue;
        const o = this.sheep[j];
        const dx = s.pos.x - o.pos.x, dz = s.pos.z - o.pos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < 1.1 && d2 > 1e-4) { const d = Math.sqrt(d2); desired.x += (dx / d) * (1.05 - d) * 1.6; desired.z += (dz / d) * (1.05 - d) * 1.6; }
      }
      // out past the door the sheep are in the narrow slot, beyond sight: let them through
      const free = !nav || (this.mode === 'exit' && s.pos.z > 17.5);
      if (!free) {
        const nx = s.pos.x + desired.x * dt * 2, nz = s.pos.z + desired.z * dt * 2;
        if (!nav.canStep(s.pos.x, s.pos.z, nx, nz)) desired.multiplyScalar(-0.5);
      }
      s.vel.lerp(desired, Math.min(1, dt * 2.5));
      const sp = s.vel.length();
      if (sp > 0.05) {
        const h = Math.atan2(-s.vel.z, s.vel.x);
        let dh = h - s.heading; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
        s.heading += dh * Math.min(1, dt * 4);
      }
      if (free) s.pos.addScaledVector(s.vel, dt);
      else if (!nav.step(s.pos, s.vel.x * dt, s.vel.z * dt)) { s.vel.x *= -0.3; s.vel.z *= -0.3; }
      s.pos.y = (nav && nav.floorY(s.pos.x, s.pos.z)) ?? floorHeightAt(s.pos.x, s.pos.z);
      s.phase += dt * (1 + sp * 9);
      s.graze = THREE.MathUtils.lerp(s.graze, sp < 0.1 ? 1 : 0, dt * 1.5);
      if (s.bleat > 0) { s.bleat = 0; this.onBleat?.(s.pos); }
      else if (Math.random() < dt * 0.012) this.onBleat?.(s.pos);
      this.writeInstance(i, s, sp, t);
    }
    if (this.body) { this.body.instanceMatrix.needsUpdate = true; this.body.geometry.attributes.aAnim.needsUpdate = true; }
  }

  writeInstance(i, s, sp, t) {
    if (!this.body) return;
    const { M, Q, S, P } = this;
    const sz = s.size;
    const bob = Math.abs(Math.sin(s.phase * 2)) * 0.03 * Math.min(1, sp * 3);
    Q.setFromAxisAngle(P.set(0, 1, 0), s.heading);
    M.compose(P.copy(s.pos).setY(s.pos.y + bob), Q, S.set(sz, sz, sz));
    this.body.setMatrixAt(i, M);
    // legs swing while walking, head droops when grazing and looks around when idle
    const a = this.anim;
    a[i * 4] = Math.sin(s.phase * 2) * 0.45 * Math.min(1, sp * 2.5);
    a[i * 4 + 1] = s.graze;
    a[i * 4 + 2] = Math.sin(t * 0.7 + s.phase) * 0.3 * (1 - s.graze);
  }

  nearest(p, maxD = 99) {
    let best = null, bd = maxD;
    for (const s of this.sheep) { if (s.out) continue; const d = s.pos.distanceTo(p); if (d < bd) { bd = d; best = s; } }
    return best;
  }
}
