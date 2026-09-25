import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { makeSkinMaterial, makeBronzeMaterial } from './materials.js';
import { mapBones, Poser } from './rig.js';
import { retargetClips } from './retarget.js';

const loader = new GLTFLoader();
const texL = new THREE.TextureLoader();
let XBOT = null, HEAD = null, CYC = null, SOL = null, CLIPS = null;

export async function loadCharacterAssets() {
  const [x, c, so] = await Promise.all(['Xbot.glb', 'cyclops_body.glb', 'soldier_body.glb'].map((f) => loader.loadAsync('assets/chars/' + f)));
  XBOT = x; CYC = c; SOL = so;
  // Mixamo clips from the X Bot, rotation-only so they drive any mixamo-named rig in place
  CLIPS = XBOT.animations.map((clip) => {
    const c2 = clip.clone();
    c2.tracks = c2.tracks.filter((t) => t.name.endsWith('.quaternion'));
    return c2;
  });
  const src = SkeletonUtils.clone(XBOT.scene);
  CYC.clips = retargetClips(src, CLIPS, SkeletonUtils.clone(CYC.scene));
  SOL.clips = retargetClips(SkeletonUtils.clone(XBOT.scene), CLIPS, SkeletonUtils.clone(SOL.scene));
}

// Realistic MakeHuman body (Mixamo-named rig) with the Mixamo clips
function cloneHuman(src, height, modelHeight) {
  const inner = SkeletonUtils.clone(src.scene);
  inner.scale.setScalar(height / modelHeight);
  const root = new THREE.Group();
  root.add(inner);
  const mixer = new THREE.AnimationMixer(inner);
  const actions = {};
  for (const clip of src.clips || CLIPS) actions[clip.name] = mixer.clipAction(clip);
  return { root, mixer, actions, scale: height / modelHeight };
}

function findBone(root, name) {
  let b = null;
  root.traverse((o) => { if (o.isBone && o.name === `mixamorig${name}`) b = o; });
  if (!b) root.traverse((o) => { if (o.isBone && o.name.endsWith(name)) b = o; });
  return b;
}

function cloneRig(height) {
  const root = SkeletonUtils.clone(XBOT.scene);
  // measure the real skeleton height (bind-pose mesh bounds are in a different unit than the bones)
  root.updateMatrixWorld(true);
  const top = findBone(root, 'HeadTop_End').getWorldPosition(new THREE.Vector3());
  const foot = findBone(root, 'LeftToe_End').getWorldPosition(new THREE.Vector3());
  const s = height / (top.y - Math.min(foot.y, 0));
  root.scale.setScalar(s);
  const mixer = new THREE.AnimationMixer(root);
  const actions = {};
  for (const clip of XBOT.animations) actions[clip.name] = mixer.clipAction(clip);
  return { root, mixer, actions, scale: s };
}

