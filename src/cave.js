import * as THREE from 'three';
import { MarchingCubes } from 'three/addons/objects/MarchingCubes.js';
import { fbm3, noise3 } from './noise.js';

// Layout (meters). Floor at y=0, entrance tunnel toward +z, ceiling crack above.
export const LAYOUT = {
  chamber: { c: new THREE.Vector3(0, 10, -2), r: new THREE.Vector3(21, 16, 15) },
  alcove: { c: new THREE.Vector3(-13, 5, -13), r: 8.5 },    // cyclops sleeps here
  pen: { c: new THREE.Vector3(14, 4, -9), r: 7.5 },          // sheep pen
  tunnelZ0: 8, tunnelZ1: 60, tunnelHalfW: 5.2, tunnelH: 13.5,
  crack: { x: 5.5, z: -3, len: 5.5, w: 0.9, y0: 17 },
  boulderZ: 17.5,
  exitZ: 34,
};

const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };

function tunnelX(z) { return (z - LAYOUT.tunnelZ0) * 0.09; }
function tunnelFloor(z) { return Math.max(0, (z - 12) * 0.05); }

// signed distance to AIR (negative inside the air space)
export function airDist(x, y, z) {
  const L = LAYOUT;
  const c = L.chamber;
  const ex = (x - c.c.x) / c.r.x, ey = (y - c.c.y) / c.r.y, ez = (z - c.c.z) / c.r.z;
  let d = (Math.sqrt(ex * ex + ey * ey + ez * ez) - 1) * 14;
  const a = L.alcove;
  d = smin(d, Math.hypot(x - a.c.x, (y - a.c.y) * 1.25, z - a.c.z) - a.r, 6);
  const p = L.pen;
  d = smin(d, Math.hypot(x - p.c.x, (y - p.c.y) * 1.3, z - p.c.z) - p.r, 5);
  // triangular tunnel
  const tx = Math.abs(x - tunnelX(z));
  const ty = y - tunnelFloor(z) + 1.0;
  const b = L.tunnelHalfW, h = L.tunnelH;
  let dt = Math.max(-ty, (tx * h + ty * b - b * h) / Math.hypot(h, b));
  dt = Math.max(dt, L.tunnelZ0 - z);
  d = smin(d, dt, 4);
  // ceiling crack (narrow slot open to the sky)
  const k = L.crack;
  const dx = Math.abs(x - k.x - (y - k.y0) * 0.12) - k.w * (1 + (y - k.y0) * 0.05);
  const dz = Math.abs(z - k.z) - k.len;
  const dcrack = Math.max(Math.max(dx, dz), k.y0 - y);
  d = Math.min(d, dcrack);
  // floor: air only above the floor surface
  const floorH = 0.55 * fbm3(x * 0.12, 0, z * 0.12, 4) + 0.12 * noise3(x * 0.9, 0, z * 0.9) + Math.max(0, tunnelFloor(z) * (z > 10 ? 1 : 0));
  d = Math.max(d, floorH - y);
  return d;
}

// rock density used for meshing (positive = rock)
export function rockField(x, y, z) {
  let d = airDist(x, y, z);
  // big irregular masses + overhangs
  d += 4.5 * fbm3(x * 0.035 + 11, y * 0.045, z * 0.035, 3);
  // lumpy limestone
  d += 1.6 * fbm3(x * 0.09, y * 0.09, z * 0.09, 4);
  // vertical flowstone drapery
  d += 0.9 * fbm3(x * 0.35, y * 0.035, z * 0.35, 3);
  // small detail
  d += 0.18 * noise3(x * 1.3, y * 1.3, z * 1.3);
  // keep the floor walkable and smooth
  const floorBlend = Math.min(1, Math.max(0, (y - 0.2) / 2.5));
  return d * (0.35 + 0.65 * floorBlend) + airDist(x, y, z) * (1 - floorBlend) * 0.65;
}

export function buildCave(onProgress) {
  const RES = 150;
  const half = new THREE.Vector3(30, 17, 30);
  const center = new THREE.Vector3(0, 14, 4);
  const mc = new MarchingCubes(RES, new THREE.MeshBasicMaterial(), false, false, 900000);
  mc.isolation = 0;
  const f = mc.field;
  for (let k = 0; k < RES; k++) {
    const wz = ((k - RES / 2) / (RES / 2)) * half.z + center.z;
    for (let j = 0; j < RES; j++) {
      const wy = ((j - RES / 2) / (RES / 2)) * half.y + center.y;
      for (let i = 0; i < RES; i++) {
        const wx = ((i - RES / 2) / (RES / 2)) * half.x + center.x;
        f[k * RES * RES + j * RES + i] = rockField(wx, wy, wz);
      }
    }
    if (onProgress && k % 10 === 0) onProgress(k / RES);
  }
  mc.update();
  const n = mc.count;
  const pos = new Float32Array(n * 3);
  const nrm = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const src = mc.positionArray;
  const e = 0.25;
  for (let v = 0; v < n; v++) {
    const x = src[v * 3] * half.x + center.x;
    const y = src[v * 3 + 1] * half.y + center.y;
    const z = src[v * 3 + 2] * half.z + center.z;
    pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z;
    // normal = -grad(rock) (points into the air)
    let gx = rockField(x + e, y, z) - rockField(x - e, y, z);
    let gy = rockField(x, y + e, z) - rockField(x, y - e, z);
    let gz = rockField(x, y, z + e) - rockField(x, y, z - e);
    const l = Math.hypot(gx, gy, gz) || 1;
    gx = -gx / l; gy = -gy / l; gz = -gz / l;
    nrm[v * 3] = gx; nrm[v * 3 + 1] = gy; nrm[v * 3 + 2] = gz;
    // cheap cavity AO: how much rock surrounds this point along the normal
    let occ = 0;
    for (const s of [0.6, 1.6, 3.5]) {
      const r = rockField(x + gx * s, y + gy * s, z + gz * s);
      occ += Math.max(0, (r + s) / s) * (s === 0.6 ? 0.25 : 0.3);
    }
    const ao = Math.max(0.15, Math.min(1, 1 - occ * 0.55));
    col[v * 3] = ao; col[v * 3 + 1] = ao; col[v * 3 + 2] = ao;
  }
  mc.geometry.dispose();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeBoundingBox(); g.computeBoundingSphere();
  return g;
}

export function floorHeightAt(x, z) {
  if (z > 33) return tunnelFloor(z) - 0.2; // outside the meshed volume
  // walk down from above and return the first air -> rock transition
  let wasAir = false;
  for (let y = 4; y > -1.5; y -= 0.1) {
    const rock = rockField(x, y, z) > 0;
    if (!rock) wasAir = true;
    else if (wasAir) return y + 0.05;
  }
  return 0;
}
