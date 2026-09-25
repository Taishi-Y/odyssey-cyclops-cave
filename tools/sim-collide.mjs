// dev check: drive a capsule into the cave walls from many spots/directions and report penetrations
import fs from 'fs';
import * as THREE from 'three';
import { Physics } from '../src/physics.js';
import { rockField, floorHeightAt } from '../src/cave.js';
const ab = fs.readFileSync(new URL('../public/assets/cave.bin', import.meta.url)).buffer;
const n = new DataView(ab).getUint32(0, true);
const g = new THREE.BufferGeometry();
g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ab.slice(4, 4 + n * 12)), 3));
const phys = new Physics([new THREE.Mesh(g)]);
const radius = 0.32, height = 1.78;
let bad = 0, total = 0; const worstList = [];
const starts = [[3, 12], [-3, 1], [5, -5], [-10, -8], [10, -6], [-14, -12], [14, -9], [0, -12], [-15, 0], [15, 2], [1.5, 20]];
for (const [sx, sz] of starts) for (let a = 0; a < 6.28; a += 0.2) for (const speed of [3.3, 6.2]) {
  const pos = new THREE.Vector3(sx, floorHeightAt(sx, sz), sz), vel = new THREE.Vector3();
  let worst = -9, onGround = false, climbing = false;
  for (let f = 0; f < 240; f++) {
    const dt = 1 / 20;
    vel.x += (-Math.sin(a) * speed - vel.x) * Math.min(1, 12 * dt); vel.z += (-Math.cos(a) * speed - vel.z) * Math.min(1, 12 * dt);
    const fx = -Math.sin(a), fz = -Math.cos(a);
    const rockAt = (h, d) => rockField(pos.x + fx * d, pos.y + h, pos.z + fz * d) > 0;
    const wallAhead = rockAt(1.0, 0.6) && rockAt(1.6, 0.65);
    if (!climbing && wallAhead) climbing = true;
    if (climbing) {
      const headBlocked = rockField(pos.x, pos.y + 2.1, pos.z) > -0.1;
      const topClear = !rockAt(1.9, 0.6) && !rockAt(1.5, 0.6);
      if (topClear) { vel.set(fx * 3, 4.2, fz * 3); climbing = false; }
      else if (!wallAhead || headBlocked || f > 200) climbing = false;
      else vel.set(fx * 0.8, 1.5, fz * 0.8);
    }
    if (!climbing) vel.y -= 18 * dt;
    let grounded = false;
    for (let i = 0; i < 3; i++) {
      const prev = pos.clone();
      pos.addScaledVector(vel, dt / 3);
      const r = phys.collideCapsule(pos, radius, height, vel); grounded ||= r.onGround;
      const inRock = (y) => rockField(pos.x, pos.y + y, pos.z) > -0.25;
      if (inRock(height - 0.1) || inRock(height * 0.6)) { pos.x = prev.x; pos.z = prev.z; if (inRock(height - 0.1)) pos.y = Math.min(pos.y, prev.y); vel.x *= 0.2; vel.z *= 0.2; }
    }
    if (grounded && vel.y < 0) vel.y = 0;
    for (const y of [0.35, 0.9, 1.5]) worst = Math.max(worst, rockField(pos.x, pos.y + y, pos.z));
    if (pos.y < -3) { worst = 99; break; }
  }
  total++;
  if (worst > 0) { bad++; worstList.push([sx, sz, a.toFixed(1), speed, pos.x.toFixed(1), pos.y.toFixed(1), pos.z.toFixed(1), worst.toFixed(2)]); }
}
console.log('runs', total, 'penetrating', bad);
console.log(worstList.slice(0, 20).map((r) => r.join(' ')).join('\n'));