// adds procedural fine wrinkles + a warm subsurface lift to an existing (textured) skin material
function enhanceSkin(mat, { wrinkle = 1, scale = 3, tint = null, rough = 0.62 } = {}) {
  const m = new THREE.MeshPhysicalMaterial({
    map: mat.map, color: tint ? new THREE.Color(tint) : mat.color, roughness: rough, metalness: 0,
    sheen: 0.4, sheenRoughness: 0.55, sheenColor: new THREE.Color(0xff8f70), normalMap: mat.normalMap || null,
  });
  m.onBeforeCompile = (s) => {
    s.uniforms.uWrinkle = { value: wrinkle }; s.uniforms.uScale = { value: scale };
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vOPos;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvOPos = position;');
    s.fragmentShader = 'uniform mat4 modelMatrix;\n' + s.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vOPos; uniform float uWrinkle; uniform float uScale;
float h3(vec3 p){ return fract(sin(dot(p, vec3(127.1,311.7,74.7)))*43758.5453); }
float n3(vec3 x){ vec3 i=floor(x); vec3 f=fract(x); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(h3(i),h3(i+vec3(1,0,0)),f.x),mix(h3(i+vec3(0,1,0)),h3(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(h3(i+vec3(0,0,1)),h3(i+vec3(1,0,1)),f.x),mix(h3(i+vec3(0,1,1)),h3(i+vec3(1,1,1)),f.x),f.y),f.z); }
float wr(vec3 p){ vec3 q = p * uScale * vec3(18.0, 70.0, 18.0);
  float r = 1.0 - abs(n3(q)*2.0-1.0); float r2 = 1.0 - abs(n3(q*2.3+7.0)*2.0-1.0);
  return pow(r, 7.0)*0.6 + pow(r2, 9.0)*0.3; }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{ float e = 0.0015 / uScale; float h0 = wr(vOPos);
  vec3 g = vec3(wr(vOPos+vec3(e,0,0))-h0, wr(vOPos+vec3(0,e,0))-h0, wr(vOPos+vec3(0,0,e))-h0) / e;
  normal = normalize(normal - (viewMatrix * modelMatrix * vec4(g, 0.0)).xyz * 0.0011 * uWrinkle / uScale);
  diffuseColor.rgb *= 1.0 - h0 * 0.22 * uWrinkle; }`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vec3(0.015, 0.004, 0.0);');
  };
  m.customProgramCacheKey = () => 'eskin' + wrinkle + scale;
  return m;
}

// ---------------------------------------------------------------------------------------------
// Polyphemus: gaunt, wrinkled old giant, bald, single vertical eye (Goya's Saturn as reference)
// ---------------------------------------------------------------------------------------------
export class Cyclops {
  constructor(scene, height = 13) {
    this.height = height;
    const rig = cloneHuman(CYC, height, 1.95);
    Object.assign(this, rig);
    this.model = this.root;
    this.root = new THREE.Group();
    this.root.add(this.model);
    this.model.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
      const n = (o.material.name || o.name).toLowerCase();
      if (o.name.includes('eyes')) { o.material = o.material.clone(); this.eyeMesh = o; }
      if (n.includes('skin')) { o.material = enhanceSkin(o.material, { wrinkle: 0.0, scale: 5, tint: 0xd8c2ae, rough: 0.6 }); this.skin = o.material; }
      else if (n.includes('cloth') || n.includes('wrap')) { o.material = o.material.clone(); o.material.color.multiplyScalar(0.55); o.material.roughness = 0.95; }
    });
    const bones = mapBones(this.model);
    this.bones = {
      Hips: bones.hips, Spine: bones.spine, Spine1: bones.spine1, Spine2: bones.spine2, Neck: bones.neck, Head: bones.head,
      LeftArm: bones.lArm, RightArm: bones.rArm, LeftForeArm: bones.lFore, RightForeArm: bones.rFore, LeftHand: bones.lHand, RightHand: bones.rHand,
      LeftLeg: bones.lShin, RightLeg: bones.rShin, LeftUpLeg: bones.lThigh, RightUpLeg: bones.rThigh,
    };
    this.poser = new Poser(this.model, bones);
    // warm under-light, as if the fire were bouncing up onto his face (the film's close-ups)
    this.faceLight = new THREE.SpotLight(0xff8a44, 420, height * 0.6, 0.38, 0.7, 2);
    this.faceLight.position.set(0, height * 0.6, height * 0.42);
    this.faceTarget = new THREE.Object3D(); this.faceTarget.position.set(0, height * 0.9, 0);
    this.faceLight.target = this.faceTarget;
    this.root.add(this.faceLight, this.faceTarget);
    scene.add(this.root);
    this.root.updateMatrixWorld(true);
    const k = height / 1.95;
    // the single vertical eye (placed in model space at rest, then bound to the head bone)
    const E = { x: 0.0212, y: 1.855, z: 0.1371, w: 0.027, h: 0.027, r: 0.0155 };   // round off-centre eye, measured in Blender
    this.eyeGroup = new THREE.Group();
    this.eyeGroup.position.set(E.x * k, E.y * k, E.z * k);
    this.eyeGroup.scale.setScalar(k);
    scene.add(this.eyeGroup); this.eyeGroup.updateMatrixWorld(true);
    this.bones.Head.attach(this.eyeGroup);
    // a lid that slides shut sideways (the film's side-blink)
    this.lid = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), this.skin);
    this.lid.scale.set(E.r * 1.08, E.r * 1.08, E.r * 1.08);
    this.lid.visible = false;
    this.eyeGroup.add(this.lid);
    this.E = E;
    this.blink = 0; this.blinkT = 3; this.eyeOpen = 1; this.blind = false;
    this.headMesh = this.eyeGroup; // reference point for mouth/eye helpers
    // hit zones
    const zone = (name, bone, r, dmg, off) => ({ name, obj: bone, r: r * k, dmg, offset: off ? off.clone() : null, world: new THREE.Vector3() });
    this.zones = [
      { name: 'eye', obj: this.eyeGroup, r: 0.03 * k, dmg: 100, world: new THREE.Vector3() },
      zone('head', this.bones.Head, 0.11, 8),
      zone('body', this.bones.Spine1, 0.17, 3), zone('body', this.bones.Spine2, 0.16, 3), zone('body', this.bones.Hips, 0.16, 3),
      zone('arm', this.bones.RightForeArm, 0.06, 2), zone('arm', this.bones.LeftForeArm, 0.06, 2),
      zone('arm', this.bones.RightArm, 0.06, 2), zone('arm', this.bones.LeftArm, 0.06, 2),
      zone('leg', this.bones.LeftLeg, 0.07, 2), zone('leg', this.bones.RightLeg, 0.07, 2), zone('leg', this.bones.LeftUpLeg, 0.08, 2), zone('leg', this.bones.RightUpLeg, 0.08, 2),
    ];
    this.current = null;
    this.play('idle');
    this.ik = { R: null, L: null };
    this.squat = 0; this.lookAt = null;
  }

  play(name, fade = 0.5, speed = 1) {
    const a = this.actions[name];
    if (!a || this.current === a) { if (a) a.timeScale = speed; return; }
    a.reset().setEffectiveWeight(1).fadeIn(fade).play();
    a.timeScale = speed;
    if (this.current) this.current.fadeOut(fade);
    this.current = a;
  }
  eyeWorld(v = new THREE.Vector3()) { return this.eyeGroup.getWorldPosition(v); }
  mouthWorld(v = new THREE.Vector3()) { return this.eyeGroup.localToWorld(v.set(0, -0.145, -0.01)); }
  handWorld(side = 'R', v = new THREE.Vector3()) { return (side === 'R' ? this.bones.RightHand : this.bones.LeftHand).getWorldPosition(v); }
  updateZones() { for (const z of this.zones) { if (z.offset) z.obj.localToWorld(z.world.copy(z.offset)); else z.obj.getWorldPosition(z.world); } }

  update(dt) {
    this.mixer.update(dt);
    this.model.updateMatrixWorld(true);
    let want = this.forceSquat || 0;
    for (const k of ['R', 'L']) { const ik = this.ik[k]; if (ik && ik.w > 0.05) { const ly = ik.target.y - this.root.position.y; want = Math.max(want, THREE.MathUtils.clamp((7.5 - ly) / 7.5, 0, 1) * ik.w); } }
    this.squat += (want - this.squat) * Math.min(1, dt * 2.5);
    if (this.squat > 0.01) { this.poser.squatBend(this.squat * 0.85, this.squat, this.squatSign || 1); this.model.position.y = -this.squat * this.height * 0.22; }
    else this.model.position.y = 0;
    this.model.updateMatrixWorld(true);
    if (this.lookAt) this.poser.look(this.lookAt, 0.8);
    if (this.ik.R) this.poser.reach('R', this.ik.R.target, this.ik.R.w);
    if (this.ik.L) this.poser.reach('L', this.ik.L.target, this.ik.L.w);
    // eyelids / blinking (sideways)
    if (!this.blind) { this.blinkT -= dt; if (this.blinkT < 0) { this.blink = 1; this.blinkT = 2.5 + Math.random() * 4; } }
    this.blink = Math.max(0, this.blink - dt * 5);
    const closed = this.blind ? 1 : Math.max(1 - this.eyeOpen, Math.sin(this.blink * Math.PI));
    this.lid.visible = closed > 0.04;
    this.lid.scale.x = this.E.r * 1.08 * Math.max(0.05, closed);
    this.root.updateMatrixWorld(true);
    this.updateZones();
  }

  setBlind() {
    this.blind = true;
    if (this.eyeMesh) { const m = this.eyeMesh.material; m.color.setRGB(0.25, 0.015, 0.01); m.map = null; m.roughness = 0.25; m.needsUpdate = true; }
  }
}

function makeEyeTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#e9ddc8'; g.fillRect(0, 0, 512, 256);
  // bloodshot veins
  g.strokeStyle = 'rgba(150,30,25,0.55)'; g.lineWidth = 1.2;
  for (let i = 0; i < 70; i++) {
    g.beginPath(); let x = Math.random() * 512, y = Math.random() * 256; g.moveTo(x, y);
    for (let k = 0; k < 6; k++) { x += (Math.random() - 0.5) * 40; y += (Math.random() - 0.5) * 20; g.lineTo(x, y); }
    g.stroke();
  }
  // iris at the front (u=0.5 faces +x before rotation)
  const cx = 128, cy = 128;
  const grd = g.createRadialGradient(cx, cy, 4, cx, cy, 34);
  grd.addColorStop(0, '#050303'); grd.addColorStop(0.28, '#0a0605'); grd.addColorStop(0.32, '#6b5a3a'); grd.addColorStop(0.75, '#4a3b25'); grd.addColorStop(1, '#241a10');
  g.fillStyle = grd; g.beginPath(); g.ellipse(cx, cy, 20, 34, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(20,14,8,0.6)';
  for (let i = 0; i < 60; i++) { const a = (i / 60) * Math.PI * 2; g.beginPath(); g.moveTo(cx + Math.cos(a) * 8, cy + Math.sin(a) * 12); g.lineTo(cx + Math.cos(a) * 20, cy + Math.sin(a) * 34); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const bronze = () => makeBronzeMaterial();
// ---------------------------------------------------------------------------------------------
// Greek soldiers: MakeHuman body + bronze crested helmet and cuirass, optional torch
// ---------------------------------------------------------------------------------------------
export class Soldier {
  constructor(scene, { torch = false, seed = 0 } = {}) {
    const h = 1.74 + Math.sin(seed * 12.9) * 0.06;
    const rig = cloneHuman(SOL, h, 1.80);
    Object.assign(this, rig);
    const k = h / 1.8;
    const tone = 0.85 + (Math.sin(seed * 3.1) * 0.5 + 0.5) * 0.25;
    this.root.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
      const n = (o.material.name || '').toLowerCase();
      o.material = o.material.clone();
      if (n.includes('skin')) { o.material = enhanceSkin(o.material, { wrinkle: 0.15, scale: 4, rough: 0.55 }); o.material.color.multiplyScalar(tone); }
      if (n.includes('tunic')) { o.material.color.setRGB(0.55, 0.42, 0.28); o.material.roughness = 0.95; }
    });
    scene.add(this.root);
    this.root.updateMatrixWorld(true);
    const bones = mapBones(this.root);
    this.headBone = bones.head; this.hips = bones.hips;
    const bm = bronze();
    const at = (bone, obj, x, y, z) => { obj.position.set(x * k, y * k, z * k); obj.scale.multiplyScalar(k); scene.add(obj); obj.updateMatrixWorld(true); bone.attach(obj); };
    // Corinthian-style helmet with a tall thin crest (as in the film)
    const helmet = new THREE.Group();
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.118, 28, 18, 0, Math.PI * 2, 0, Math.PI * 0.6), bm);
    dome.scale.set(1, 1.1, 1.14); helmet.add(dome);
    const cheek = new THREE.Mesh(new THREE.CylinderGeometry(0.119, 0.108, 0.13, 28, 1, true, Math.PI * 0.18, Math.PI * 0.64), bm);
    cheek.position.y = -0.055; cheek.rotation.y = Math.PI; cheek.scale.z = 1.12; helmet.add(cheek);
    const neckG = new THREE.Mesh(new THREE.CylinderGeometry(0.118, 0.13, 0.08, 28, 1, true, -Math.PI * 0.35, Math.PI * 0.7), bm);
    neckG.position.set(0, -0.05, -0.01); helmet.add(neckG);
    const crest = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.1, 0.26), new THREE.MeshStandardMaterial({ color: 0x3a1a12, roughness: 1 }));
    crest.position.set(0, 0.17, -0.02); helmet.add(crest);
    const holder = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.18), bm); holder.position.set(0, 0.125, -0.01); helmet.add(holder);
    helmet.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    at(bones.head, helmet, 0, 1.725, 0.012);
    // bronze cuirass over the tunic
    const cu = new THREE.Mesh(new THREE.CylinderGeometry(0.175, 0.15, 0.36, 28, 1, true), bm);
    cu.scale.set(1, 1, 0.72); cu.castShadow = true;
    at(bones.spine2 || bones.spine1, cu, 0, 1.3, 0.005);
    this.torch = null;
    if (torch) {
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.6), new THREE.MeshStandardMaterial({ color: 0x2b1d12, roughness: 1 }));
      const hp = bones.rHand.getWorldPosition(new THREE.Vector3()).divideScalar(1);
      stick.position.copy(hp).add(new THREE.Vector3(0, 0.12, 0.08)); stick.rotation.x = 0.25;
      scene.add(stick); stick.updateMatrixWorld(true); bones.rHand.attach(stick);
      this.torchTip = new THREE.Object3D(); this.torchTip.position.copy(hp).add(new THREE.Vector3(0, 0.42, 0.15));
      scene.add(this.torchTip); this.torchTip.updateMatrixWorld(true); bones.rHand.attach(this.torchTip);
    }
    this.current = null;
    this.alive = true;
    this.state = 'idle';
    this.play('idle', 0);
    this.mixer.setTime(Math.random() * 3);
  }
  play(name, fade = 0.4, speed = 1) {
    const a = this.actions[name];
    if (!a || this.current === a) { if (a) a.timeScale = speed; return; }
    a.reset().fadeIn(fade).play(); a.timeScale = speed;
    if (this.current) this.current.fadeOut(fade);
    this.current = a;
  }
}
