// Bakes the NPC walkability grids (src/nav.js) so the game doesn't compute them at load.
// Re-run after changing the cave (npm run bake).
import fs from 'fs';
import { buildNav, NAV_SPECS } from '../src/nav.js';
const parts = [];
for (const name of Object.keys(NAV_SPECS)) { const g = buildNav(name); const d = new Float32Array(g.pen.length * 2); d.set(g.pen); d.set(g.floor, g.pen.length); parts.push(Buffer.from(d.buffer)); console.log(name, g.nx, g.nz); }
// layout: [u32 count][u32 len]*count then float32 data, in NAV_SPECS order
const head = Buffer.alloc(4 + parts.length * 4);
head.writeUInt32LE(parts.length, 0);
parts.forEach((p, i) => head.writeUInt32LE(p.length / 4, 4 + i * 4));
fs.writeFileSync('public/assets/nav.bin', Buffer.concat([head, ...parts]));
