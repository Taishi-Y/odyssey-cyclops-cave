import * as THREE from 'three';

const loader = new THREE.TextureLoader();
export const maxAniso = { v: 8 };

function tex(url, srgb = false, repeat = true) {
  const t = loader.load(url);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = maxAniso.v;
  return t;
}

const T = (name, f) => `assets/tex/${name}/${f}`;

// ---------- Triplanar rock (limestone walls + earthy floor) ----------
export function makeRockMaterial() {
  const wallA = tex(T('marble_cliff_02', 'diff.jpg'), true);
  const wallAN = tex(T('marble_cliff_02', 'nor.jpg'));
  const wallAR = tex(T('marble_cliff_02', 'rough.jpg'));
  const wallB = tex(T('cliff_side', 'diff.jpg'), true);
  const wallBN = tex(T('cliff_side', 'nor.jpg'));
  const floorT = tex(T('rock_ground_02', 'diff.jpg'), true);
  const floorN = tex(T('rock_ground_02', 'nor.jpg'));
  const floorR = tex(T('rock_ground_02', 'rough.jpg'));

  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0, vertexColors: true });
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, {
      tA: { value: wallA }, tAN: { value: wallAN }, tAR: { value: wallAR },
      tB: { value: wallB }, tBN: { value: wallBN },
      tF: { value: floorT }, tFN: { value: floorN }, tFR: { value: floorR },
    });
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vWNrm;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed,1.0)).xyz; vWNrm = normalize(mat3(modelMatrix) * objectNormal);');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vWPos; varying vec3 vWNrm;
uniform sampler2D tA, tAN, tAR, tB, tBN, tF, tFN, tFR;
vec3 triW(vec3 n){ vec3 w = pow(abs(n), vec3(6.0)); return w / (w.x+w.y+w.z); }
vec4 tri(sampler2D t, vec3 p, vec3 w){ return texture2D(t,p.zy)*w.x + texture2D(t,p.xz)*w.y + texture2D(t,p.xy)*w.z; }
vec3 triN(sampler2D t, vec3 p, vec3 n, vec3 w){
  vec3 tx = texture2D(t,p.zy).xyz*2.0-1.0; vec3 ty = texture2D(t,p.xz).xyz*2.0-1.0; vec3 tz = texture2D(t,p.xy).xyz*2.0-1.0;
  tx = vec3(tx.xy + n.zy, abs(tx.z)*n.x); ty = vec3(ty.xy + n.xz, abs(ty.z)*n.y); tz = vec3(tz.xy + n.xy, abs(tz.z)*n.z);
  return normalize(tx.zyx*w.x + ty.xzy*w.y + tz.xyz*w.z);
}
float hsh(vec3 p){ p = fract(p*0.3183099+.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float vn(vec3 x){ vec3 i=floor(x); vec3 f=fract(x); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(hsh(i),hsh(i+vec3(1,0,0)),f.x),mix(hsh(i+vec3(0,1,0)),hsh(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hsh(i+vec3(0,0,1)),hsh(i+vec3(1,0,1)),f.x),mix(hsh(i+vec3(0,1,1)),hsh(i+vec3(1,1,1)),f.x),f.y),f.z); }
float gFloor; float gMix; vec3 gW;`)
      .replace('#include <map_fragment>', `
vec3 nW = normalize(vWNrm); gW = triW(nW);
vec3 pA = vWPos * 0.11; vec3 pB = vWPos * 0.07 + 3.1; vec3 pF = vWPos * 0.28;
gMix = smoothstep(0.35, 0.65, vn(vWPos*0.06) );
gFloor = smoothstep(0.55, 0.85, nW.y) * smoothstep(3.5, 0.5, vWPos.y);
vec3 cA = tri(tA, pA, gW).rgb; vec3 cB = tri(tB, pB, gW).rgb;
vec3 cW = mix(cA * vec3(1.02,0.98,0.9), cB * vec3(0.95,0.9,0.82), gMix * 0.6);
// dirt/soot staining toward the floor and grime streaks
float streak = vn(vec3(vWPos.x*0.8, vWPos.y*0.05, vWPos.z*0.8));
cW *= mix(0.55, 1.0, smoothstep(0.0, 6.0, vWPos.y)) * mix(0.75, 1.05, streak);
vec3 cF = tri(tF, pF, gW).rgb * vec3(0.72,0.62,0.5);
diffuseColor.rgb *= mix(cW, cF, gFloor);
`)
      .replace('#include <roughnessmap_fragment>', `
float roughnessFactor = mix(tri(tAR, vWPos*0.11, gW).g * 0.9 + 0.1, tri(tFR, vWPos*0.28, gW).g, gFloor);
roughnessFactor = clamp(roughnessFactor, 0.35, 1.0);`)
      .replace('#include <normal_fragment_maps>', `
{
  vec3 nW2 = normalize(vWNrm);
  vec3 nA = triN(tAN, vWPos*0.11, nW2, gW);
  vec3 nB = triN(tBN, vWPos*0.07+3.1, nW2, gW);
  vec3 nF = triN(tFN, vWPos*0.28, nW2, gW);
  vec3 nWall = normalize(mix(nA, nB, gMix*0.6));
  vec3 nn = normalize(mix(nWall, nF, gFloor));
  normal = normalize((viewMatrix * vec4(nn, 0.0)).xyz);
}`);
  };
  return m;
}

// ---------- Skin (cyclops / soldiers): wrinkles + warm subsurface feel ----------
export function makeSkinMaterial({ color = 0xc9a58a, wrinkle = 1.0, scale = 1.0, map = null } = {}) {
  const m = new THREE.MeshPhysicalMaterial({
    color, map, roughness: 0.62, metalness: 0, sheen: 0.35, sheenRoughness: 0.6, sheenColor: new THREE.Color(0xff9a7a),
  });
  m.onBeforeCompile = (s) => {
    s.uniforms.uWrinkle = { value: wrinkle };
    s.uniforms.uScale = { value: scale };
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vOPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvOPos = position;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vOPos; uniform float uWrinkle; uniform float uScale;
float h3(vec3 p){ p = fract(p*0.3183099+.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float n3(vec3 x){ vec3 i=floor(x); vec3 f=fract(x); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(h3(i),h3(i+vec3(1,0,0)),f.x),mix(h3(i+vec3(0,1,0)),h3(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(h3(i+vec3(0,0,1)),h3(i+vec3(1,0,1)),f.x),mix(h3(i+vec3(0,1,1)),h3(i+vec3(1,1,1)),f.x),f.y),f.z); }
float wr(vec3 p){ // ridged, horizontally-stretched creases
  vec3 q = p * uScale * vec3(9.0, 38.0, 9.0);
  float r = 1.0 - abs(n3(q)*2.0-1.0); float r2 = 1.0 - abs(n3(q*2.1+7.0)*2.0-1.0);
  return pow(r, 6.0)*0.7 + pow(r2, 8.0)*0.3 + n3(p*uScale*140.0)*0.15;
}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  float e = 0.004 / max(uScale, 0.001);
  float h0 = wr(vOPos);
  vec3 g = vec3(wr(vOPos+vec3(e,0,0))-h0, wr(vOPos+vec3(0,e,0))-h0, wr(vOPos+vec3(0,0,e))-h0) / e;
  vec3 gv = (viewMatrix * modelMatrix * vec4(g, 0.0)).xyz;
  normal = normalize(normal - gv * 0.0035 * uWrinkle / max(uScale,0.001));
  diffuseColor.rgb *= 1.0 - h0 * 0.18 * uWrinkle;
}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
// fake subsurface: warm the terminator
totalEmissiveRadiance += diffuseColor.rgb * vec3(0.02, 0.005, 0.0);`);
    // modelMatrix isn't available in fragment by default
    s.fragmentShader = 'uniform mat4 modelMatrix;\n' + s.fragmentShader;
  };
  m.customProgramCacheKey = () => 'skin';
  return m;
}

