import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { makeSkinMaterial, makeBronzeMaterial } from './materials.js';
import { mapBones, Poser, rotWorld } from './rig.js';
import { retargetClips } from './retarget.js';

const loader = new GLTFLoader();
const texL = new THREE.TextureLoader();
let XBOT = null, HEAD = null, CYC = null, SOL = null, CLIPS = null, HELM = null, ODY = null;
// crew built from the film cast (work/ai3d/crew): Meshy image-to-3D + Odysseus skeleton transferred in Blender
export const CREW_MODELS = ['eurylochus', 'polites', 'elpenor'];
// museum-scan helmet (helmet.glb is fitted to odysseus); per-head fit from work/helmet_fit.py (Blender z-up)
const HELMET_FIT = { odysseus: [1.11, -0.014, 1.59199], eurylochus: [1.18, -0.014, 1.59268], polites: [1.16, -0.002, 1.59244], elpenor: [1.13, -0.01, 1.59263] };
const CREW = {};

export async function loadCharacterAssets() {
  const [x, c, so, hm, od] = await Promise.all(['Xbot.glb', 'cyclops_body.glb', 'soldier_body.glb', 'helmet.glb', 'odysseus.glb'].map((f) => loader.loadAsync('assets/chars/' + f)));
  XBOT = x; CYC = c; SOL = so; HELM = prepHelmet(hm.scene); ODY = od;
  const crew = await Promise.all(CREW_MODELS.map((n) => loader.loadAsync(`assets/chars/${n}.glb`)));
  crew.forEach((g, i) => { CREW[CREW_MODELS[i]] = g; });
  // Mixamo clips from the X Bot, rotation-only so they drive any mixamo-named rig in place
  CLIPS = XBOT.animations.map((clip) => {
    const c2 = clip.clone();
    c2.tracks = c2.tracks.filter((t) => t.name.endsWith('.quaternion'));
    return c2;
  });
  const src = SkeletonUtils.clone(XBOT.scene);
  CYC.clips = retargetClips(src, CLIPS, SkeletonUtils.clone(CYC.scene));
  SOL.clips = retargetClips(SkeletonUtils.clone(XBOT.scene), CLIPS, SkeletonUtils.clone(SOL.scene));
  ODY.clips = retargetClips(SkeletonUtils.clone(XBOT.scene), CLIPS, SkeletonUtils.clone(ODY.scene));
  for (const g of Object.values(CREW)) g.clips = retargetClips(SkeletonUtils.clone(XBOT.scene), CLIPS, SkeletonUtils.clone(g.scene));
  // mocap-quality locomotion (walk / jog / sprint / crouch / jump) from Quaternius' Universal Animation Library (CC0),
  // added to every human as m_* clips (work/anim/ual_extract.py)
  const ual = await loader.loadAsync('assets/anim/ual_locomotion.glb');
  const ualRoot = ual.scene;
  ualRoot.traverse((o) => { if (o.isBone && UAL_BONES[o.name]) o.name = 'mixamorig' + UAL_BONES[o.name]; });
  const ualClips = Object.entries(UAL_CLIPS).map(([name, src]) => {
    const c2 = ual.animations.find((a) => a.name === src).clone();
    c2.name = name;
    // bone rotations + the pelvis position (source only: retargetClips turns it into a scaled hips bob)
    c2.tracks = c2.tracks.filter((t) => { const [b, p] = t.name.split('.'); return UAL_BONES[b] && (p === 'quaternion' || (p === 'position' && b === 'DEF-hips')); });
    for (const t of c2.tracks) { const [b, p] = t.name.split('.'); t.name = `mixamorig${UAL_BONES[b]}.${p}`; }
    return c2;
  });
  for (const g of [SOL, ODY, ...Object.values(CREW)]) {
    g.clips.push(...retargetClips(SkeletonUtils.clone(ualRoot), ualClips, SkeletonUtils.clone(g.scene), 30, { hipsMotion: true, chain: true }));
  }
}
// UAL (Rigify DEF-*) -> Mixamo bone names, after GLTFLoader's node-name sanitising (dots removed)
const UAL_BONES = {
  'DEF-hips': 'Hips', 'DEF-spine001': 'Spine', 'DEF-spine002': 'Spine1', 'DEF-spine003': 'Spine2', 'DEF-neck': 'Neck', 'DEF-head': 'Head',
  'DEF-shoulderL': 'LeftShoulder', 'DEF-upper_armL': 'LeftArm', 'DEF-forearmL': 'LeftForeArm', 'DEF-handL': 'LeftHand',
  'DEF-shoulderR': 'RightShoulder', 'DEF-upper_armR': 'RightArm', 'DEF-forearmR': 'RightForeArm', 'DEF-handR': 'RightHand',
  'DEF-thighL': 'LeftUpLeg', 'DEF-shinL': 'LeftLeg', 'DEF-footL': 'LeftFoot', 'DEF-toeL': 'LeftToeBase',
  'DEF-thighR': 'RightUpLeg', 'DEF-shinR': 'RightLeg', 'DEF-footR': 'RightFoot', 'DEF-toeR': 'RightToeBase',
};
const UAL_CLIPS = { m_idle: 'Idle_Loop', m_walk: 'Walk_Loop', m_jog: 'Jog_Fwd_Loop', m_sprint: 'Sprint_Loop', m_crouch: 'Crouch_Fwd_Loop', m_crouch_idle: 'Crouch_Idle_Loop', m_jump: 'Jump_Loop' };
// ground speed (m/s) of the planted foot in each m_* loop at timeScale 1 on a ~1.75 m body (measured on Odysseus):
// timeScale = speed / LOCO_SPEED keeps the feet from sliding
export const LOCO_SPEED = { m_walk: 0.95, m_jog: 4.6, m_sprint: 6.1, m_crouch: 0.62 };

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
      LeftLeg: bones.lShin, RightLeg: bones.rShin, LeftUpLeg: bones.lThigh, RightUpLeg: bones.rThigh, LeftFoot: bones.lFoot, RightFoot: bones.rFoot,
    };
    this.poser = new Poser(this.model, bones);
    this.poser.collide = { rTorso: height * 0.085, rHead: height * 0.05, rHand: height * 0.045 }; // arms stay outside his own body
    // right-hand finger chains (for gripping a victim) and the across-the-knuckles axis
    const byName = (n) => { let f = null; this.model.traverse((o) => { if (o.isBone && o.name.replace(/^mixamorig:?/, '') === n) f = o; }); return f; };
    this.rFingers = ['Index', 'Middle', 'Ring', 'Pinky'].map((f) => [1, 2, 3].map((i) => byName(`RightHand${f}${i}`)).filter(Boolean));
    this.rThumb = [1, 2, 3].map((i) => byName(`RightHandThumb${i}`)).filter(Boolean);
    this.lFingers = ['Index', 'Middle', 'Ring', 'Pinky'].map((f) => [1, 2, 3].map((i) => byName(`LeftHand${f}${i}`)).filter(Boolean));
    this.lThumb = [1, 2, 3].map((i) => byName(`LeftHandThumb${i}`)).filter(Boolean);
    this.gripL = 0;
    this.grip = 0; this.bite = 0; this.chew = 0;
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
    const E = { x: 0.0212, y: 1.855, z: 0.1182, w: 0.063, h: 0.063, r: 0.0343 };   // large tilted almond eye, measured in Blender (work/socket_info.json)
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
      { name: 'eye', obj: this.eyeGroup, r: 0.042 * k, dmg: 100, world: new THREE.Vector3() },
      zone('head', this.bones.Head, 0.135, 8, new THREE.Vector3(0, 0.098, 0.04)), // the Head bone sits at the skull base: centre the sphere on the skull (mesh y 1.70-1.95)
      zone('body', this.bones.Spine1, 0.17, 3), zone('body', this.bones.Spine2, 0.16, 3), zone('body', this.bones.Hips, 0.16, 3),
      zone('arm', this.bones.RightForeArm, 0.06, 2), zone('arm', this.bones.LeftForeArm, 0.06, 2),
      zone('arm', this.bones.RightArm, 0.06, 2), zone('arm', this.bones.LeftArm, 0.06, 2),
      // the fists: generous, since a man held in the right one is the thing you are shooting at
      zone('hand', this.bones.RightHand, 0.12, 2), zone('hand', this.bones.LeftHand, 0.1, 2),
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
  // first point where a ray meets his (skinned, posed) skin, or null
  surfaceHit(origin, dir, far) {
    if (!this._skinMeshes) { this._skinMeshes = []; this.model.traverse((o) => { if (o.isMesh && o !== this.eyeMesh) this._skinMeshes.push(o); }); this._rc = new THREE.Raycaster(); }
    // three's SkinnedMesh.raycast re-skins every vertex per triangle (~110 ms on him): skin the mesh once per
    // pose into a flat world-space buffer and test triangles against that instead (a few ms, shared by all rays)
    let hit = null;
    for (const m of this._skinMeshes) {
      const h = m.isSkinnedMesh ? this.skinRay(m, origin, dir, far) : (this._rc.set(origin, dir), this._rc.far = far, this._rc.intersectObject(m, false)[0]);
      if (h && (!hit || h.distance < hit.distance)) hit = h;
    }
    if (!hit) return null;
    // the bone that drives that bit of skin most, so whatever sticks there follows the right limb
    let bone = null;
    const m = hit.object, si = m.geometry?.attributes?.skinIndex, sw = m.geometry?.attributes?.skinWeight;
    if (m.isSkinnedMesh && si && sw && hit.face) {
      let best = 0;
      for (const vi of [hit.face.a, hit.face.b, hit.face.c]) for (let k = 0; k < 4; k++) {
        const w = sw.getComponent(vi, k); if (w > best) { best = w; bone = m.skeleton.bones[si.getComponent(vi, k)] || bone; }
      }
    }
    const point = hit.point.clone(); point.bone = bone;
    return point;
  }
  // the skinned mesh in its current pose, world space (cached until the next animation update)
  skinnedPositions(m) {
    const c = (this._skinCache ||= new Map()).get(m);
    if (c && c.pose === this._pose) return c.pos;
    const g = m.geometry, P = g.attributes.position, SI = g.attributes.skinIndex, SW = g.attributes.skinWeight, n = P.count;
    const out = c?.pos || new Float32Array(n * 3);
    m.skeleton.update();
    const bm = m.skeleton.boneMatrices;
    // world = matrixWorld * bindMatrixInverse * sum(w * boneMatrix) * bindMatrix * v
    const pre = m.bindMatrix.elements, post = new THREE.Matrix4().multiplyMatrices(m.matrixWorld, m.bindMatrixInverse).elements;
    // attributes may be interleaved: read them through (array, stride, offset)
    const view = (A) => A.isInterleavedBufferAttribute ? [A.data.array, A.data.stride, A.offset] : [A.array, A.itemSize, 0];
    const [pa, ps, po] = view(P), [sia, sis, sio] = view(SI), [swa, sws, swo] = view(SW);
    const norm = P.normalized || SW.normalized;
    for (let i = 0; i < n; i++) {
      const x = norm ? P.getX(i) : pa[i * ps + po], y = norm ? P.getY(i) : pa[i * ps + po + 1], z = norm ? P.getZ(i) : pa[i * ps + po + 2];
      const bx = pre[0] * x + pre[4] * y + pre[8] * z + pre[12], by = pre[1] * x + pre[5] * y + pre[9] * z + pre[13], bz = pre[2] * x + pre[6] * y + pre[10] * z + pre[14];
      let sx = 0, sy = 0, sz = 0;
      for (let k = 0; k < 4; k++) {
        const w = norm ? SW.getComponent(i, k) : swa[i * sws + swo + k]; if (!w) continue;
        const o = sia[i * sis + sio + k] * 16;
        sx += w * (bm[o] * bx + bm[o + 4] * by + bm[o + 8] * bz + bm[o + 12]);
        sy += w * (bm[o + 1] * bx + bm[o + 5] * by + bm[o + 9] * bz + bm[o + 13]);
        sz += w * (bm[o + 2] * bx + bm[o + 6] * by + bm[o + 10] * bz + bm[o + 14]);
      }
      out[i * 3] = post[0] * sx + post[4] * sy + post[8] * sz + post[12];
      out[i * 3 + 1] = post[1] * sx + post[5] * sy + post[9] * sz + post[13];
      out[i * 3 + 2] = post[2] * sx + post[6] * sy + post[10] * sz + post[14];
    }
    this._skinCache.set(m, { pose: this._pose, pos: out });
    return out;
  }
  // nearest triangle of a skinned mesh along a ray (Moller-Trumbore on the cached pose), three-style hit or null
  skinRay(m, o, d, far) {
    const pos = this.skinnedPositions(m), idx = m.geometry.index?.array, nt = idx ? idx.length / 3 : pos.length / 9;
    const ox = o.x, oy = o.y, oz = o.z, dx = d.x, dy = d.y, dz = d.z;
    let best = far, bf = -1;
    for (let f = 0; f < nt; f++) {
      const a = (idx ? idx[f * 3] : f * 3) * 3, b = (idx ? idx[f * 3 + 1] : f * 3 + 1) * 3, c = (idx ? idx[f * 3 + 2] : f * 3 + 2) * 3;
      const ax = pos[a], ay = pos[a + 1], az = pos[a + 2];
      const e1x = pos[b] - ax, e1y = pos[b + 1] - ay, e1z = pos[b + 2] - az, e2x = pos[c] - ax, e2y = pos[c + 1] - ay, e2z = pos[c + 2] - az;
      const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (det > -1e-9 && det < 1e-9) continue;
      const inv = 1 / det, tx = ox - ax, ty = oy - ay, tz = oz - az;
      const u = (tx * px + ty * py + tz * pz) * inv; if (u < 0 || u > 1) continue;
      const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
      const v = (dx * qx + dy * qy + dz * qz) * inv; if (v < 0 || u + v > 1) continue;
      const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
      if (t > 0 && t < best) { best = t; bf = f; }
    }
    if (bf < 0) return null;
    const face = idx ? { a: idx[bf * 3], b: idx[bf * 3 + 1], c: idx[bf * 3 + 2] } : { a: bf * 3, b: bf * 3 + 1, c: bf * 3 + 2 };
    return { distance: best, point: o.clone().addScaledVector(d, best), object: m, face };
  }
  updateZones() { for (const z of this.zones) { if (z.offset) z.obj.localToWorld(z.world.copy(z.offset)); else z.obj.getWorldPosition(z.world); } }

  update(dt) {
    this._pose = (this._pose || 0) + 1; // invalidates the skinned-pose cache used for arrow hits
    this.mixer.update(dt);
    this.model.updateMatrixWorld(true);
    let want = Math.max(this.forceSquat || 0, (this.crouch || 0) * (this.crouchDepth || 1.3)); // crouch: ducking through the low entrance tunnel
    for (const k of ['R', 'L']) { const ik = this.ik[k]; if (ik && ik.w > 0.05) { const ly = ik.target.y - this.root.position.y; want = Math.max(want, THREE.MathUtils.clamp((7.5 - ly) / 7.5, 0, 1) * ik.w); } }
    this.squat += (want - this.squat) * Math.min(1, dt * (want > this.squat && this.forceSquat ? this.squatRate || 2.5 : 2.5));
    if (this.squat > 0.01) { this.poser.squatBend(this.squat * 0.85, this.squat, this.squatSign || 1); this.model.position.y = -this.squat * this.height * 0.22; }
    else this.model.position.y = 0;
    this.model.updateMatrixWorld(true);
    // lying asleep: chin lifted off the chest so the face (and the eye) stays turned out
    if (this.headLift) { this.poser.frame(); rotWorld(this.bones.Neck, this.poser.right, -this.headLift * 0.45); rotWorld(this.bones.Head, this.poser.right, -this.headLift * 0.55); this.model.updateMatrixWorld(true); }
    if (this.lookAt) this.poser.look(this.lookAt, 0.8);
    // eating: neck/head lunge down toward the hand (bite) plus a small chewing bob
    if (this.bite || this.chew) {
      this.poser.frame(); const R = this.poser.right;
      rotWorld(this.bones.Neck, R, this.bite * 0.32 + this.chew * 0.05);
      rotWorld(this.bones.Head, R, this.bite * 0.28 + this.chew * 0.09);
    }
    // pain flinch: a sharp hunch forward with the head dropping, easing off over ~1.5 s
    if (this.hurt > 0) {
      const a = Math.sin(Math.min(1, (1 - this.hurt) * 6) * Math.PI / 2) * Math.min(1, this.hurt * 1.6);
      this.poser.frame(); const R = this.poser.right;
      rotWorld(this.bones.Spine1, R, a * 0.16);
      rotWorld(this.bones.Spine2, R, a * 0.14);
      rotWorld(this.bones.Head, R, a * 0.22);
      this.hurt = Math.max(0, this.hurt - dt / 1.6);
      this.model.updateMatrixWorld(true);
    }
    // violent hit reaction on top: the body jerks away from the arrow, twists, and shudders as it fades
    this._rt = (this._rt || 0) + dt;
    if (this.jolt > 0) {
      this.poser.frame(); const R = this.poser.right, F = this.poser.fwd, U = this.poser.up, j = this.jolt, s = this.joltSide || 1;
      const snap = Math.min(1, (1 - j) * 10) * j;                  // instant snap, then decays
      const shud = Math.sin(this._rt * 41) * j * j * 0.07;         // fast shudder
      rotWorld(this.bones.Spine, R, -snap * 0.28);                 // thrown back by the impact
      rotWorld(this.bones.Spine1, F, s * (snap * 0.22 + shud));    // bent sideways
      rotWorld(this.bones.Spine2, U, s * snap * 0.35);             // twisted
      rotWorld(this.bones.Neck, F, -s * (snap * 0.3 + shud * 1.5));
      rotWorld(this.bones.Head, R, -snap * 0.35 + Math.sin(this._rt * 23) * j * 0.12); // head whips back, twitching
      for (const [arm, sg] of [[this.bones.LeftArm, 1], [this.bones.RightArm, -1]]) if (arm) rotWorld(arm, F, sg * snap * 0.5); // arms fling out
      this.jolt = Math.max(0, j - dt / 1.1);
      this.model.updateMatrixWorld(true);
    }
    // eye pain: rocking and writhing while he crouches with his hands over the eye
    if (this.writhe > 0) {
      this.poser.frame(); const F = this.poser.fwd, R = this.poser.right, w = Math.min(1, this.writhe);
      rotWorld(this.bones.Spine1, F, Math.sin(this._rt * 3.1) * 0.14 * w);
      rotWorld(this.bones.Spine2, R, (0.25 + Math.sin(this._rt * 5.3) * 0.08) * w);
      rotWorld(this.bones.Head, F, Math.sin(this._rt * 7.7 + 1) * 0.12 * w);
      rotWorld(this.bones.Head, R, (0.3 + Math.sin(this._rt * 17) * 0.05) * w);
      this.model.updateMatrixWorld(true);
    }
    this.poser.armsClear({ R: this.ik.R && this.ik.R.w > 0.6, L: this.ik.L && this.ik.L.w > 0.6 });
    if (this.ik.R) this.poser.reach('R', this.ik.R.target, this.ik.R.w);
    if (this.ik.L) this.poser.reach('L', this.ik.L.target, this.ik.L.w);
    // ducking: tuck the hands in onto the knees so the arms don't scrape the tunnel walls
    if ((this.crouch || 0) > 0.02) {
      const r = this.root, f = new THREE.Vector3(Math.sin(r.rotation.y), 0, Math.cos(r.rotation.y)), rt = new THREE.Vector3(f.z, 0, -f.x);
      const k = this.height / 13;
      for (const [side, sgn] of [['R', -1], ['L', 1]]) {
        if (this.ik[side]) continue;
        const tgt = r.position.clone().addScaledVector(f, 2.2 * k).addScaledVector(rt, sgn * 0.9 * k).add(new THREE.Vector3(0, 3.2 * k, 0));
        this.poser.reach(side, tgt, this.crouch);
      }
    }
    // IK holds can also set the hand's orientation (fingers along aim.fingers, palm onto aim.palm) and curl the fingers
    for (const side of ['R', 'L']) { const ik = this.ik[side]; if (ik?.aim && ik.w > 0.01) this.aimHand(side, ik.aim.fingers, ik.aim.palm, ik.w); }
    if (this.gripL > 0.01 && this.lFingers[0]?.length) {
      const a = this.lFingers[0][0].getWorldPosition(new THREE.Vector3()), b = this.lFingers[3][0].getWorldPosition(new THREE.Vector3());
      const axis = a.sub(b).normalize().multiplyScalar(-(this.gripSign || 1));
      for (const ch of this.lFingers) ch.forEach((bn, i) => rotWorld(bn, axis, this.gripL * [0.9, 1.1, 0.8][i]));
      for (const bn of this.lThumb) rotWorld(bn, axis, this.gripL * 0.4);
    }
    if (this.grip > 0.01 && this.rFingers[0]?.length) {
      // curl the fingers around what the hand holds (axis runs across the knuckles)
      const a = this.rFingers[0][0].getWorldPosition(new THREE.Vector3()), b = this.rFingers[3][0].getWorldPosition(new THREE.Vector3());
      const axis = a.sub(b).normalize().multiplyScalar(this.gripSign || 1);
      for (const ch of this.rFingers) ch.forEach((bn, i) => rotWorld(bn, axis, this.grip * [0.9, 1.1, 0.8][i]));
      for (const bn of this.rThumb) rotWorld(bn, axis, this.grip * 0.4);
    }
    // eyelids / blinking (sideways)
    if (!this.blind) { this.blinkT -= dt; if (this.blinkT < 0) { this.blink = 1; this.blinkT = 2.5 + Math.random() * 4; } }
    this.blink = Math.max(0, this.blink - dt * 5);
    const closed = this.blind ? 1 : Math.max(1 - this.eyeOpen, Math.sin(this.blink * Math.PI));
    this.lid.visible = closed > 0.04;
    this.lid.scale.x = this.E.r * 1.08 * Math.max(0.05, closed);
    this.root.updateMatrixWorld(true);
    this.updateZones();
  }

  // turn a hand (after IK placed the wrist) so the fingers point along `fingers` and the palm faces `palm` (world dirs)
  aimHand(side, fingers, palm, w = 1) {
    const hand = side === 'R' ? this.bones.RightHand : this.bones.LeftHand, F = side === 'R' ? this.rFingers : this.lFingers;
    if (!hand || !F?.[1]?.[0] || !F[3]?.[0]) return;
    const P = (o) => o.getWorldPosition(new THREE.Vector3());
    let f = P(F[1][0]).sub(P(hand)).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(f, fingers.clone().normalize());
    const ang = 2 * Math.acos(THREE.MathUtils.clamp(q.w, -1, 1));
    if (ang > 1e-4) rotWorld(hand, new THREE.Vector3(q.x, q.y, q.z).normalize(), ang * w);
    f = P(F[1][0]).sub(P(hand)).normalize();
    const cur = f.clone().cross(P(F[3][0]).sub(P(F[0][0]))).normalize().multiplyScalar(side === 'R' ? 1 : -1);
    const want = palm.clone().addScaledVector(f, -palm.dot(f));
    if (want.lengthSq() < 1e-6) return;
    want.normalize();
    let a = Math.acos(THREE.MathUtils.clamp(cur.dot(want), -1, 1));
    if (cur.clone().cross(want).dot(f) < 0) a = -a;
    rotWorld(hand, f, a * w);
  }
  palmWorld(side, v = new THREE.Vector3()) {
    const hand = side === 'R' ? this.bones.RightHand : this.bones.LeftHand, F = side === 'R' ? this.rFingers : this.lFingers;
    const P = (o) => o.getWorldPosition(new THREE.Vector3());
    const f = P(F[1][0]).sub(P(hand)).normalize();
    return v.copy(f.cross(P(F[3][0]).sub(P(F[0][0]))).normalize().multiplyScalar(side === 'R' ? 1 : -1));
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

// helmet.glb materials: dark inner face for the lining, vertex-coloured horsehair
function prepHelmet(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
    const m = o.material;
    if (m.name === 'helmet_horsehair') {
      m.vertexColors = true; m.side = THREE.DoubleSide;
    } else {
      m.side = THREE.DoubleSide;
      m.envMapIntensity = 0.7;
      if (m.name === 'helmet_bronze') {
        // the museum scan ships a specular-workflow material (ior 1000) that renders as a black mirror
        if (m.isMeshPhysicalMaterial) { m.ior = 1.5; m.specularColorMap = null; m.specularIntensity = 1; }
        m.metalnessMap = null; m.metalness = 0.6; m.roughness = 0.9; m.color.setScalar(2.4);
      }
      m.onBeforeCompile = (s) => {
        s.fragmentShader = s.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n  if (!gl_FrontFacing) diffuseColor.rgb *= 0.18;');
        s.fragmentShader = s.fragmentShader.replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n  if (!gl_FrontFacing) metalnessFactor = 0.0;');
      };
    }
  });
  return root;
}

