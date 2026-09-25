import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildCave, LAYOUT, floorHeightAt } from './cave.js';
import { makeRockMaterial } from './materials.js';
import { Fire } from './fire.js';
import { rng, fbm3, noise3 } from './noise.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const gltf = new GLTFLoader();
const loadModel = (name) => new Promise((res, rej) => gltf.load(`assets/models/${name}/${name}.gltf`, (g) => res(g.scene), undefined, rej));

function prepModel(root, { shadow = true, receive = true } = {}) {
  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = shadow; o.receiveShadow = receive;
      if (o.material?.map) o.material.map.anisotropy = 8;
    }
  });
  return root;
}

function fitHeight(obj, h) {
  const b = new THREE.Box3().setFromObject(obj);
  const s = h / (b.max.y - b.min.y);
  obj.scale.multiplyScalar(s);
  return obj;
}

// --- Volumetric light shaft (cheap): soft additive cone with drifting dust ---
function makeShaft(from, to, r0, r1, color, strength) {
  const len = from.distanceTo(to);
  const g = new THREE.CylinderGeometry(r0, r1, len, 48, 24, true);
  g.translate(0, -len / 2, 0);
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color(color) }, uStrength: { value: strength }, uTime: { value: 0 }, uLen: { value: len } },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying float vY; varying vec3 vP; uniform float uLen;
      void main(){ vY = -position.y / uLen; vP = position; vec4 mv = modelViewMatrix*vec4(position,1.0); vV = normalize(-mv.xyz); vN = normalize(normalMatrix*normal); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uStrength; uniform float uTime; varying vec3 vN; varying vec3 vV; varying float vY; varying vec3 vP;
      float h(vec3 p){ p = fract(p*0.3183099+.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
      float n(vec3 x){ vec3 i=floor(x); vec3 f=fract(x); f=f*f*(3.0-2.0*f);
        return mix(mix(mix(h(i),h(i+vec3(1,0,0)),f.x),mix(h(i+vec3(0,1,0)),h(i+vec3(1,1,0)),f.x),f.y),
                   mix(mix(h(i+vec3(0,0,1)),h(i+vec3(1,0,1)),f.x),mix(h(i+vec3(0,1,1)),h(i+vec3(1,1,1)),f.x),f.y),f.z); }
      void main(){
        float edge = pow(clamp(abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0), 2.5);
        float yy = clamp(vY, 0.0, 1.0); float fall = smoothstep(0.0, 0.08, yy) * pow(max(1.0 - yy, 0.0), 1.6);
        float dust = 0.6 + 0.8*n(vP*0.8 + vec3(0.0, uTime*0.15, uTime*0.05));
        float a = edge * fall * dust * uStrength;
        gl_FragColor = vec4(uColor * a, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.position.copy(from);
  const dir = to.clone().sub(from).normalize();
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
  mesh.renderOrder = 3;
  mesh.frustumCulled = false;
  return mesh;
}

// Door slab: a tall, slightly skewed trapezoid of rock, ~1.7 m thick, with chipped edges and a lumpy face.
// Origin at the bottom centre; +z faces out of the cave.
function makeDoorSlab() {
  const H = 12.6, T = 1.7, bev = 0.55;
  const g = new THREE.BoxGeometry(1, 1, 1, 28, 40, 6);
  const pos = g.attributes.position;
  // left/right edges of the outline: wide foot, narrow skewed top, uneven jagged sides
  const L0 = -5.6, R0 = 5.4, L1 = -1.6, R1 = 2.6;
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i), v = pos.getY(i) + 0.5, w = pos.getZ(i);
    const t = Math.abs(w) * 2; // 0 at the mid-plane, 1 on the front/back face
    const inset = bev * t * t * t;
    const y0 = v * H;
    let left = THREE.MathUtils.lerp(L0, L1, Math.pow(v, 1.15)) + 0.45 * fbm3(3.1, y0 * 0.22, 0, 3) + 0.15 * noise3(1.7, y0 * 0.9, 0);
    let right = THREE.MathUtils.lerp(R0, R1, Math.pow(v, 0.95)) + 0.45 * fbm3(8.3, y0 * 0.22, 0, 3) + 0.15 * noise3(5.2, y0 * 0.9, 0);
    left += inset; right -= inset;
    let x = THREE.MathUtils.lerp(left, right, u + 0.5);
    // slanted, broken top edge
    const top = H - 0.9 * (x - L1) / (R1 - L1) + 0.35 * fbm3(x * 0.4, 7.7, 0, 3) - inset;
    let y = v * top;
    // thickness: slightly thinner toward the top, lumpy faces
    const thick = T * (1 - 0.25 * v) * (1 + 0.12 * fbm3(x * 0.18, y * 0.18, 2.2, 3));
    let z = w * thick + Math.sign(w) * (0.22 * fbm3(x * 0.25, y * 0.25, w > 0 ? 0 : 9, 4) + 0.05 * noise3(x * 1.4, y * 1.4, w * 3)) * t;
    x += 0.08 * noise3(x * 1.1, y * 1.1, z + 4);
    y = Math.max(y, 0) + 0.08 * noise3(x * 1.2, y * 1.2, z + 1) * (v > 0.02 ? 1 : 0);
    pos.setXYZ(i, x, y, z);
  }
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  const merged = mergeVertices(g, 1e-4);
  merged.computeVertexNormals();
  // box-projected UVs from the smoothed normal (~4.5 m per texture tile)
  const P = merged.attributes.position, N = merged.attributes.normal, UV = new Float32Array(P.count * 2), s = 1 / 4.5;
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i), ax = Math.abs(N.getX(i)), ay = Math.abs(N.getY(i)), az = Math.abs(N.getZ(i));
    const [a, b] = az >= ax && az >= ay ? [x, y] : ax >= ay ? [z + 0.37 * 4.5, y] : [x, z + 0.61 * 4.5];
    UV[i * 2] = a * s; UV[i * 2 + 1] = b * s;
  }
  merged.setAttribute('uv', new THREE.BufferAttribute(UV, 2));
  merged.setAttribute('uv1', merged.attributes.uv);
  return merged;
}

