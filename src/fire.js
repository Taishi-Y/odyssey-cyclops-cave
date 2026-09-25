import * as THREE from 'three';

const flameVS = `
attribute vec4 aSeed; // x: phase, y: scale, z: offset angle, w: lifetime speed
uniform float uTime; uniform float uSize; uniform float uIntensity;
varying vec2 vUv; varying float vLife; varying float vSeed;
void main(){
  vUv = uv;
  float life = fract(uTime * aSeed.w + aSeed.x);
  vLife = life; vSeed = aSeed.x;
  vec3 base = vec3(cos(aSeed.z), 0.0, sin(aSeed.z)) * aSeed.y * 0.35 * uSize * (1.0 - life);
  base.y += life * 1.6 * uSize * uIntensity;
  base.x += sin(uTime*3.0 + aSeed.x*20.0) * 0.12 * life * uSize;
  base.z += cos(uTime*2.3 + aSeed.x*13.0) * 0.12 * life * uSize;
  float s = uSize * aSeed.y * (1.0 - life*0.75) * (0.4 + uIntensity*0.6);
  vec4 mv = modelViewMatrix * vec4(base, 1.0);
  mv.xy += position.xy * s * vec2(0.7, 1.3);
  gl_Position = projectionMatrix * mv;
}`;
const flameFS = `
uniform float uTime;
varying vec2 vUv; varying float vLife; varying float vSeed;
float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float n(vec2 p){ vec2 i=floor(p); vec2 f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
float fbm(vec2 p){ float s=0.0,a=0.5; for(int i=0;i<4;i++){ s+=a*n(p); p*=2.1; a*=0.5;} return s; }
void main(){
  vec2 p = vUv*2.0-1.0;
  float t = uTime*2.5 + vSeed*10.0;
  float d = fbm(vec2(p.x*2.0, p.y*1.5 - t)) ;
  float shape = 1.0 - length(vec2(p.x*1.3, p.y*0.8 + 0.2)) - d*0.55;
  shape = smoothstep(0.0, 0.45, shape);
  float heat = shape * (1.0 - vLife);
  vec3 col = mix(vec3(0.9,0.18,0.02), vec3(1.0,0.55,0.12), smoothstep(0.1,0.5,heat));
  col = mix(col, vec3(1.0,0.9,0.6), smoothstep(0.5,0.9,heat));
  float a = shape * smoothstep(1.0, 0.55, vLife) * smoothstep(0.0, 0.08, vLife);
  gl_FragColor = vec4(col * a * 6.0, a);
}`;

const smokeFS = `
uniform float uTime;
varying vec2 vUv; varying float vLife; varying float vSeed;
float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float n(vec2 p){ vec2 i=floor(p); vec2 f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
void main(){
  vec2 p = vUv*2.0-1.0;
  float r = length(p);
  float d = n(p*3.0 + vSeed*7.0 + uTime*0.3)*0.5 + n(p*6.0 - uTime*0.2)*0.25;
  float a = smoothstep(1.0, 0.2, r + d*0.5) * sin(vLife*3.14159) * 0.22;
  gl_FragColor = vec4(vec3(0.05,0.045,0.04), a);
}`;

const smokeVS = `
attribute vec4 aSeed;
uniform float uTime; uniform float uSize;
varying vec2 vUv; varying float vLife; varying float vSeed;
void main(){
  vUv = uv;
  float life = fract(uTime * aSeed.w + aSeed.x);
  vLife = life; vSeed = aSeed.x;
  vec3 base = vec3(sin(uTime*0.4+aSeed.x*9.0)*life*1.5, 1.2*uSize + life * 9.0, cos(uTime*0.3+aSeed.z)*life*1.5);
  float s = uSize * (0.8 + life*3.5);
  vec4 mv = modelViewMatrix * vec4(base, 1.0);
  float r = aSeed.z + uTime*0.1;
  mat2 R = mat2(cos(r),-sin(r),sin(r),cos(r));
  mv.xy += R * position.xy * s;
  gl_Position = projectionMatrix * mv;
}`;