const bronze = () => makeBronzeMaterial();
// ---------------------------------------------------------------------------------------------
// Greek soldiers: MakeHuman body + bronze crested helmet and cuirass, optional torch
// ---------------------------------------------------------------------------------------------
export class Soldier {
  constructor(scene, { torch = false, seed = 0, hero = false, model = null, helmet = false } = {}) {
    const h = 1.74 + Math.sin(seed * 12.9) * 0.06;
    // hero: Meshy image-to-3D model generated from the film costume (work/ai3d), already wears armour
    const crewSrc = model && CREW[model];
    const rig = hero ? cloneHuman(ODY, h, 1.70) : crewSrc ? cloneHuman(crewSrc, h, 1.70) : cloneHuman(SOL, h, 1.80);
    const fitKey = hero ? 'odysseus' : crewSrc ? model : null;
    if (crewSrc) hero = true; // generated crew already wear their armour: no primitive helmet/cuirass
    Object.assign(this, rig);
    const k = h / (hero ? 1.70 : 1.8);
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
    this.bmap = bones;
    this.headBone = bones.head; this.hips = bones.hips;
    const bm = bronze();
    const at = (bone, obj, x, y, z) => { obj.position.set(x * k, y * k, z * k); obj.scale.multiplyScalar(k); scene.add(obj); obj.updateMatrixWorld(true); bone.attach(obj); };
    if (!hero) {
      // Corinthian bronze helmet fitted to this body in Blender (work/helmet_build.py), horsehair crest
      const helmet = HELM.clone(); this.helmet = helmet;
      at(bones.head, helmet, 0, 0, 0);
      // bronze cuirass over the tunic
      const cu = new THREE.Mesh(new THREE.CylinderGeometry(0.175, 0.15, 0.36, 28, 1, true), bm);
      cu.scale.set(1, 1, 0.72); cu.castShadow = true;
      at(bones.spine2 || bones.spine1, cu, 0, 1.3, 0.005);
    }
    if (helmet && fitKey && HELMET_FIT[fitKey]) {
      // same scanned helmet for everyone, re-scaled/placed to sit on this head
      const [s0, y0, z0] = HELMET_FIT.odysseus, [s1, y1, z1] = HELMET_FIT[fitKey], r = s1 / s0;
      const hm = HELM.clone(); this.helmet = hm;
      const holder = new THREE.Group(); holder.add(hm);
      hm.scale.setScalar(r); hm.position.set(0, z1 - z0 * r, -(y1 - y0 * r));
      at(bones.head, holder, 0, 0, 0);
    }
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
    // walk <-> jog <-> sprint: carry the step phase over so the feet don't pop (all m_* loops start on the left foot)
    const c = this.current;
    if (c && LOCO_SPEED[name] && LOCO_SPEED[c.getClip().name]) a.time = (c.time / c.getClip().duration) * a.getClip().duration;
    if (c) c.fadeOut(fade);
    this.current = a;
  }
}
