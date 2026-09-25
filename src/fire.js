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
  constructor(scene, pos, { size = 1, light = true, shadow = false, count = 40, smoke = true, intensity = 1 } = {}) {
    this.group = new THREE.Group();
    this.group.position.copy(pos);
    scene.add(this.group);
    this.uniforms = { uTime: { value: Math.random() * 100 }, uSize: { value: size }, uIntensity: { value: 1 } };
    const flames = new THREE.Mesh(
      billboardGeo(count, (s, i) => { s[i * 4] = Math.random(); s[i * 4 + 1] = 0.5 + Math.random() * 0.8; s[i * 4 + 2] = Math.random() * 6.28; s[i * 4 + 3] = 0.9 + Math.random() * 0.9; }),
      new THREE.ShaderMaterial({ vertexShader: flameVS, fragmentShader: flameFS, uniforms: this.uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
    );
    flames.frustumCulled = false;
    this.group.add(flames);
    if (smoke) {
      const sm = new THREE.Mesh(
        billboardGeo(Math.round(count * 0.5), (s, i) => { s[i * 4] = Math.random(); s[i * 4 + 1] = 1; s[i * 4 + 2] = Math.random() * 6.28; s[i * 4 + 3] = 0.08 + Math.random() * 0.06; }),
        new THREE.ShaderMaterial({ vertexShader: smokeVS, fragmentShader: smokeFS, uniforms: this.uniforms, transparent: true, depthWrite: false })
      );
      sm.frustumCulled = false; sm.renderOrder = 2;
      this.group.add(sm);
    }
    this.embers = new Embers(this.group, size, Math.round(count * 1.5));
    this.baseIntensity = intensity;
    if (light) {
      this.light = new THREE.PointLight(0xff8a3a, 0, 40 * size, 2.0);
      this.light.position.set(0, 0.9 * size, 0);
      this.light.castShadow = shadow;
      if (shadow) {
        this.light.shadow.mapSize.set(1024, 1024);
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
    this.embers.update(dt);
    if (this.light) {
      this.flick += (Math.random() - 0.5) * dt * 30;
      this.flick *= 0.9;
      const f = 1 + Math.sin(t * 13.1) * 0.05 + Math.sin(t * 7.3 + 1) * 0.07 + Math.sin(t * 23.7) * 0.03 + this.flick * 0.1;
      this.light.intensity = 260 * this.uniforms.uSize.value ** 2 * f * this.baseIntensity * this.uniforms.uIntensity.value;
      this.light.position.x = Math.sin(t * 5.1) * 0.08;
      this.light.position.z = Math.cos(t * 4.3) * 0.08;
    }
  }
}

class Embers {
  constructor(parent, size, n) {
    this.n = n; this.size = size;
    this.pos = new Float32Array(n * 3); this.vel = new Float32Array(n * 3); this.life = new Float32Array(n);
    for (let i = 0; i < n; i++) this.reset(i, Math.random());
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('life', new THREE.BufferAttribute(this.life, 1));
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `attribute float life; varying float vL; void main(){ vL = life; vec4 mv = modelViewMatrix*vec4(position,1.0); gl_PointSize = (2.0 + 3.0*life) * 30.0 / -mv.z; gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `varying float vL; void main(){ float d = length(gl_PointCoord-0.5); float a = smoothstep(0.5,0.0,d) * vL; gl_FragColor = vec4(vec3(1.0,0.45,0.1)*a*8.0, a); }`,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    parent.add(this.points);
  }
  reset(i, l = 1) {
    const s = this.size;
    this.pos[i * 3] = (Math.random() - 0.5) * 0.8 * s; this.pos[i * 3 + 1] = Math.random() * 0.5 * s; this.pos[i * 3 + 2] = (Math.random() - 0.5) * 0.8 * s;
    this.vel[i * 3] = (Math.random() - 0.5) * 0.6; this.vel[i * 3 + 1] = 1 + Math.random() * 2.5 * s; this.vel[i * 3 + 2] = (Math.random() - 0.5) * 0.6;
    this.life[i] = l;
  }
  update(dt) {
    for (let i = 0; i < this.n; i++) {
      this.life[i] -= dt * 0.35;
      if (this.life[i] <= 0) { this.reset(i); continue; }
      this.vel[i * 3] += (Math.random() - 0.5) * dt * 4; this.vel[i * 3 + 2] += (Math.random() - 0.5) * dt * 4;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.life.needsUpdate = true;
  }
}
