import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeWoolMaterial } from './materials.js';
import { fbm3 } from './noise.js';
import { floorHeightAt } from './cave.js';

// Procedural Greek sheep: lumpy dirty cream wool body, dark lean face, thin legs.
function woolBody() {
  const g = mergeVertices(new THREE.IcosahedronGeometry(0.5, 12));
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = v.clone().normalize();
    const lump = fbm3(n.x * 4, n.y * 4, n.z * 4, 3) * 0.16 + fbm3(n.x * 12, n.y * 12, n.z * 12, 2) * 0.05;
    v.copy(n).multiplyScalar(0.5 + lump);
    v.x *= 1.25; v.y *= 0.78; v.z *= 0.72;
    // belly sag, dirty underside
    if (v.y < 0) v.y *= 1.1;
    p.setXYZ(i, v.x, v.y, v.z);
    const dirt = THREE.MathUtils.clamp(0.75 + v.y * 0.7 + lump * 0.8, 0.35, 1.05);
    col[i * 3] = dirt; col[i * 3 + 1] = dirt * 0.95; col[i * 3 + 2] = dirt * 0.86;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

function headGeo() {
  // long Roman-nosed face, drooping ears
  const skull = new THREE.SphereGeometry(0.11, 20, 14); skull.scale(1.25, 1.05, 0.9);
  const muzzle = new THREE.CylinderGeometry(0.055, 0.085, 0.24, 16, 1); muzzle.rotateZ(Math.PI / 2 + 0.35); muzzle.translate(0.15, -0.07, 0);
  const nose = new THREE.SphereGeometry(0.058, 14, 10); nose.scale(1, 0.9, 1.05); nose.translate(0.26, -0.12, 0);
  const earL = new THREE.SphereGeometry(0.05, 10, 8); earL.scale(0.5, 0.35, 1.9); earL.rotateX(0.5); earL.translate(-0.02, 0.02, 0.14);
  const earR = new THREE.SphereGeometry(0.05, 10, 8); earR.scale(0.5, 0.35, 1.9); earR.rotateX(-0.5); earR.translate(-0.02, 0.02, -0.14);
  const g = mergeGeometries([skull, muzzle, nose, earL, earR].map((g) => g.toNonIndexed()));
  return g;
}

function makeShellMaterial(h) {
  const m = new THREE.MeshStandardMaterial({ color: 0xd8cbb0, roughness: 1, vertexColors: true });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uH = { value: h };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uH; varying vec3 vP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvP = position; transformed += normal * uH * 0.075; transformed.y -= uH*uH*0.02;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uH; varying vec3 vP;
float hh(vec3 p){ return fract(sin(dot(p, vec3(127.1,311.7,74.7)))*43758.5453); }
float vn(vec3 x){ vec3 i=floor(x); vec3 f=fract(x); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(hh(i),hh(i+vec3(1,0,0)),f.x),mix(hh(i+vec3(0,1,0)),hh(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hh(i+vec3(0,0,1)),hh(i+vec3(1,0,1)),f.x),mix(hh(i+vec3(0,1,1)),hh(i+vec3(1,1,1)),f.x),f.y),f.z); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
float clump = vn(vP*16.0);                 // locks of wool
float strand = vn(vP*130.0 + clump*3.0);   // fibres
float dens = clump*0.65 + strand*0.45;
if (dens < uH*0.95 + 0.12) discard;
diffuseColor.rgb *= mix(0.35, 1.05, uH) * (0.8 + clump*0.35);`);
  };
  m.customProgramCacheKey = () => 'shell' + h;
  return m;
}

export class Flock {
  constructor(scene, count = 40, center = new THREE.Vector3(12, 0, -6), radius = 6) {
    this.count = count;
    const woolMat = makeWoolMaterial();
    const faceMat = new THREE.MeshStandardMaterial({ color: 0x2b211b, roughness: 0.8 });
    const legMat = new THREE.MeshStandardMaterial({ color: 0x3a2e25, roughness: 0.9 });
    const bodyGeo = woolBody();
    this.body = new THREE.InstancedMesh(bodyGeo, woolMat, count);
    // fur shells: layered alpha-tested strands give the fleece real volume
    this.shells = [];
    const SHELLS = 14;
    for (let k = 1; k <= SHELLS; k++) {
      const m = makeShellMaterial(k / SHELLS);
      const sh = new THREE.InstancedMesh(bodyGeo, m, count);
      sh.castShadow = k < 4; sh.receiveShadow = true; sh.frustumCulled = false;
      scene.add(sh); this.shells.push(sh);
    }
    this.head = new THREE.InstancedMesh(headGeo(), faceMat, count);
    const legG = new THREE.CylinderGeometry(0.035, 0.025, 0.5, 6); legG.translate(0, -0.25, 0);
    this.legs = new THREE.InstancedMesh(legG, legMat, count * 4);
    for (const m of [this.body, this.head, this.legs]) { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; scene.add(m); }
    this.sheep = [];
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * radius;
      const pos = new THREE.Vector3(center.x + Math.cos(a) * d, 0, center.z + Math.sin(a) * d);
      this.sheep.push({
        pos, vel: new THREE.Vector3(), heading: Math.random() * Math.PI * 2, size: 0.85 + Math.random() * 0.3,
        phase: Math.random() * 10, goal: null, idle: Math.random() * 5, bleat: 0, stuck: [], out: false, graze: 0,
        tint: 0.8 + Math.random() * 0.25,
      });
      this.body.setColorAt(i, new THREE.Color().setScalar(0.8 + Math.random() * 0.25));
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
    for (const sh of this.shells) { sh.instanceMatrix = this.body.instanceMatrix; }
    this.body.instanceMatrix.needsUpdate = true; this.head.instanceMatrix.needsUpdate = true; this.legs.instanceMatrix.needsUpdate = true;
  }

  writeInstance(i, s, sp, t) {
    const { M, Q, S, P } = this;
    const sz = s.size;
    const bob = Math.abs(Math.sin(s.phase * 2)) * 0.03 * Math.min(1, sp * 3);
    const base = new THREE.Matrix4().compose(s.pos, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.heading), new THREE.Vector3(sz, sz, sz));
    // body
    M.compose(P.set(0, 0.78 + bob, 0), Q.identity(), S.set(1, 1, 1)); M.premultiply(base); this.body.setMatrixAt(i, M);
    // head: droops when grazing, looks around when idle
    const look = Math.sin(t * 0.7 + s.phase) * 0.3 * (1 - s.graze);
    Q.setFromEuler(new THREE.Euler(0, look, -0.35 - s.graze * 0.7));
    M.compose(P.set(0.72, 0.88 - s.graze * 0.35 + bob, 0), Q, S.set(1, 1, 1)); M.premultiply(base); this.head.setMatrixAt(i, M);
    // legs
    const legs = [[0.38, 0.17], [0.38, -0.17], [-0.36, 0.17], [-0.36, -0.17]];
    for (let k = 0; k < 4; k++) {
      const sw = Math.sin(s.phase * 2 + (k === 0 || k === 3 ? 0 : Math.PI)) * 0.45 * Math.min(1, sp * 2.5);
      Q.setFromEuler(new THREE.Euler(0, 0, sw));
      M.compose(P.set(legs[k][0], 0.52, legs[k][1]), Q, S.set(1, 1, 1)); M.premultiply(base); this.legs.setMatrixAt(i * 4 + k, M);
    }
  }

  nearest(p, maxD = 99) {
    let best = null, bd = maxD;
    for (const s of this.sheep) { if (s.out) continue; const d = s.pos.distanceTo(p); if (d < bd) { bd = d; best = s; } }
    return best;
  }
}