// ---------- Oxidized bronze ----------
export function makeBronzeMaterial() {
  const m = new THREE.MeshPhysicalMaterial({ color: 0x8a6a3c, metalness: 1, roughness: 0.42, clearcoat: 0.2, clearcoatRoughness: 0.6 });
  m.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvP = position;');
    s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vP;
float bh(vec3 p){ p = fract(p*0.3183099+.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float bn(vec3 x){ vec3 i=floor(x); vec3 f=fract(x); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(bh(i),bh(i+vec3(1,0,0)),f.x),mix(bh(i+vec3(0,1,0)),bh(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(bh(i+vec3(0,0,1)),bh(i+vec3(1,0,1)),f.x),mix(bh(i+vec3(0,1,1)),bh(i+vec3(1,1,1)),f.x),f.y),f.z); }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
float pat = bn(vP*18.0)*0.6 + bn(vP*70.0)*0.4;
roughnessFactor = clamp(roughnessFactor + (pat-0.5)*0.5, 0.2, 0.9);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.18,0.14,0.09), smoothstep(0.55,0.8,pat));`);
  };
  return m;
}

// ---------- Wool ----------
export function makeWoolMaterial() {
  const m = new THREE.MeshPhysicalMaterial({
    color: 0xd9ccb0, roughness: 1, metalness: 0, sheen: 1, sheenRoughness: 0.8, sheenColor: new THREE.Color(0xfff2d8), vertexColors: true,
  });
  m.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvP = position;');
    s.fragmentShader = 'uniform mat4 modelMatrix;\n' + s.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vP;
float wh(vec3 p){ return fract(sin(dot(p, vec3(127.1,311.7,74.7)))*43758.5453); }
float wn(vec3 x){ vec3 i=floor(x); vec3 f=fract(x); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(wh(i),wh(i+vec3(1,0,0)),f.x),mix(wh(i+vec3(0,1,0)),wh(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(wh(i+vec3(0,0,1)),wh(i+vec3(1,0,1)),f.x),mix(wh(i+vec3(0,1,1)),wh(i+vec3(1,1,1)),f.x),f.y),f.z); }
float curl(vec3 p){ return wn(p*14.0)*0.55 + wn(p*38.0)*0.3 + wn(p*110.0)*0.15; }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  float e = 0.004; float h0 = curl(vP);
  vec3 g = vec3(curl(vP+vec3(e,0,0))-h0, curl(vP+vec3(0,e,0))-h0, curl(vP+vec3(0,0,e))-h0)/e;
  normal = normalize(normal - (viewMatrix*modelMatrix*vec4(g,0.)).xyz*0.04);
  diffuseColor.rgb *= 0.55 + 0.6*h0;
}`);
  };
  m.customProgramCacheKey = () => 'wool';
  return m;
}
