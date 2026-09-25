import { rockField, airDist } from './cave.js';

// floor height: the LOWEST air->rock transition that has head-room above it
// (cave.floorHeightAt only looks from y=4 down, so it misses the raised ledges on the east side)
export function floorAt(x, z, headroom = 1.6) {
  let best = null, airTop = null, prevRock = true;
  for (let y = 10; y > -1.5; y -= 0.25) {
    const rock = rockField(x, y, z) > 0;
    if (!rock && prevRock) airTop = y;
    if (rock && !prevRock) {
      let lo = y, hi = y + 0.25;
      for (let b = 0; b < 4; b++) { const m = (lo + hi) / 2; if (rockField(x, m, z) > 0) lo = m; else hi = m; }
      if (airTop - hi >= headroom || best === null) best = hi;
    }
    prevRock = rock;
  }
  return best ?? 0;
}

// grids used by the game (params are shared with tools/bake-nav.mjs)
export const NAV_SPECS = {
  // the 13 m giant: legs/hips everywhere, plus the chest inside the chamber
  giant: { radius: 1.2, heights: [1, 3, 5, 7], x0: -30, x1: 30, z0: -24, z1: 24, cell: 0.75 },
  // men and sheep
  man: { radius: 0.35, heights: [0.6, 1.1, 1.6], maxSlope: 1.2, x0: -30, x1: 30, z0: -24, z1: 34, cell: 0.5 },
};
const heightsAt = { giant: (z) => (z > 12 ? [1, 3, 5] : [1, 3, 5, 7]) };
export function buildNav(name, baked = null) { return new NavGrid({ ...NAV_SPECS[name], heightsAt: heightsAt[name], baked }); }

