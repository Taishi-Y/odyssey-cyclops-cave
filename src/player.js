import * as THREE from 'three';
import { makeBronzeMaterial } from './materials.js';
import { makeStraw } from './world.js';
import { rockField } from './cave.js';
import { mapBones, Poser, rotWorld } from './rig.js';

const woodMat = () => new THREE.MeshStandardMaterial({ color: 0x5a3d24, roughness: 0.7 });

function makeBow() {
  const g = new THREE.Group();
  const pts = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24 - 0.5;
    // recurved composite bow
    // limbs bend away from the archer (-z), tips recurve back (+z)
    const z = -Math.cos(t * Math.PI) * 0.12 + Math.pow(Math.abs(t) * 2, 6) * 0.06;
    pts.push(new THREE.Vector3(0, t * 1.1, z));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const limb = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 0.013, 8), new THREE.MeshStandardMaterial({ color: 0x3b2716, roughness: 0.55 }));
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.13, 10), new THREE.MeshStandardMaterial({ color: 0x1c130c, roughness: 0.9 }));
  grip.position.z = -0.12;
  g.add(limb, grip);
  const top = pts[pts.length - 1], bot = pts[0];
  const sg = new THREE.BufferGeometry().setFromPoints([top, new THREE.Vector3(0, 0, 0), bot]);
  const string = new THREE.Line(sg, new THREE.LineBasicMaterial({ color: 0xcbbfa5 }));
  g.add(string);
  g.userData = { string, top, bot };
  return g;
}

export function makeArrow() {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.75, 6), woodMat());
  shaft.rotation.x = Math.PI / 2;
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.06, 4), makeBronzeMaterial());
  tip.rotation.x = Math.PI / 2; tip.position.z = 0.4;
  const fl = new THREE.Mesh(new THREE.BoxGeometry(0.002, 0.025, 0.1), new THREE.MeshStandardMaterial({ color: 0x2d2621, roughness: 1 }));
  fl.position.z = -0.32; const fl2 = fl.clone(); fl2.rotation.z = Math.PI / 2;
  g.add(shaft, tip, fl, fl2);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

export function makeSpear() {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.017, 2.3, 8), woodMat());
  shaft.rotation.x = Math.PI / 2;
  const tipShape = new THREE.Shape();
  tipShape.moveTo(0, 0); tipShape.quadraticCurveTo(0.035, 0.1, 0, 0.26); tipShape.quadraticCurveTo(-0.035, 0.1, 0, 0);
  const tip = new THREE.Mesh(new THREE.ExtrudeGeometry(tipShape, { depth: 0.006, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.004, bevelSegments: 1 }), makeBronzeMaterial());
  tip.rotation.x = Math.PI / 2; tip.position.z = 1.13;
  const butt = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.1, 6), makeBronzeMaterial()); butt.rotation.x = -Math.PI / 2; butt.position.z = -1.18;
  g.add(shaft, tip, butt);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

export class Player {
  constructor({ camera, scene, physics, audio, input }) {
    Object.assign(this, { camera, scene, physics, audio, input });
    this.pos = new THREE.Vector3(6, 0, 10);
    this.vel = new THREE.Vector3();
    this.yaw = Math.PI; this.pitch = 0;
    this.radius = 0.32; this.height = 1.78;
    this.eye = 1.65; this.crouch = false; this.onGround = false;
    this.hp = 100; this.dead = false;
    this.weapon = 'bow';
    this.arrows = 14; this.spears = 3; this.stones = 6; this.prone = false;
    this.draw = 0; this.drawing = false; this.aim = 0;
    this.noise = 0; // how loud the player is right now (0..1)
    this.disguised = false; this.carrying = null; this.locked = false;
    this.bob = 0; this.shake = 0; this.recoil = 0;
    this.projectiles = [];
    this.stuck = [];
    // view models
    this.view = new THREE.Group();
    camera.add(this.view);
    this.bow = makeBow();
    this.bow.scale.setScalar(0.62);
    this.nocked = makeArrow(); this.bow.add(this.nocked);
    this.view.add(this.bow);
    this.spearView = makeSpear();
    this.spearView.position.set(0.3, -0.28, -0.45); this.spearView.rotation.set(0.05, 0.05, 0);
    this.view.add(this.spearView);
    this.hands = new THREE.Group(); this.view.add(this.hands);
    // straw on the back seen at screen bottom when disguised
    this.strawView = makeStraw(900, 0.55, 0.35, 99);
    this.strawView.position.set(0, -0.36, -0.32); this.strawView.rotation.x = 0.5; this.strawView.scale.set(0.35, 0.18, 0.2);
    this.strawView.visible = false;
    this.view.add(this.strawView);
    // carried log / stake
    this.carryView = new THREE.Group(); this.view.add(this.carryView);
    this.updateWeaponView();
  }