// Dust motes that sparkle in the light
function makeDust(count, box) {
  const g = new THREE.BufferGeometry();
  const p = new Float32Array(count * 3);
  const r = rng(7);
  for (let i = 0; i < count; i++) {
    p[i * 3] = box.min.x + r() * (box.max.x - box.min.x);
    p[i * 3 + 1] = box.min.y + r() * (box.max.y - box.min.y);
    p[i * 3 + 2] = box.min.z + r() * (box.max.z - box.min.z);
  }
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uShaftA: { value: new THREE.Vector3() }, uShaftB: { value: new THREE.Vector3() }, uFire: { value: new THREE.Vector3() } },
    vertexShader: `uniform float uTime; uniform vec3 uFire; varying float vA; varying vec3 vC;
      void main(){
        vec3 p = position;
        p.x += sin(uTime*0.2 + position.y*1.3)*0.4; p.y += sin(uTime*0.13 + position.x)*0.3; p.z += cos(uTime*0.17 + position.z*0.7)*0.4;
        float df = distance(p, uFire);
        // lit by fire (warm) or by the cold daylight coming through the entrance / crack
        float warm = 6.0 / (1.0 + df*df*0.08);
        float cold = smoothstep(8.0, 20.0, p.z) * 1.5 + smoothstep(2.5, 0.0, abs(p.x-6.0)) * smoothstep(3.0,0.0,abs(p.z+3.0)) * step(4.0, p.y) * 2.0;
        vC = vec3(1.0,0.55,0.25)*warm + vec3(0.55,0.85,0.95)*cold;
        vec4 mv = modelViewMatrix*vec4(p,1.0);
        vA = 1.0;
        gl_PointSize = 40.0 / -mv.z;
        gl_Position = projectionMatrix*mv;
      }`,
    fragmentShader: `varying float vA; varying vec3 vC; void main(){ float d = length(gl_PointCoord-0.5); float a = smoothstep(0.5,0.0,d)*0.25; gl_FragColor = vec4(vC*a, a); }`,
  });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  return pts;
}