// Walkability grid built from the SAME rock density the cave mesh is meshed from,
// so NPC bodies (men, sheep, the giant) can't walk into the lumpy walls.
// Each cell stores how deep a cylinder of `radius` (sampled at `heights` above the floor)
// would sit in rock: <= 0 means the body fits.
export class NavGrid {
  constructor({ radius, heights, heightsAt = null, maxSlope = 0.8, x0 = -28, x1 = 28, z0 = -22, z1 = 34, cell = 0.5, baked = null }) {
    Object.assign(this, { radius, heights, x0, z0, cell, maxSlope });
    this.nx = Math.ceil((x1 - x0) / cell) + 1;
    this.nz = Math.ceil((z1 - z0) / cell) + 1;
    const N = this.nx * this.nz;
    if (baked && baked.length === N * 2) { this.pen = baked.slice(0, N); this.floor = baked.slice(N); return; }
    this.pen = new Float32Array(N);
    this.floor = new Float32Array(N);
    const ring = [];
    for (let a = 0; a < 8; a++) ring.push([Math.cos((a / 8) * Math.PI * 2) * radius, Math.sin((a / 8) * Math.PI * 2) * radius]);
    ring.push([0, 0]);
    for (let i = 0; i < this.nx; i++) {
      for (let k = 0; k < this.nz; k++) {
        const x = x0 + i * cell, z = z0 + k * cell;
        if (airDist(x, 2.5, z) > 2.5 + radius) { this.pen[i * this.nz + k] = 9; continue; }
        const fy = floorAt(x, z);
        this.floor[i * this.nz + k] = fy;
        let p = -1e9;
        for (const h of heightsAt ? heightsAt(z) : heights) {
          for (const [ox, oz] of ring) {
            const v = rockField(x + ox, fy + h, z + oz);
            if (v > p) p = v;
          }
          if (p > 0.3) break;
        }
        this.pen[i * this.nz + k] = p;
      }
    }
  }
  // props (loose boulders etc.) that aren't part of the rock field: circles {x, z, r}
  addObstacles(list) {
    for (let i = 0; i < this.nx; i++) for (let k = 0; k < this.nz; k++) {
      const x = this.x0 + i * this.cell, z = this.z0 + k * this.cell, c = i * this.nz + k;
      for (const o of list) {
        const d = Math.hypot(x - o.x, z - o.z) - o.r - this.radius;
        if (-d > this.pen[c]) this.pen[c] = -d;
      }
    }
  }
  idx(x, z) {
    const i = Math.round((x - this.x0) / this.cell), k = Math.round((z - this.z0) / this.cell);
    if (i < 0 || k < 0 || i >= this.nx || k >= this.nz) return -1;
    return i * this.nz + k;
  }
  // bilinear penetration (outside the grid counts as open: the world outside the cave mouth)
  penAt(x, z) {
    const fi = (x - this.x0) / this.cell, fk = (z - this.z0) / this.cell;
    const i = Math.floor(fi), k = Math.floor(fk);
    if (i < 0 || k < 0 || i >= this.nx - 1 || k >= this.nz - 1) return -1;
    const u = fi - i, v = fk - k, P = this.pen, n = this.nz;
    return (P[i * n + k] * (1 - u) + P[(i + 1) * n + k] * u) * (1 - v) + (P[i * n + k + 1] * (1 - u) + P[(i + 1) * n + k + 1] * u) * v;
  }
  clear(x, z) { return this.penAt(x, z) <= 0; }
  inside(x, z) { const fi = (x - this.x0) / this.cell, fk = (z - this.z0) / this.cell; return fi >= 0 && fk >= 0 && fi < this.nx - 1 && fk < this.nz - 1; }
  // walkable floor height (bilinear over the grid)
  floorY(x, z) {
    const fi = (x - this.x0) / this.cell, fk = (z - this.z0) / this.cell;
    const i = Math.floor(fi), k = Math.floor(fk);
    if (i < 0 || k < 0 || i >= this.nx - 1 || k >= this.nz - 1) return null;
    const u = fi - i, v = fk - k, F = this.floor, n = this.nz;
    return (F[i * n + k] * (1 - u) + F[(i + 1) * n + k] * u) * (1 - v) + (F[i * n + k + 1] * (1 - u) + F[(i + 1) * n + k + 1] * u) * v;
  }
  // too steep to walk between two nearby points?
  steep(ax, az, bx, bz) {
    const fa = this.floorY(ax, az), fb = this.floorY(bx, bz);
    if (fa === null || fb === null) return false;
    return Math.abs(fb - fa) > this.maxSlope * Math.hypot(bx - ax, bz - az) + 0.08;
  }
  // may the body step from (ox,oz) to (nx,nz)? stepping out of rock is always allowed
  canStep(ox, oz, nx, nz) {
    if (this.extraBlock && this.extraBlock(nx, nz) && !this.extraBlock(ox, oz)) return false;
    if (this.steep(ox, oz, nx, nz)) return false;
    const pn = this.penAt(nx, nz);
    return pn <= 0.06 || pn < this.penAt(ox, oz) - 1e-4; // a few cm of slack between cells the planner cleared
  }
  // move with wall sliding; returns true if it moved at all
  step(pos, dx, dz) {
    const ox = pos.x, oz = pos.z;
    if (this.canStep(ox, oz, ox + dx, oz + dz)) { pos.x += dx; pos.z += dz; return true; }
    const l = Math.hypot(dx, dz);
    if (this.canStep(ox, oz, ox + dx, oz)) { pos.x += Math.sign(dx) * Math.min(Math.abs(dx), l); return true; }
    if (this.canStep(ox, oz, ox, oz + dz)) { pos.z += Math.sign(dz) * Math.min(Math.abs(dz), l); return true; }
    return false;
  }
  _cellClear(c) { return c >= 0 && this.pen[c] <= 0; }
  _xz(c) { return [this.x0 + Math.floor(c / this.nz) * this.cell, this.z0 + (c % this.nz) * this.cell]; }
  nearestClear(x, z, maxR = 12) {
    const c0 = this.idx(x, z);
    if (this._cellClear(c0)) return c0;
    const R = Math.ceil(maxR / this.cell);
    let best = -1, bd = Infinity;
    const i0 = Math.round((x - this.x0) / this.cell), k0 = Math.round((z - this.z0) / this.cell);
    for (let di = -R; di <= R; di++) for (let dk = -R; dk <= R; dk++) {
      const d = di * di + dk * dk;
      if (d >= bd) continue;
      const i = i0 + di, k = k0 + dk;
      if (i < 0 || k < 0 || i >= this.nx || k >= this.nz) continue;
      const c = i * this.nz + k;
      if (this.pen[c] <= 0) { bd = d; best = c; }
    }
    return best;
  }
  // straight line fully walkable?
  lineClear(ax, az, bx, bz) {
    const d = Math.hypot(bx - ax, bz - az), n = Math.ceil(d / (this.cell * 0.5));
    let px = ax, pz = az;
    for (let s = 1; s <= n; s++) {
      const t = s / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      if (!this.clear(x, z) || this.steep(px, pz, x, z)) return false;
      px = x; pz = z;
    }
    return true;
  }
  // A* over the grid; returns a list of [x,z] waypoints (smoothed) ending at the reachable point closest to the goal
  path(ax, az, bx, bz) {
    const s = this.nearestClear(ax, az), g = this.nearestClear(bx, bz);
    if (s < 0 || g < 0) return null;
    const pts = [];
    const [sx, sz] = this._xz(s);
    if (!this.clear(ax, az)) pts.push([sx, sz]); // first get out of the rock
    const N = this.nx * this.nz, nz = this.nz;
    const gs = new Float32Array(N).fill(Infinity), from = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
    const [gx, gz] = this._xz(g);
    const hf = (c) => { const [x, z] = this._xz(c); return Math.hypot(x - gx, z - gz); };
    const heap = [[hf(s), s]]; gs[s] = 0;
    let bestC = s, bestH = hf(s);
    const push = (item) => { heap.push(item); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    const D = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
    let iter = 0;
    while (heap.length && iter++ < 60000) {
      const [, c] = pop();
      if (closed[c]) continue;
      closed[c] = 1;
      if (c === g) { bestC = g; break; }
      const h = hf(c); if (h < bestH) { bestH = h; bestC = c; }
      const i = Math.floor(c / nz), k = c % nz;
      for (const [di, dk, w] of D) {
        const ni = i + di, nk = k + dk;
        if (ni < 0 || nk < 0 || ni >= this.nx || nk >= nz) continue;
        const n = ni * nz + nk;
        if (closed[n] || this.pen[n] > 0) continue;
        if (Math.abs(this.floor[n] - this.floor[c]) > this.maxSlope * w * this.cell + 0.08) continue; // cliff
        if (di && dk && (this.pen[ni * nz + k] > 0 || this.pen[i * nz + nk] > 0)) continue; // no corner cutting
        const ng = gs[c] + w * this.cell;
        if (ng < gs[n]) { gs[n] = ng; from[n] = c; push([ng + hf(n), n]); }
      }
    }
    const cells = [];
    for (let c = bestC; c >= 0; c = from[c]) cells.push(c);
    cells.reverse();
    const raw = cells.map((c) => this._xz(c));
    if (bestC === g && this.clear(bx, bz)) raw.push([bx, bz]);
    // string-pull
    let cur = pts.length ? pts[0] : [ax, az];
    for (let i = 1; i < raw.length; i++) {
      if (!this.lineClear(cur[0], cur[1], raw[i][0], raw[i][1])) { pts.push(raw[i - 1]); cur = raw[i - 1]; }
    }
    if (raw.length) pts.push(raw[raw.length - 1]);
    return pts;
  }
}

// load the baked grids (tools/bake-nav.mjs); anything missing is computed here
export async function loadNav() {
  const names = Object.keys(NAV_SPECS);
  let pens = [];
  try {
    const res = await fetch('assets/nav.bin');
    if (!res.ok) throw new Error('no bake');
    const ab = await res.arrayBuffer(), dv = new DataView(ab);
    const n = dv.getUint32(0, true);
    let o = 4 + n * 4;
    for (let i = 0; i < n; i++) { const len = dv.getUint32(4 + i * 4, true); pens.push(new Float32Array(ab.slice(o, o + len * 4))); o += len * 4; }
  } catch (e) { pens = []; }
  const out = {};
  names.forEach((nm, i) => { out[nm] = buildNav(nm, pens[i] || null); });
  return out;
}

// follow a grid path toward `target`; returns the current waypoint [x, z].
// `st` keeps the path between frames (st.path / st.pathGoal / st.repathT).
export function navSeek(nav, st, pos, target, dt, reach = 0.5) {
  st.repathT = (st.repathT || 0) - dt;
  const g = st.pathGoal;
  const moved = !g || Math.hypot(g[0] - target.x, g[1] - target.z) > 0.75;
  // moving target in plain sight (fleeing, chasing a leg): steer at it every frame. otherwise the
  // body reaches the stale end point, stops, and lurches on at the next re-plan (stop-go stutter)
  if ((moved || (st.path && st.path.length === 1)) && nav.clear(pos.x, pos.z) && nav.lineClear(pos.x, pos.z, target.x, target.z)) {
    st.path = [[target.x, target.z]];
    if (moved) st.pathGoal = [target.x, target.z];
    return st.path[0];
  }
  if (!st.path || !st.path.length || (moved && st.repathT <= 0)) {
    st.path = nav.clear(pos.x, pos.z) && nav.lineClear(pos.x, pos.z, target.x, target.z)
      ? [[target.x, target.z]]
      : nav.path(pos.x, pos.z, target.x, target.z) || [[pos.x, pos.z]];
    st.pathGoal = [target.x, target.z];
    st.repathT = 0.4;
  }
  while (st.path.length > 1 && Math.hypot(st.path[0][0] - pos.x, st.path[0][1] - pos.z) < reach) st.path.shift();
  return st.path[0];
}

// centre line of the entrance tunnel (x at chest height of a ducking giant), for z = 12..26
let _tc = null;
export function tunnelCenterX(z) {
  if (!_tc) {
    _tc = [];
    for (let zz = 12; zz <= 26; zz++) {
      const f = floorAt(1, zz), h = f + 3.5;
      let l = 1, r = 1;
      while (rockField(l, h, zz) < 0 && l > -8) l -= 0.05;
      while (rockField(r, h, zz) < 0 && r < 10) r += 0.05;
      _tc.push((l + r) / 2);
    }
  }
  const t = Math.min(14, Math.max(0, z - 12)), i = Math.min(13, Math.floor(t)), u = t - i;
  return _tc[i] * (1 - u) + _tc[i + 1] * u;
}