// ---- flipbook flames: a Mantaflow fire sim (work/firesim/sim.py) baked into a grayscale atlas.
// Brightness = flame density; colour comes from a blackbody-like ramp here so it stays tweakable.
let FLIP = null;
function loadFlipbook() {
  if (FLIP) return FLIP;
  const tex = new THREE.TextureLoader().load('assets/fx/fire_flipbook.png');
  tex.colorSpace = THREE.NoColorSpace; tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
  FLIP = { tex, meta: { cols: 8, rows: 8, frames: 64, fps: 24, lum: null } };
  fetch('assets/fx/fire_flipbook.json').then((r) => r.json()).then((m) => Object.assign(FLIP.meta, m)).catch(() => {});
  return FLIP;
}
const flipVS = `
uniform float uW; uniform float uH; uniform float uOff; uniform float uFlip;
varying vec2 vUv;
void main(){
  vUv = vec2(uFlip > 0.5 ? 1.0 - uv.x : uv.x, uv.y);
  // cylindrical billboard: stay upright, turn around Y toward the camera
  vec3 camL = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
  vec2 dir = normalize(camL.xz + 1e-4);
  vec3 right = vec3(dir.y, 0.0, -dir.x);
  vec3 p = right * (position.x * uW + uOff) + vec3(0.0, (position.y + 0.5) * uH, 0.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const flipFS = `