// Hanging cheese sacks (seen in the film: bags of cheese hanging from the wall)
function makeCheeseSack(r) {
  const pts = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const rad = Math.sin(Math.PI * Math.pow(t, 0.8)) * (0.32 + 0.05 * Math.sin(t * 9)) + 0.02;
    pts.push(new THREE.Vector2(rad * (1 + (r() - 0.5) * 0.1), -t * 0.9));
  }
  const g = new THREE.LatheGeometry(pts, 20);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    pos.setX(i, pos.getX(i) * (1 + Math.sin(y * 13 + i) * 0.03));
    pos.setZ(i, pos.getZ(i) * (1 + Math.cos(y * 11 + i) * 0.03));
  }
  g.computeVertexNormals();
  return g;
}

// Straw pile — used as the sheep disguise
export function makeStraw(count, radius, height, seed = 3) {
  const blade = new THREE.CylinderGeometry(0.006, 0.01, 0.55, 3, 1);
  const m = new THREE.MeshStandardMaterial({ color: 0xb89a55, roughness: 0.85 });
  const mesh = new THREE.InstancedMesh(blade, m, count);
  const r = rng(seed);
  const q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3(), M = new THREE.Matrix4();
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * radius;
    const hh = height * (1 - (d / radius) ** 2) * (0.6 + r() * 0.4);
    p.set(Math.cos(a) * d, r() * hh, Math.sin(a) * d);
    e.set((r() - 0.5) * 2.6, r() * 6.28, (r() - 0.5) * 2.6);
    q.setFromEuler(e);
    s.set(1, 0.6 + r() * 1.0, 1);
    M.compose(p, q, s);
    mesh.setMatrixAt(i, M);
    c.setHSL(0.11 + r() * 0.03, 0.45 + r() * 0.2, 0.3 + r() * 0.25);
    mesh.setColorAt(i, c);
  }
  mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}