  setCarry(obj) {
    this.carrying = obj;
    this.carryView.clear();
    if (obj) {
      const c = obj.clone(true);
      c.position.set(0.35, -0.45, -1.4); c.rotation.set(0, Math.PI / 2 + 0.25, 0.1);
      c.scale.multiplyScalar(0.55);
      c.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.material = o.material.clone(); } });
      this.carryView.add(c);
      this.carryMesh = c;
    }
    this.updateWeaponView();
  }

  updateWeaponView() {
    const busy = !!this.carrying;
    this.bow.visible = !busy && this.weapon === 'bow';
    this.spearView.visible = !busy && this.weapon === 'spear' && this.spears > 0;
    this.nocked.visible = this.arrows > 0;
  }

  get eyeHeight() { return this.prone ? 0.45 : this.crouch ? (this.disguised ? 0.75 : 1.0) : 1.65; }

  update(dt, t, dtReal = dt) {
    const I = this.input;
    this.updateStamina(dtReal);
    if (this.dead || this.locked) { this.updateCamera(dt, t); this.updateProjectiles(dt); return; }
    // look
    this.yaw -= I.mouse.dx * 0.0022 * (1 - this.aim * 0.5);
    this.pitch -= I.mouse.dy * 0.0022 * (1 - this.aim * 0.5);
    this.pitch = THREE.MathUtils.clamp(this.pitch, -1.45, 1.45);
    I.mouse.dx = I.mouse.dy = 0;
    // weapon switch
    if (I.pressed('Digit1')) { this.weapon = 'bow'; this.updateWeaponView(); }
    if (I.pressed('Digit2')) { this.weapon = 'spear'; this.updateWeaponView(); }
    if (I.pressed('Digit3')) { this.weapon = 'stone'; this.updateWeaponView(); }
    if (I.pressed('KeyV') && this.avatar) this.thirdPerson = !this.thirdPerson;
    // move
    if (I.pressed('KeyZ')) this.prone = !this.prone;
    if (this.carrying) this.prone = false;
    this.crouch = this.prone || I.down('ControlLeft') || I.down('KeyC') || I.down('MetaLeft');
    if (I.pressed('KeyF')) this.onKnock?.();
    if (I.pressed('KeyX')) this.onSwitch?.();
    const run = I.down('ShiftLeft') && !this.crouch && !this.carrying && !this.exhausted && this.stamina > 0;
    this.sprinting = run;
    let speed = this.prone ? 0.9 : this.crouch ? 1.5 : run ? 6.2 : 3.3;
    if (this.carrying) speed *= 0.55;
    const f = (I.down('KeyW') ? 1 : 0) - (I.down('KeyS') ? 1 : 0);
    const s = (I.down('KeyD') ? 1 : 0) - (I.down('KeyA') ? 1 : 0);
    const fw = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const rt = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const wish = fw.multiplyScalar(f).add(rt.multiplyScalar(s));
    if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(speed);
    const accel = this.onGround ? 12 : 2;
    this.vel.x += (wish.x - this.vel.x) * Math.min(1, accel * dt);
    this.vel.z += (wish.z - this.vel.z) * Math.min(1, accel * dt);
    if (this.onGround && I.pressed('Space') && !this.carrying) { this.vel.y = 5.4; this.onGround = false; }
    this.vel.y -= 18 * dt;
    // while in bullet time you hang in the air (fall very slowly)
    if (this.bulletTime && this.vel.y < -1.2) this.vel.y = -1.2;
    // integrate in substeps
    const steps = 3;
    let grounded = false;
    for (let i = 0; i < steps; i++) {
      const prev = this.pos.clone();
      this.pos.addScaledVector(this.vel, dt / steps);
      const h = this.prone ? 0.7 : this.crouch ? 1.1 : this.height;
      const r = this.physics.collideCapsule(this.pos, this.radius, h, this.vel);
      grounded = grounded || r.onGround;
      // never let the head or body poke into the rock (the cave mesh is one-sided)
      const inRock = (y) => rockField(this.pos.x, this.pos.y + y, this.pos.z) > -0.25;
      if (inRock(h - 0.1) || inRock(h * 0.6)) {
        this.pos.x = prev.x; this.pos.z = prev.z;
        if (inRock(h - 0.1)) this.pos.y = Math.min(this.pos.y, prev.y);
        this.vel.x *= 0.2; this.vel.z *= 0.2;
      }
    }
    if (grounded && this.vel.y < 0) this.vel.y = 0;
    this.onGround = grounded;
    const hs = Math.hypot(this.vel.x, this.vel.z);
    // noise model
    const targetNoise = !this.onGround ? 0.3 : run && hs > 1 ? 1 : this.crouch ? 0.02 : hs > 0.5 ? 0.25 : 0.0;
    this.noise = Math.max(targetNoise, this.noise - dt * 0.8);
    this.bob += hs * dt * (run ? 1.9 : 2.3);
    this.moving = hs;
    this.airTime = this.onGround ? 0 : (this.airTime || 0) + dtReal;
    this.handleWeapons(dtReal);
    this.updateCamera(dt, t);
    this.updateProjectiles(dt);
  }

  updateStamina(dtReal) {
    if (this.stamina === undefined) { this.stamina = 1; this.exhausted = false; this.staminaWait = 0; }
    let drain = 0;
    if (this.sprinting && (this.moving || 0) > 1) drain += 0.1;
    if (this.bulletTime) drain += 0.2;
    if (drain > 0) { this.stamina = Math.max(0, this.stamina - drain * dtReal); this.staminaWait = 0.8; if (this.stamina === 0) this.exhausted = true; }
    else {
      this.staminaWait -= dtReal;
      if (this.staminaWait < 0 && this.onGround) this.stamina = Math.min(1, this.stamina + (this.exhausted ? 0.22 : 0.35) * dtReal);
      if (this.stamina >= 1) this.exhausted = false;
    }
  }

  handleWeapons(dt) {
    const I = this.input;
    this.aim = THREE.MathUtils.lerp(this.aim, I.mouseDown[2] ? 1 : 0, dt * 8);
    if (this.carrying) { this.drawing = false; this.draw = 0; return; }
    if (this.weapon === 'bow') {
      if (I.mouseDown[0] && this.arrows > 0) {
        if (!this.drawing) { this.drawing = true; this.audio.bowDraw(); }
        this.draw = Math.min(1, this.draw + dt / 0.75);
      } else if (this.drawing) {
        this.drawing = false;
        if (this.draw > 0.2) this.fireArrow(this.draw);
        this.draw = 0;
      }
    } else if (this.weapon === 'stone') {
      if (I.mouseDown[0] && this.stones > 0) { this.draw = Math.min(1, this.draw + dt / 0.4); this.drawing = true; }
      else if (this.drawing) { this.drawing = false; this.throwStone(this.draw); this.draw = 0; }
    } else if (this.weapon === 'spear') {
      if (I.mouseDown[0] && this.spears > 0) { this.draw = Math.min(1, this.draw + dt / 0.5); this.drawing = true; }
      else if (this.drawing) { this.drawing = false; if (this.draw > 0.3) this.throwSpear(this.draw); this.draw = 0; }
    }
  }

  aimRay() {
    const o = new THREE.Vector3(); this.camera.getWorldPosition(o);
    const d = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.getWorldQuaternion(new THREE.Quaternion()));
    if (!this.thirdPerson || !this.avatar) return { o, d };
    // third person: shoot from Odysseus toward whatever is under the crosshair
    const hit = this.physics.raycastSegment(o, o.clone().addScaledVector(d, 120));
    const target = hit ? hit.point : o.clone().addScaledVector(d, 120);
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const origin = this.pos.clone().add(new THREE.Vector3(0, this.crouch ? 0.95 : 1.45, 0)).addScaledVector(fwd, 0.45);
    return { o: origin, d: target.sub(origin).normalize() };
  }

  fireArrow(power) {
    this.arrows--;
    const { o, d } = this.aimRay();
    const mesh = makeArrow(); this.scene.add(mesh);
    const speed = 22 + power * 48;
    this.projectiles.push({ kind: 'arrow', mesh, pos: o.clone().addScaledVector(d, 0.6), vel: d.clone().multiplyScalar(speed), life: 8, dmg: 0.4 + power * 0.6 });
    this.audio.twang(power);
    this.releaseT = 0.3;
    this.noise = Math.max(this.noise, 0.45);
    this.recoil = 1;
    this.updateWeaponView();
    this.onFire?.();
  }

  throwSpear(power) {
    this.spears--;
    const { o, d } = this.aimRay();
    const mesh = makeSpear(); this.scene.add(mesh);
    const speed = 16 + power * 20;
    this.projectiles.push({ kind: 'spear', mesh, pos: o.clone().addScaledVector(d, 0.8).add(new THREE.Vector3(0, -0.1, 0)), vel: d.clone().multiplyScalar(speed).add(new THREE.Vector3(0, 1.2, 0)), life: 8, dmg: 1.5 + power });
    this.audio.whoosh(0.5);
    this.releaseT = 0.3;
    this.noise = Math.max(this.noise, 0.6);
    this.recoil = 1.4;
    this.updateWeaponView();
    this.onFire?.();
  }

  throwStone(power) {
    this.stones--;
    const { o, d } = this.aimRay();
    const mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(0.06, 0), new THREE.MeshStandardMaterial({ color: 0x8a8070, roughness: 0.9 }));
    mesh.castShadow = true; this.scene.add(mesh);
    this.projectiles.push({ kind: 'stone', mesh, pos: o.clone().addScaledVector(d, 0.5), vel: d.clone().multiplyScalar(10 + power * 14).add(new THREE.Vector3(0, 2.5, 0)), life: 6, dmg: 0 });
    this.audio.whoosh(0.2);
    this.releaseT = 0.3;
    this.onFire?.();
  }

  updateProjectiles(dt) {
    const g = 9.8;
    for (const p of this.projectiles) {
      if (p.stuck) continue;
      const prev = p.pos.clone();
      p.vel.y -= g * dt;
      p.vel.multiplyScalar(1 - 0.02 * dt);
      p.pos.addScaledVector(p.vel, dt);
      // creature hit test first (segment vs spheres)
      const hitC = this.onProjectileTest?.(prev, p.pos, p);
      if (hitC) { p.dead = true; this.scene.remove(p.mesh); continue; }
      const hit = this.physics.raycastSegment(prev, p.pos);
      if (hit) {
        p.pos.copy(hit.point).addScaledVector(p.vel.clone().normalize(), p.kind === 'spear' ? 0.25 : 0.12);
        p.stuck = true;
        this.audio.impact(hit.point, 'rock');
        this.onImpact?.(hit.point, hit.face?.normal, p);
        this.stuck.push(p);
      }
      p.mesh.position.copy(p.pos);
      p.mesh.lookAt(p.pos.clone().add(p.vel));
      p.life -= dt;
      if (p.life < 0 && !p.stuck) { p.dead = true; this.scene.remove(p.mesh); }
    }
    this.projectiles = this.projectiles.filter((p) => !p.dead);
  }

  // pick up stuck arrows / spears near the player
  tryPickup() {
    for (const p of this.stuck) {
      if (p.taken) continue;
      if (p.pos.distanceTo(this.pos.clone().add(new THREE.Vector3(0, 0.8, 0))) < 2.2) {
        p.taken = true; this.scene.remove(p.mesh);
        if (p.kind === 'arrow') this.arrows++; else if (p.kind === 'stone') this.stones++; else this.spears++;
        this.updateWeaponView();
        return p.kind;
      }
    }
    return null;
  }
  nearPickup() { return this.stuck.some((p) => !p.taken && p.pos.distanceTo(this.pos.clone().add(new THREE.Vector3(0, 0.8, 0))) < 2.2); }

  // ------------------------------------------------------------ third-person body
  setAvatar(av, makeBowFn) {
    this.avatar = av;
    this.thirdPerson = true;
    this.faceYaw = this.yaw + Math.PI;
    const S = this.scene;
    this.tpBow = makeBow(); this.tpBow.scale.setScalar(0.95); S.add(this.tpBow);
    this.tpSpear = makeSpear(); S.add(this.tpSpear);
    this.tpStraw = makeStraw(1400, 0.38, 0.32, 77); this.tpStraw.visible = false; S.add(this.tpStraw);
    this.tpCarry = new THREE.Group(); S.add(this.tpCarry);
    this.tpArrow = makeArrow(); S.add(this.tpArrow);
  }

  updateAvatar(dt) {
    const av = this.avatar; if (!av) return;
    const show = this.thirdPerson && (!this.debugCam || this.keepAvatar);
    av.root.visible = show && !(this.dead && this.caughtHidden);
    for (const o of [this.tpBow, this.tpSpear, this.tpStraw, this.tpCarry, this.tpArrow]) o.visible = show;
    if (!show) return;
    const hs = this.moving || 0;
    // face the direction of travel, or the aim direction while aiming / drawing
    if (this._lastYawSet !== this.yawSetId) { this._lastYawSet = this.yawSetId; this.faceYaw = this.yaw + Math.PI; }
    // combat stance weight (drawing / aiming / release follow-through)
    this.releaseT = Math.max(0, (this.releaseT || 0) - dt);
    const combat = !this.carrying && !this.dead && (this.drawing || this.aim > 0.3 || this.releaseT > 0);
    this._cw = THREE.MathUtils.lerp(this._cw || 0, combat ? 1 : 0, Math.min(1, dt * 12));
    const cw = this._cw;
    const isBow = this.weapon === 'bow';
    let want = this.faceYaw;
    // archers stand side-on: left shoulder toward the target
    if (combat) want = this.yaw + Math.PI + (isBow ? -1.05 : -0.35);
    else if (hs > 0.3) want = Math.atan2(this.vel.x, this.vel.z);
    let dh = want - this.faceYaw; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    this.faceYaw += dh * Math.min(1, dt * (combat ? 16 : 10));
    av.root.position.copy(this.pos);
    av.root.rotation.set(0, this.faceYaw, 0);
    // animation
    const anim = this.dead ? 'idle' : this.crouch ? (hs > 0.2 ? 'walk' : 'sneak_pose') : hs > 4.5 ? 'run' : hs > 0.25 ? 'walk' : 'idle';
    av.play(anim, 0.25, anim === 'walk' ? Math.max(0.5, hs / (this.crouch ? 2.2 : 1.6)) : anim === 'run' ? hs / 6 : 1);
    av.mixer.update(dt);
    const low = this.prone ? 0.32 : this.crouch ? (this.disguised ? 0.55 : 0.72) : 1;
    this._low = THREE.MathUtils.lerp(this._low ?? 1, low, Math.min(1, dt * 8));
    av.root.scale.set(1, this._low, 1);
    av.root.updateMatrixWorld(true);
    if (!av.rig) { av.rig = mapBones(av.root); av.poser = new Poser(av.root, av.rig); }
    const B = av.rig, W = (b) => b.getWorldPosition(new THREE.Vector3());
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, this.faceYaw, 0));
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q), right = new THREE.Vector3(-1, 0, 0).applyQuaternion(q);
    // aim direction = camera forward (what the crosshair points at)
    const D = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    const up = new THREE.Vector3(0, 1, 0);
    const d = this.draw;

    if (cw > 0.01 && isBow) {
      // straighten the torso a little, head looks down the arrow
      av.poser.look(W(B.head).addScaledVector(D, 5), cw);
      // left arm: straight toward the target, holding the bow
      const ls = W(B.lArm);
      av.poser.reach('L', ls.clone().addScaledVector(D, 0.72).add(new THREE.Vector3(0, 0.02, 0)), cw);
      av.root.updateMatrixWorld(true);
      const grip = W(B.lHand).addScaledVector(D, 0.03);
      // right hand: on the string, pulled back to the cheek as the draw increases
      const snap = this.releaseT > 0 ? (this.releaseT / 0.3) : 0;     // follow-through after the shot
      const pullDist = 0.1 + d * 0.52 + snap * 0.12;
      const anchor = grip.clone().addScaledVector(D, -pullDist).addScaledVector(right, -0.02 - snap * 0.12).add(new THREE.Vector3(0, snap * 0.05, 0));
      av.poser.reach('R', anchor, cw);
      av.root.updateMatrixWorld(true);
      // place the bow in the left hand, facing the target (+Z of the bow points back at the archer)
      this.tpBow.position.copy(grip).addScaledVector(D, -0.114);
      this.tpBow.up.copy(up).addScaledVector(right, -0.12).normalize();
      this.tpBow.lookAt(this.tpBow.position.clone().sub(D));
      this.tpBow.updateMatrixWorld(true);
      const rh = W(B.rHand);
      const localString = this.tpBow.worldToLocal(rh.clone());
      const pull = THREE.MathUtils.clamp(localString.z, 0.02, 0.62) * (this.releaseT > 0 ? 0 : 1) + (this.releaseT > 0 ? 0.03 : 0);
      const P = this.tpBow.userData.string.geometry.attributes.position; P.setXYZ(1, 0, 0, pull); P.needsUpdate = true;
      // nocked arrow lies on the string, pointing at the target
      this.tpArrow.visible = show && this.arrows > 0 && this.releaseT <= 0 && (d > 0.02 || this.aim > 0.3);
      const nock = this.tpBow.localToWorld(new THREE.Vector3(0, 0, pull));
      this.tpArrow.position.copy(nock).addScaledVector(D, 0.37);
      this.tpArrow.lookAt(this.tpArrow.position.clone().add(D));
    } else {
      // relaxed: bow hangs in the left hand
      const lh = W(B.lHand);
      this.tpBow.position.copy(lh).addScaledVector(fwd, 0.05);
      this.tpBow.quaternion.setFromEuler(new THREE.Euler(0.15, this.faceYaw + Math.PI, -0.25, 'YXZ'));
      const P = this.tpBow.userData.string.geometry.attributes.position; P.setXYZ(1, 0, 0, 0.02); P.needsUpdate = true;
      this.tpArrow.visible = false;
    }
    this.tpBow.visible = show && isBow && !this.carrying;

    // spear: cocked back over the shoulder while charging, thrust forward on release
    this.tpSpear.visible = show && !isBow && this.spears > 0 && !this.carrying && !(this.releaseT > 0.05);
    if (!isBow && cw > 0.01) {
      const rs = W(B.rArm);
      const back = rs.clone().add(new THREE.Vector3(0, 0.28 + d * 0.1, 0)).addScaledVector(D, -0.25 - d * 0.35).addScaledVector(right, 0.08);
      const thrown = rs.clone().addScaledVector(D, 0.65).add(new THREE.Vector3(0, -0.1, 0));
      const t = this.releaseT > 0 ? 1 - this.releaseT / 0.3 : 0;
      av.poser.reach('R', back.lerp(thrown, t), cw);
      av.poser.reach('L', W(B.lArm).addScaledVector(D, 0.55).add(new THREE.Vector3(0, -0.05, 0)), cw * 0.8);
      av.poser.look(W(B.head).addScaledVector(D, 5), cw);
      av.root.updateMatrixWorld(true);
    }
    {
      const rh = W(B.rHand);
      const dir = cw > 0.01 && !isBow ? D.clone() : fwd.clone().add(new THREE.Vector3(0, 0.2, 0)).normalize();
      this.tpSpear.position.copy(rh).addScaledVector(dir, 0.25);
      this.tpSpear.lookAt(this.tpSpear.position.clone().add(dir));
    }
    const bones = { chest: B.spine2 || B.spine1 };
    // straw on the back
    const ch = bones.chest.getWorldPosition(new THREE.Vector3());
    this.tpStraw.visible = show && this.disguised;
    this.tpStraw.position.copy(ch).addScaledVector(fwd, -0.18).add(new THREE.Vector3(0, -0.05, 0));
    this.tpStraw.quaternion.setFromEuler(new THREE.Euler(-1.2 * (this.crouch ? 1 : 0.4), this.faceYaw, 0, 'YXZ'));
    // the olive log on the shoulder
    if (this.carrying && this.tpCarry.userData.src !== this.carrying) {
      this.tpCarry.clear(); const c = this.carrying.clone(true); c.traverse((o) => { if (o.isMesh) o.material = o.material.clone(); });
      this.tpCarry.add(c); this.tpCarry.userData.src = this.carrying; this.tpCarryMesh = c;
    }
    if (!this.carrying) { this.tpCarry.clear(); this.tpCarry.userData.src = null; }
    this.tpCarry.position.copy(ch).add(new THREE.Vector3(0, 0.25, 0)).addScaledVector(right, 0.2);
    this.tpCarry.quaternion.setFromEuler(new THREE.Euler(0, this.faceYaw + Math.PI / 2 + 0.2, 0.08, 'YXZ'));
    this.tpCarry.scale.setScalar(0.62);
  }

  updateCamera(dt, t) {
    this.view.visible = !this.debugCam && !this.thirdPerson;
    this.updateAvatar(dt);
    if (this.debugCam) { const c = this.debugCam; this.camera.position.set(c[0], c[1], c[2]); this.camera.lookAt(c[3], c[4], c[5]); return; }
    const eye = this.eyeHeight;
    this._eye = THREE.MathUtils.lerp(this._eye ?? eye, eye, Math.min(1, dt * 10));
    const bobAmt = this.onGround ? Math.min(1, (this.moving || 0) / 4) : 0;
    const by = Math.sin(this.bob * 2) * 0.035 * bobAmt, bx = Math.cos(this.bob) * 0.03 * bobAmt;
    this.shake = Math.max(0, this.shake - dt * 1.8);
    const sh = this.shake * this.shake;
    const sx = (Math.sin(t * 37) + Math.sin(t * 23.3)) * 0.04 * sh, sy = (Math.sin(t * 31) + Math.cos(t * 19.1)) * 0.04 * sh;
    this.camera.position.set(this.pos.x + bx, this.pos.y + this._eye + by, this.pos.z);
    // breathing sway
    const sway = Math.sin(t * 1.3) * 0.004;
    this.camera.rotation.set(0, 0, 0);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw + sx;
    this.camera.rotation.x = this.pitch + sy + sway + this.recoil * 0.02;
    this.camera.rotation.z = Math.sin(this.bob) * 0.004 * bobAmt;
    this.recoil = Math.max(0, this.recoil - dt * 5);
    this.camera.fov = THREE.MathUtils.lerp(64, 44, this.aim);
    this.camera.updateProjectionMatrix();
    // view model animation
    const d = this.draw;
    this.view.position.set(-bx * 0.5, -by * 0.6 - this.recoil * 0.01, 0);
    if (this.weapon === 'bow') {
      const k = Math.max(d, this.aim);
      this.bow.position.set(THREE.MathUtils.lerp(-0.2, -0.05, k), THREE.MathUtils.lerp(-0.2, -0.07, k), THREE.MathUtils.lerp(-0.6, -0.72, k));
      this.bow.rotation.set(0.05, THREE.MathUtils.lerp(0.25, 0.04, k), THREE.MathUtils.lerp(0.35, 0.18, k));
      const pull = 0.05 + d * 0.55;
      const sg = this.bow.userData.string.geometry;
      const P = sg.attributes.position; P.setXYZ(1, 0, 0, pull); P.needsUpdate = true;
      this.nocked.position.set(0.012, 0, pull - 0.36); this.nocked.rotation.set(0, Math.PI, 0);
    } else {
      this.spearView.position.set(0.3, -0.26 + d * 0.12, -0.45 + d * 0.3);
      this.spearView.rotation.set(0.05 - d * 0.1, 0.05, 0);
    }
    this.strawView.visible = this.disguised;
    if (this.thirdPerson) {
      // over-the-shoulder camera with wall collision
      const qc = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.pitch + sy, this.yaw + sx, 0, 'YXZ'));
      const back = new THREE.Vector3(0, 0, 1).applyQuaternion(qc), right = new THREE.Vector3(1, 0, 0).applyQuaternion(qc);
      const pivot = this.pos.clone().add(new THREE.Vector3(0, (this.prone ? 0.6 : this.crouch ? 1.05 : 1.62) + by * 0.5, 0));
      for (let k = 0; k < 8 && rockField(pivot.x, pivot.y, pivot.z) > -0.3; k++) pivot.y -= 0.12;
      const dist = THREE.MathUtils.lerp(3.1, 1.35, this.aim);
      const side = THREE.MathUtils.lerp(0.42, 0.6, this.aim);
      const desired = pivot.clone().addScaledVector(right, side).addScaledVector(back, dist).add(new THREE.Vector3(0, 0.15, 0));
      // march from the character toward the desired camera spot and stop before any rock
      // (uses the exact density field the cave was meshed from, plus the boulder/props via BVH)
      let t1 = 1;
      const tmp = new THREE.Vector3();
      for (let i = 1; i <= 24; i++) {
        const t = i / 24;
        tmp.lerpVectors(pivot, desired, t);
        if (rockField(tmp.x, tmp.y, tmp.z) > -0.55) { t1 = (i - 1) / 24; break; }
      }
      const hit = this.physics.raycastSegment(pivot, desired);
      if (hit) t1 = Math.min(t1, Math.max(0, (hit.distance - 0.4) / pivot.distanceTo(desired)));
      const target = pivot.clone().lerp(desired, t1);
      // follow the pivot rigidly; only the boom length is smoothed (shortening is instant)
      this._boom = this._boom === undefined ? t1 : (t1 < this._boom ? t1 : THREE.MathUtils.lerp(this._boom, t1, Math.min(1, dt * 6)));
      this._cam = pivot.clone().lerp(desired, this._boom);
      this.camera.position.copy(this._cam);
      this.avatar.root.visible = this.avatar.root.visible && this._cam.distanceTo(pivot) > 0.55;
      this.camera.quaternion.copy(qc);
      this.camera.fov = THREE.MathUtils.lerp(62, 48, this.aim);
      this.camera.updateProjectionMatrix();
    }
  }
}