uniform sampler2D uTex; uniform float uFrame; uniform vec2 uGrid; uniform float uFrames; uniform float uGain; uniform float uIntensity;
varying vec2 vUv;
float frameAt(float f){
  f = mod(f, uFrames);
  vec2 cell = vec2(mod(f, uGrid.x), floor(f / uGrid.x));
  vec2 uv = (cell + vec2(vUv.x, 1.0 - vUv.y)) / uGrid;
  return pow(texture2D(uTex, vec2(uv.x, 1.0 - uv.y)).r, 2.2); // atlas is stored with gamma 1/1.6; a bit extra for crisper tongues
}
vec3 ramp(float h){
  vec3 c = mix(vec3(0.35,0.015,0.0), vec3(1.0,0.14,0.005), smoothstep(0.02,0.35,h));
  c = mix(c, vec3(1.0,0.34,0.03), smoothstep(0.35,0.7,h));
  c = mix(c, vec3(1.0,0.62,0.22), smoothstep(0.75,1.0,h));
  return c;
}
void main(){
  float f0 = floor(uFrame), k = uFrame - f0;
  float v = mix(frameAt(f0), frameAt(f0 + 1.0), k) * uGain;
  v *= smoothstep(0.0, 0.06, vUv.x) * smoothstep(1.0, 0.94, vUv.x) * smoothstep(1.0, 0.9, vUv.y);
  v *= smoothstep(0.03, 0.3, v) * 1.4; // crisp tongue edges instead of a soft haze
  float h = clamp(v, 0.0, 1.0);
  vec3 col = ramp(h) * (2.5 + 10.0 * h * h) * v * uIntensity;
  gl_FragColor = vec4(col, 1.0);
}`;

class FlipFlames {
  constructor(parent, size, cards, uniforms) {
    const F = loadFlipbook();
    this.F = F; this.cards = []; this.shared = uniforms;
    const geo = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < cards; i++) {
      const u = {
        uTex: { value: F.tex }, uFrame: { value: 0 }, uGrid: { value: new THREE.Vector2(8, 8) }, uFrames: { value: 64 },
        uGain: { value: 1 }, uIntensity: uniforms.uIntensity,
        uW: { value: size * (i === 0 ? 0.9 : 0.72) }, uH: { value: size * (i === 0 ? 1.8 : 1.45) },
        uOff: { value: cards > 1 ? (i - (cards - 1) / 2) * 0.1 * size : 0 }, uFlip: { value: i % 2 },
      };
      const m = new THREE.Mesh(geo, new THREE.ShaderMaterial({ vertexShader: flipVS, fragmentShader: flipFS, uniforms: u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      m.frustumCulled = false; m.renderOrder = 1;
      m.position.y = -0.12 * size;
      parent.add(m);
      this.cards.push({ u, t: Math.random() * 10, rate: 0.85 + Math.random() * 0.3 });
    }
  }
  update(dt) {
    const M = this.F.meta;
    let lum = 0;
    for (const c of this.cards) {
      c.t += dt * c.rate;
      const f = (c.t * M.fps) % M.frames;
      c.u.uFrame.value = f; c.u.uGrid.value.set(M.cols, M.rows); c.u.uFrames.value = M.frames; c.u.uGain.value = M.gain || 1;
      if (M.lum) lum += M.lum[Math.floor(f)] / this.cards.length;
    }
    this.lum = M.lum ? lum : 1;
  }
}

function billboardGeo(count, seedFn) {
  const quad = new THREE.PlaneGeometry(1, 1);
  const g = new THREE.InstancedBufferGeometry();
  g.index = quad.index;
  g.setAttribute('position', quad.getAttribute('position'));
  g.setAttribute('uv', quad.getAttribute('uv'));
  const seeds = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) seedFn(seeds, i);
  g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
  g.instanceCount = count;
  return g;
}

export class Fire {
  constructor(scene, pos, { size = 1, light = true, shadow = false, count = 40, smoke = true, intensity = 1, cards = 0 } = {}) {
    this.group = new THREE.Group();
    this.group.position.copy(pos);
    scene.add(this.group);
    this.uniforms = { uTime: { value: Math.random() * 100 }, uSize: { value: size }, uIntensity: { value: 1 } };
    const flames = new THREE.Mesh(
      billboardGeo(count, (s, i) => { s[i * 4] = Math.random(); s[i * 4 + 1] = 0.5 + Math.random() * 0.8; s[i * 4 + 2] = Math.random() * 6.28; s[i * 4 + 3] = 0.9 + Math.random() * 0.9; }),
      new THREE.ShaderMaterial({ vertexShader: flameVS, fragmentShader: flameFS, uniforms: this.uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
    );
    flames.frustumCulled = false;
    // simulated flipbook flames when cards > 0, the old procedural sprites otherwise
    if (cards > 0) this.flip = new FlipFlames(this.group, size, cards, this.uniforms);
    else this.group.add(flames);
    if (smoke) {
      const sm = new THREE.Mesh(
        billboardGeo(Math.round(count * 0.5), (s, i) => { s[i * 4] = Math.random(); s[i * 4 + 1] = 1; s[i * 4 + 2] = Math.random() * 6.28; s[i * 4 + 3] = 0.08 + Math.random() * 0.06; }),
        new THREE.ShaderMaterial({ vertexShader: smokeVS, fragmentShader: smokeFS, uniforms: this.uniforms, transparent: true, depthWrite: false })
      );
      sm.frustumCulled = false; sm.renderOrder = 2;
      this.group.add(sm);
    }
    this.baseIntensity = intensity;
    if (light) {
      this.light = new THREE.PointLight(0xff8a3a, 0, 40 * size, 2.0);
      this.light.position.set(0, (this.flip ? 1.4 : 0.9) * size, 0); // above the logs so they don't blow out
      this.light.castShadow = shadow;
      if (shadow) {
        this.light.shadow.mapSize.set(512, 512);
        this.light.shadow.bias = -0.002;
        this.light.shadow.normalBias = 0.05;
        this.light.shadow.radius = 4;
        this.light.shadow.camera.near = 0.3;
        this.light.shadow.camera.far = 45;
      }
      this.group.add(this.light);
    }
    this.flick = 0;
  }
  update(dt, t) {
    this.uniforms.uTime.value += dt;
    this.flip?.update(dt);
    if (this.light) {
      this.flick += (Math.random() - 0.5) * dt * 30;
      this.flick *= 0.9;
      const lum = this.flip ? 0.55 + 0.45 * this.flip.lum : 1;
      const f = lum * (1 + Math.sin(t * 13.1) * 0.05 + Math.sin(t * 7.3 + 1) * 0.07 + Math.sin(t * 23.7) * 0.03 + this.flick * 0.1);
      this.light.intensity = (this.flip ? 150 : 260) * this.uniforms.uSize.value ** 2 * f * this.baseIntensity * this.uniforms.uIntensity.value;
      this.light.position.x = Math.sin(t * 5.1) * 0.08;
      this.light.position.z = Math.cos(t * 4.3) * 0.08;
    }
  }
}