export async function buildWorld(scene, renderer, onProgress) {
  const W = { colliders: [], interact: [], updaters: [] };

  // ---------------- Cave ----------------
  // the cave mesh is pre-baked (tools/bake-cave.mjs); fall back to generating it if missing
  let caveGeo;
  try {
    const res = await fetch('assets/cave.bin');
    if (!res.ok) throw new Error('no bake');
    const ab = await res.arrayBuffer();
    const n = new DataView(ab).getUint32(0, true);
    const pos = new Float32Array(ab.slice(4, 4 + n * 12));
    const ni = new Int8Array(ab, 4 + n * 12, n * 3), ai = new Uint8Array(ab, 4 + n * 15, n);
    const nrm = new Float32Array(n * 3), col = new Float32Array(n * 3);
    for (let i = 0; i < n * 3; i++) nrm[i] = ni[i] / 127;
    for (let i = 0; i < n; i++) col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = ai[i] / 255;
    caveGeo = new THREE.BufferGeometry();
    caveGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    caveGeo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    caveGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    caveGeo.computeBoundingBox(); caveGeo.computeBoundingSphere();
    onProgress?.(0.6);
  } catch (e) {
    await new Promise((r) => setTimeout(r, 30));
    caveGeo = buildCave((p) => onProgress?.(p * 0.6));
  }
  const caveMat = makeRockMaterial();
  const cave = new THREE.Mesh(caveGeo, caveMat);
  cave.castShadow = true; cave.receiveShadow = true;
  scene.add(cave);
  W.cave = cave;
  W.colliders.push(cave);
  onProgress?.(0.65);

  // ---------------- Env map (dark, warm/teal blobs for bronze reflections) ----------------
  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color(0x020101);
  const blob = (c, p, s) => { const m = new THREE.Mesh(new THREE.SphereGeometry(s, 16, 8), new THREE.MeshBasicMaterial({ color: c })); m.position.copy(p); envScene.add(m); };
  blob(new THREE.Color(3, 1.2, 0.3), new THREE.Vector3(0, -2, 0), 2.5);
  blob(new THREE.Color(0.6, 1.4, 1.6), new THREE.Vector3(0, 3, 10), 2.0);
  blob(new THREE.Color(0.12, 0.07, 0.04), new THREE.Vector3(0, 0, -10), 8);
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(envScene, 0.04).texture;
  scene.environmentIntensity = 0.18;

  // ---------------- Lighting ----------------
  const firePos = new THREE.Vector3(-2, floorHeightAt(-2, 0), 0);
  W.firePos = firePos;
  const fire = new Fire(scene, firePos.clone().add(new THREE.Vector3(0, 0.25, 0)), { size: 1.5, shadow: true, count: 55, cards: 3 });
  W.fire = fire;
  W.updaters.push((dt, t) => fire.update(dt, t));

  // cold daylight through the triangular entrance
  const sun = new THREE.SpotLight(0x7cc6dc, 0, 90, 0.32, 0.6, 1.2);
  sun.position.set(LAYOUT.tunnelZ0 * 0 + 3.5, 16, 52);
  sun.target.position.set(-1, 0, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0008; sun.shadow.normalBias = 0.06;
  sun.shadow.camera.near = 10; sun.shadow.camera.far = 90;
  scene.add(sun, sun.target);
  W.sun = sun; W.sunBase = 1300;

  // light falling through the ceiling crack
  const crackLight = new THREE.SpotLight(0x86cde0, 650, 45, 0.2, 0.8, 1.0);
  crackLight.position.set(LAYOUT.crack.x + 2.5, 34, LAYOUT.crack.z);
  crackLight.target.position.set(LAYOUT.crack.x - 0.5, 0, LAYOUT.crack.z + 0.5);
  crackLight.castShadow = true;
  crackLight.shadow.mapSize.set(1024, 1024);
  crackLight.shadow.bias = -0.001;
  scene.add(crackLight, crackLight.target);
  W.crackLight = crackLight;

  // shadow maps are the most expensive part of a frame (the fire's cube map redraws the whole cave 6 times),
  // so refresh them in rotation instead of every frame: fire every 2nd frame, the two spots every 4th
  const shadowLights = [fire.light, sun, crackLight];
  // (only ever raise the flag: three clears it once the map is drawn, so a skipped frame never leaves a map undrawn)
  for (const l of shadowLights) { l.shadow.autoUpdate = false; l.shadow.needsUpdate = true; }
  let shadowFrame = 0;
  W.updaters.push(() => {
    const f = shadowFrame++;
    if (f % 2 === 0) fire.light.shadow.needsUpdate = true;
    if (f % 4 === 1 && sun.intensity > 0) sun.shadow.needsUpdate = true;
    if (f % 4 === 3 && crackLight.intensity > 0) crackLight.shadow.needsUpdate = true;
  });

  // very faint bounce so the blacks aren't pure digital black
  const hemi = new THREE.HemisphereLight(0x3a4a50, 0x1a0c05, 0.07);
  scene.add(hemi);
  W.hemi = hemi;

  // shafts
  const shaftCrack = makeShaft(new THREE.Vector3(LAYOUT.crack.x + 1.8, 30, LAYOUT.crack.z), new THREE.Vector3(LAYOUT.crack.x - 0.6, 0, LAYOUT.crack.z + 0.4), 0.6, 3.2, 0x9fd8ff, 0.12);
  const shaftEntrance = makeShaft(new THREE.Vector3(3.5, 12, 40), new THREE.Vector3(-2, 0, 2), 3.5, 9, 0x9fd8ff, 0.07);
  scene.add(shaftCrack, shaftEntrance);
  W.shafts = [shaftCrack, shaftEntrance];
  W.updaters.push((dt) => W.shafts.forEach((s) => (s.material.uniforms.uTime.value += dt)));

  const dust = makeDust(2500, new THREE.Box3(new THREE.Vector3(-18, 0.2, -14), new THREE.Vector3(18, 22, 30)));
  dust.material.uniforms.uFire.value.copy(firePos);
  scene.add(dust);
  W.updaters.push((dt) => (dust.material.uniforms.uTime.value += dt));

  // ---------------- Outside (seen through the entrance) ----------------
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(400, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { uBright: { value: 1 } },
      vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `varying vec3 vD; uniform float uBright; void main(){ float h = clamp(vD.y, -0.2, 1.0);
        vec3 c = mix(vec3(0.75,0.92,0.95), vec3(0.32,0.62,0.78), smoothstep(0.0, 0.6, h));
        c = mix(vec3(0.25,0.42,0.45), c, smoothstep(-0.2, 0.02, h));
        gl_FragColor = vec4(c * 9.0 * uBright, 1.0); }`,
    })
  );
  sky.position.set(0, 0, 40);
  scene.add(sky);
  W.sky = sky;
  const outsideGround = new THREE.Mesh(
    new THREE.CircleGeometry(160, 48).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x4d5a2e, roughness: 1 })
  );
  outsideGround.position.set(0, 0.9, 196);
  outsideGround.receiveShadow = true;
  scene.add(outsideGround);

  onProgress?.(0.7);

  // ---------------- Props ----------------
  const [pit, trunk, bucket, basket, stump, rockA, rockB, b2, b4, b5, bowl] = await Promise.all(
    ['stone_fire_pit', 'dead_tree_trunk', 'wooden_bucket_01', 'wicker_basket_01', 'tree_stump_01', 'rock_face_01', 'rock_face_02', 'namaqualand_boulder_02', 'namaqualand_boulder_04', 'namaqualand_boulder_05', 'wooden_bowl_01'].map(loadModel)
  );
  onProgress?.(0.85);

  // The door-stone: one tall, rough slab of rock (an irregular upright trapezoid) the Cyclops drags across the entrance
  const tl = new THREE.TextureLoader();
  const slabTex = (f, srgb) => { const t = tl.load(`assets/tex/marble_cliff_02/${f}`); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; };
  const slabMat = new THREE.MeshStandardMaterial({
    map: slabTex('diff.jpg', true), normalMap: slabTex('nor.jpg'), roughnessMap: slabTex('rough.jpg'),
    color: 0xb8a890, roughness: 1, metalness: 0,
  });
  const slab = new THREE.Mesh(makeDoorSlab(), slabMat);
  slab.castShadow = slab.receiveShadow = true;
  const boulder = new THREE.Group();
  boulder.add(slab);
  const doorZ = LAYOUT.boulderZ;
  const tunnelXAt = (z) => (z - LAYOUT.tunnelZ0) * 0.09;
  W.doorClosed = new THREE.Vector3(tunnelXAt(doorZ), -0.6, doorZ);
  W.doorOpen = new THREE.Vector3(tunnelXAt(doorZ) + 9.5, -0.6, doorZ + 3.5);
  boulder.position.copy(W.doorOpen);
  boulder.rotation.y = 0.12;
  scene.add(boulder);
  W.boulder = boulder;
  W.colliders.push(boulder);

  // fire pit
  prepModel(pit);
  fitHeight(pit, 0.55);
  const pb = new THREE.Box3().setFromObject(pit);
  pit.scale.multiplyScalar(2.6 / (pb.max.x - pb.min.x));
  pit.position.copy(firePos);
  scene.add(pit);
  // firewood: charred logs on a bed of ash ("Campfire Wood Survival Warm and Light" by digrafstudio, CC-BY)
  const logs = await new Promise((res, rej) => gltf.load('assets/models/campfire_logs/campfire_logs.glb', (g) => res(g.scene), undefined, rej));
  prepModel(logs);
  logs.updateMatrixWorld(true);
  const lb0 = new THREE.Box3().setFromObject(logs, true); // precise: the model is authored tilted, the loose box is far too big
  logs.scale.multiplyScalar(1.7 / Math.max(lb0.max.x - lb0.min.x, lb0.max.z - lb0.min.z));
  logs.updateMatrixWorld(true);
  const lb = new THREE.Box3().setFromObject(logs, true);
  logs.position.copy(firePos).add(new THREE.Vector3(-(lb.min.x + lb.max.x) / 2, 0.08 - lb.min.y, -(lb.min.z + lb.max.z) / 2));
  const emberT = { value: 0 };
  W.updaters.push((dt) => (emberT.value += dt));
  logs.traverse((o) => {
    if (!o.isMesh) return;
    const m = o.material = o.material.clone();
    m.color.setRGB(0.22, 0.2, 0.19); // soot-dark: the fire light is right on top of them
    m.onBeforeCompile = (sh) => {
      // glowing coals: charred (dark) wood near the base and the core of the fire smoulders, breathing slowly
      sh.uniforms.uT = emberT; sh.uniforms.uC = { value: firePos.clone() };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
        varying vec3 vWP; uniform float uT; uniform vec3 uC;
        float eh(vec3 p){ return fract(sin(dot(p, vec3(127.1,311.7,74.7)))*43758.5453); }
        float en(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(mix(eh(i),eh(i+vec3(1,0,0)),f.x),mix(eh(i+vec3(0,1,0)),eh(i+vec3(1,1,0)),f.x),f.y),
                     mix(mix(eh(i+vec3(0,0,1)),eh(i+vec3(1,0,1)),f.x),mix(eh(i+vec3(0,1,1)),eh(i+vec3(1,1,1)),f.x),f.y),f.z); }`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          vec3 d = vWP - uC;
          float core = smoothstep(0.95, 0.1, length(d.xz)) * smoothstep(0.75, 0.05, d.y);
          float charred = smoothstep(0.12, 0.03, dot(diffuseColor.rgb, vec3(0.33))); // colour is already x0.4
          float cracks = smoothstep(0.45, 0.8, en(vWP * 14.0 + vec3(0.0, uT * 0.15, 0.0)));
          float breathe = 0.65 + 0.35 * en(vWP * 3.0 + vec3(uT * 0.6));
          float g = core * charred * (0.25 + 1.6 * cracks) * breathe;
          totalEmissiveRadiance += vec3(1.0, 0.2, 0.02) * g * 2.0;
        }`);
    };
  });
  scene.add(logs);
  W.fireLogs = logs;

  // the olive-wood club/log that becomes the stake
  prepModel(trunk);
  const tb = new THREE.Box3().setFromObject(trunk);
  const tlen = Math.max(tb.max.x - tb.min.x, tb.max.y - tb.min.y, tb.max.z - tb.min.z);
  trunk.scale.multiplyScalar(7 / tlen);
  const stakeRoot = new THREE.Group();
  stakeRoot.add(trunk);
  // lay it along the floor
  const tb2 = new THREE.Box3().setFromObject(trunk);
  if (tb2.max.y - tb2.min.y > tb2.max.x - tb2.min.x) trunk.rotation.z = Math.PI / 2;
  stakeRoot.position.set(9, floorHeightAt(9, 5) + 0.3, 5);
  stakeRoot.rotation.y = 0.9;
  scene.add(stakeRoot);
  W.stakeLog = stakeRoot;
  W.interact.push({ id: 'log', obj: stakeRoot, pos: stakeRoot.position.clone(), radius: 4 });

  // scattered rocks / boulders near walls
  const r = rng(11);
  const rockProtos = [b2, b4, b5, rockA, rockB].map((m) => prepModel(m));
  const rockSpots = [
    [-17, -4, 3.5], [16, 6, 3], [-8, 12, 2.2], [12, -14, 3], [-19, 8, 2.5], [5, -15, 2.2], [-4, -16, 3.2], [19, -2, 2.4], [-13, 4, 1.4], [7, 10, 1.1],
  ];
  for (const [x, z, s] of rockSpots) {
    const m = rockProtos[Math.floor(r() * rockProtos.length)].clone();
    fitHeight(m, s);
    m.position.set(x, floorHeightAt(x, z) - 0.2, z);
    m.rotation.y = r() * 6.28;
    scene.add(m);
    W.colliders.push(m);
  }

  // exterior cliff face around the cave mouth (seen from outside at the end)
  const cliffSpots = [[-14, 33.5, 0.2, 32], [16, 33.5, -0.25, 30], [-30, 30, 0.6, 30], [32, 30, -0.6, 30]];
  for (const [x, z, ry, h] of cliffSpots) {
    const c = (r() < 0.5 ? rockA : rockB).clone();
    fitHeight(c, h);
    const cb = new THREE.Box3().setFromObject(c);
    c.position.set(x, -1 - cb.min.y, z);
    c.rotation.y = ry;
    if (x === 2) { c.position.y = 12 - cb.min.y; }
    scene.add(c);
  }

  // cheese sacks on the wall, cheese wheels on a stone ledge, buckets
  const sackMat = new THREE.MeshStandardMaterial({ color: 0x8f7a5a, roughness: 0.95 });
  const ropeMat = new THREE.MeshStandardMaterial({ color: 0x3d2f20, roughness: 1 });
  const sackSpots = [];
  for (let i = 0; i < 16; i++) {
    const a = -0.4 + i * 0.1;
    sackSpots.push([Math.sin(a) * 18.5 + 2, 3.2 + r() * 2.5, -Math.cos(a) * 12.5 - 2]);
  }
  for (const [x, y, z] of sackSpots) {
    const s = new THREE.Mesh(makeCheeseSack(r), sackMat);
    s.position.set(x, y, z);
    s.scale.setScalar(0.8 + r() * 0.6);
    s.rotation.z = (r() - 0.5) * 0.15;
    s.castShadow = true; s.receiveShadow = true;
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.2), ropeMat);
    rope.position.set(x, y + 0.6, z);
    scene.add(s, rope);
  }
  const cheeseMat = new THREE.MeshStandardMaterial({ color: 0xd8c690, roughness: 0.7 });
  W.cheeseWheels = [];
  for (let i = 0; i < 9; i++) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.48, 0.28, 24), cheeseMat);
    W.cheeseWheels.push(w);
    w.position.set(15 + (i % 3) * 1.0 - 1, floorHeightAt(15, 2) + 0.14 + Math.floor(i / 3) * 0.29, 2 + (i % 3) * 0.3);
    w.castShadow = true; w.receiveShadow = true;
    scene.add(w);
  }
  prepModel(bucket); fitHeight(bucket, 0.55);
  prepModel(basket); fitHeight(basket, 0.5);
  prepModel(bowl); fitHeight(bowl, 0.14);
  const place = (m, x, z, rot = 0) => { const c = m.clone(); c.position.set(x, floorHeightAt(x, z), z); c.rotation.y = rot; scene.add(c); return c; };
  place(bucket, 13, 3.5, 0.3); place(bucket, 12.2, 4.1, 1.3); place(basket, 14.2, 4.6); place(bowl, 1, 1.8); place(bowl, 0.4, 2.3, 2);
  prepModel(stump); fitHeight(stump, 0.7);
  place(stump, 2.5, -2.5); place(stump, -5.5, 3);

  // straw piles (for the sheep disguise). One main pile near the pen.
  const strawSpots = [[11, -6], [16, -12], [-6, -8]];
  for (const [x, z] of strawSpots) {
    const s = makeStraw(3500, 1.8, 1.1, x * 10 + z);
    s.position.set(x, floorHeightAt(x, z), z);
    scene.add(s);
    W.interact.push({ id: 'straw', obj: s, pos: s.position.clone(), radius: 3 });
  }

  // torches wedged into the wall (our men lit them)
  W.torches = [];
  const torchSpots = [[8, 0.5, 11], [-9, 0.5, 9]];
  for (const [x, , z] of torchSpots) {
    const y = floorHeightAt(x, z);
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.4), ropeMat);
    stick.position.set(x, y + 0.7, z); stick.rotation.z = 0.25;
    scene.add(stick);
    const f = new Fire(scene, new THREE.Vector3(x + 0.17, y + 1.4, z), { size: 0.35, count: 16, smoke: false, intensity: 1.2, cards: 2 });
    W.updaters.push((dt, t) => f.update(dt, t));
    W.torches.push(f);
  }

  onProgress?.(1);
  return W;
}
