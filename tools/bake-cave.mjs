// Bakes the procedural cave mesh once so phones don't have to run marching cubes at load.
import fs from 'fs';
import { buildCave } from '../src/cave.js';
const g = buildCave();
const pos = g.attributes.position.array, nrm = g.attributes.normal.array, col = g.attributes.color.array;
const n = pos.length / 3;
// quantised: positions float32, normals int8, AO uint8
const buf = Buffer.alloc(4 + n * 12 + n * 3 + n);
buf.writeUInt32LE(n, 0);
let o = 4;
Buffer.from(pos.buffer, pos.byteOffset, n * 12).copy(buf, o); o += n * 12;
for (let i = 0; i < n * 3; i++) buf.writeInt8(Math.round(nrm[i] * 127), o++);
for (let i = 0; i < n; i++) buf.writeUInt8(Math.round(col[i * 3] * 255), o++);
fs.writeFileSync('public/assets/cave.bin', buf);
console.log('vertices', n, 'bytes', buf.length);
