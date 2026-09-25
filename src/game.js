import * as THREE from 'three';
import { loadCharacterAssets, Cyclops, Soldier } from './characters.js';
import { Flock } from './sheep.js';
import { floorHeightAt, LAYOUT, airDist, rockField } from './cave.js';
import { Physics } from './physics.js';
import { Player } from './player.js';
import { Input, isTouchDevice, attachTouchControls } from './input.js';
import { Audio } from './audio.js';
import { Particles, Decals } from './fx.js';
import { Radar, AlertSystem, WeaponWheel, CharacterSwitch } from './tactical.js';
import { StealthMeter, QTE, PhotoMode, Pickups } from './modern.js';

const $ = (id) => document.getElementById(id);
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const flat = (v) => V(v.x, 0, v.z);

// walkable test for the giant and the sheep (inside the cave air, away from walls)
function walkable(x, z, margin = 1.2) {
  return airDist(x, 2.5, z) < -margin;
}

const PHASE_TEXT = {
  intro: ['CHAPTER I  THE CAVE OF THE CYCLOPS', 'Explore the cave you followed the flock into'],
  trapped: ['TRAPPED', 'Do not let the giant see you. Keep to the shadows'],
  night: ['NIGHT', 'Survive until the giant sleeps'],
  sleep: ['THE GIANT SLEEPS', 'Take the olive-wood log and harden its point in the fire'],
  stakeHot: ['THE STAKE GLOWS', 'Drive the burning stake into the sleeping giant\'s eye'],
  blind: ['THE BLIND GIANT', 'Tie straw to your back at a straw pile and get ready to hide among the sheep'],
  gate: ['DAWN', 'Wearing the straw, crouch and crawl out among the sheep'],
  escape: ['ESCAPE', ''],
};

export class Game {
  constructor(o) { Object.assign(this, o); }

  async init() {
    const { scene, world } = this;
    await loadCharacterAssets();
    this.onProgress?.(0.3);
    this.input = new Input(this.renderer.domElement);
    if (isTouchDevice()) attachTouchControls(this.input);
    this.audio = new Audio();
    this.physics = new Physics(world.colliders.filter((c) => c !== world.boulder), [world.boulder]);
    this.particles = new Particles(scene);
    this.decals = new Decals(scene);
    this.player = new Player({ camera: this.camera, scene, physics: this.physics, audio: this.audio, input: this.input });
    this.player.pos.set(3, floorHeightAt(3, 12), 12);
    this.player.yaw = 0.15;
    this.player.onProjectileTest = (a, b, p) => this.projectileHit(a, b, p);
    // Odysseus himself, seen over the shoulder
    this.odysseus = new Soldier(scene, { seed: 42 });
    this.player.setAvatar(this.odysseus);
    this.player.onImpact = (pt) => { this.particles.dust(pt, 4, 0.3); this.particles.sparks(pt, 5); this.makeNoise(pt, 0.35); };
    this.player.onFire = () => this.makeNoise(this.player.pos, 0.35);
    this.onProgress?.(0.5);

    // Polyphemus
    this.cy = new Cyclops(scene, 13);
    this.cy.root.position.set(0, 0, 60);
    this.cy.root.visible = false;
    this.cyState = { mode: 'away', target: null, alert: 0, stun: 0, anger: 0, step: 0, grabbing: null, heading: Math.PI, hp: 100 };
    this.onProgress?.(0.7);

    // companions (12 men followed Odysseus into the cave)
    this.soldiers = [];
    const spots = [[5, 3], [7, 1], [9, 4], [11, 2], [13, 5], [12, 0], [8, 7], [4, 6], [15, 3], [10, 9], [6, 9], [14, 8]];
    spots.forEach(([x, z], i) => {
      const s = new Soldier(scene, { torch: i % 4 === 0, seed: i + 1 });
      s.home = V(x, floorHeightAt(x, z), z);
      s.root.position.copy(s.home);
      s.root.rotation.y = Math.random() * 6.28;
      s.name = ['Eurylochus', 'Polites', 'Perimedes', 'Elpenor', 'Antiphus', 'Cleitus', 'Lycus', 'Dorion', 'Megon', 'Theon', 'Nicon', 'Aristo'][i];
      if (s.torchTip) {
        const l = new THREE.PointLight(0xff8a3a, 20, 12, 1.8); s.torchTip.add(l); s.torchLight = l;
        const fl = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 2.2, 0.5) })); s.torchTip.add(fl);
      }
      this.soldiers.push(s);
    });
    this.onProgress?.(0.85);

    // the flock (the film used 40 sheep)
    this.flock = new Flock(scene, 40, V(12, 0, -7), 5.5);
    this.flock.onBleat = (p) => this.audio.bleat(p);

    // heated stake glow
    this.stakeGlow = new THREE.PointLight(0xff5a10, 0, 5, 2);
    scene.add(this.stakeGlow);
    this.stakeHeat = 0;

    // Metal Gear / GTA systems
    this.VIEW_DOT = 0.2; this.VIEW_RANGE = 34;
    this.noiseRings = [];
    this.isAir = (x, z) => walkable(x, z, 0.3);
    this.radar = new Radar(this);
    this.alertSys = new AlertSystem(this);
    this.wheel = new WeaponWheel(this);
    this.switcher = new CharacterSwitch(this);
    // modern action-adventure layer
    this.meter = new StealthMeter(this);
    this.qte = new QTE(this);
    this.photo = new PhotoMode(this);
    this.pickups = new Pickups(this);
    this.realTasks = [];
    this.player.hp = 100;
    this.setupPickups();
    this.player.onKnock = () => this.knock();
    this.player.onSwitch = () => this.switchCharacter();
    const prevImpact = this.player.onImpact;
    this.player.onImpact = (pt, n, p) => {
      prevImpact(pt, n, p);
      if (p && p.kind === 'stone') { this.makeNoise(pt, 1.3, true); this.audio.impact(pt, 'rock'); }
    };
    this.phase = 'intro'; this.phaseT = 0; this.time = 0;
    this.tasks = [];
    this.eaten = 0;
    this.hud = { obj: $('objective'), sub: $('subtitle'), prompt: $('prompt'), weapon: $('weapon'), status: $('status'), dmg: $('damage'), fade: $('fade'), cross: $('crosshair') };
    const cp = this.params.get('phase');
    if (cp) this.checkpoint = cp;
    this.onProgress?.(1);
    window.__cy = this.cy;
  }

  // ------------------------------------------------------------------ flow helpers
  wait(sec) { return new Promise((r) => this.tasks.push({ t: this.time + sec, r })); }
  until(fn) { return new Promise((r) => this.tasks.push({ fn, r })); }
  say(text, sec = 4, who = '') {
    const s = this.hud.sub;
    s.innerHTML = who ? `<span style="color:#c9a26a;font-style:normal;font-size:16px;letter-spacing:.15em">${who}</span><br>${text}` : text;
    s.style.opacity = 1;
    clearTimeout(this._subT); this._subT = setTimeout(() => (s.style.opacity = 0), sec * 1000);
  }
  objective(key) {
    const [title, text] = PHASE_TEXT[key];
    this.hud.obj.innerHTML = `<small>${title}</small>${text}`;
    this.hud.obj.style.opacity = text ? 1 : 0;
  }
  setPhase(p) { this.phase = p; this.phaseT = 0; if (PHASE_TEXT[p]) this.objective(p); }

  start() {
    this.audio.init();
    this.input.wantLock = true;
    if (!this.input.touch) this.renderer.domElement.requestPointerLock?.()?.catch?.(() => {});
    else document.documentElement.requestFullscreen?.().catch(() => {});
    this.hud.fade.style.opacity = 0;
    this.started = true;
    if (this.checkpoint) this.jumpTo(this.checkpoint); else this.runIntro();
  }

  jumpTo(cp) {
    // debug / retry checkpoints
    if (cp !== 'night') { this.player.pos.set(10, floorHeightAt(10, -2), -2); this.player.yaw = Math.PI * 0.8; }
    else { this.player.pos.set(14, floorHeightAt(14, 7), 7); this.player.yaw = Math.PI * 0.4; }
    this.world.boulder.position.copy(this.world.doorClosed); this.physics.rebuildDynamic();
    this.setDaylight(0);
    this.cy.root.visible = true;
    if (cp === 'night' || cp === 'trapped') { this.placeCy(V(-3, 0, 4)); this.runNight(); }
    else if (cp === 'sleep') { this.placeCy(V(-8, 0, -6)); this.soldiers.slice(0, 2).forEach((s) => this.killSoldier(s)); this.runSleep(); }
    else if (cp === 'blind') { this.soldiers.slice(0, 3).forEach((s) => this.killSoldier(s)); this.cy.setBlind(); this.placeCy(V(-8, 0, -8)); this.runBlind(); }
    else if (cp === 'gate') { this.soldiers.slice(0, 3).forEach((s) => this.killSoldier(s)); this.cy.setBlind(); this.placeCy(V(-2, 0, 3)); this.player.disguised = true; this.runGate(); }
  }

  placeCy(p) { this.cy.root.position.set(p.x, floorHeightAt(p.x, p.z), p.z); }

  setDaylight(k) {
    const W = this.world;
    W.sun.intensity = W.sunBase * k;
    W.shafts[1].material.uniforms.uStrength.value = 0.07 * k;
    W.sky.material.uniforms.uBright.value = Math.max(0.0, k);
  }

  // ------------------------------------------------------------------ story
  async runIntro() {
    this.setPhase('intro');
    this.setDaylight(1);
    this.say('We followed the sheep and found this… There are bags of cheese hanging on the walls', 5, 'Polites');
    await this.wait(6);
    this.say('Food. Take as much as we can carry back to the ships', 4, 'Eurylochus');
    // wait for the player to explore a bit or the timer
    await Promise.race([this.wait(30), this.until(() => this.player.pos.z < 4 || this.player.pos.z > 14)]);
    // the giant returns
    this.audio.stomp(V(0, 0, 45), 1.2); this.player.shake = 0.6;
    this.say('…The ground is shaking', 3, 'Perimedes');
    await this.wait(1.4);
    this.audio.stomp(V(0, 0, 42), 1.4); this.player.shake = 0.8;
    await this.wait(1.4);
    this.cy.root.visible = true;
    this.placeCy(V(3, 0, 40)); this.cyState.heading = Math.PI;
    this.cyState.mode = 'script';
    this.soldiers.forEach((s) => { s.state = 'hide'; });
    this.setTension(0.6);
    this.say('Hide!', 2, 'Odysseus');
    await this.cyWalkTo(V(1.5, 0, 11), 2.2);
    this.cy.play('idle');
    this.audio.roar(this.cy.eyeWorld(), { dur: 3, vol: 0.7, pitch: 0.8 });
    await this.wait(2.5);
    // roll the door-stone across the entrance
    this.cyState.heading = 0;
    await this.wait(0.8);
    await this.closeBoulder();
    this.setPhase('trapped');
    this.say('The entrance… he\'s sealed it with a rock', 4, 'Eurylochus');
    await this.wait(4);
    this.runNight();
  }

  async closeBoulder() {
    const W = this.world, b = W.boulder;
    const from = b.position.clone(), to = W.doorClosed.clone();
    this.cy.ik.R = { target: from.clone().add(V(0, 5, 0)), w: 0 };
    this.cy.ik.L = { target: from.clone().add(V(-2, 5, 0)), w: 0 };
    this.audio.rumble(5, 1.2);
    const dur = 4.5;
    for (let t = 0; t < dur; t += 1 / 30) {
      await this.wait(1 / 30);
      const k = THREE.MathUtils.smoothstep(t / dur, 0, 1);
      b.position.lerpVectors(from, to, k);
      b.rotation.z = -k * 0.6;
      this.cy.ik.R.w = this.cy.ik.L.w = Math.min(1, t * 2) * (1 - Math.max(0, (t - dur + 0.6) / 0.6));
      this.cy.ik.R.target.copy(b.position).add(V(-2.5, 4.5, -2.5));
      this.cy.ik.L.target.copy(b.position).add(V(-4.5, 3.5, -2.5));
      this.setDaylight(1 - k);
      this.player.shake = Math.max(this.player.shake, 0.35);
      if (Math.random() < 0.3) this.particles.dust(b.position.clone().add(V((Math.random() - 0.5) * 8, 0.5, -4)), 3, 2);
    }
    this.cy.ik.R = this.cy.ik.L = null;
    this.setDaylight(0);
    this.audio.stomp(b.position, 1.5); this.player.shake = 1.2;
    this.physics.rebuildDynamic();
  }

  async openBoulder(amount = 0.55) {
    const W = this.world, b = W.boulder;
    const from = b.position.clone(), to = W.doorClosed.clone().lerp(W.doorOpen, amount);
    this.audio.rumble(4, 1);
    for (let t = 0; t < 4; t += 1 / 30) {
      await this.wait(1 / 30);
      const k = THREE.MathUtils.smoothstep(t / 4, 0, 1);
      b.position.lerpVectors(from, to, k);
      this.setDaylight(k * amount * 1.2);
      this.player.shake = Math.max(this.player.shake, 0.25);
    }
    this.physics.rebuildDynamic();
  }

  async runNight() {
    this.setPhase('night');
    this.setTension(0.5);
    this.cyState.mode = 'tend';
    this.cyState.home = V(-3, 0, 1);
    await this.wait(8);
    // first meal: two men
    for (let k = 0; k < 2; k++) {
      await this.cyEat();
      await this.wait(7);
    }
    this.say('That eye… he only has the one. Aim for it', 4, 'Odysseus');
    this.cyState.mode = 'tend';
    await this.wait(28);
    await this.cyEat();
    await this.wait(6);
    this.runSleep();
  }

  async runSleep() {
    this.setPhase('sleep');
    this.cyState.mode = 'script';
    const bed = V(-15, 0, -12);
    if (this.cy.root.position.distanceTo(bed) > 3) await this.cyWalkTo(bed, 2);
    this.audio.roar(this.cy.eyeWorld(), { dur: 2.5, vol: 0.35, pitch: 0.6 });
    await this.lieDown();
    this.cyState.mode = 'sleep';
    this.setTension(0.25);
    this.say('He\'s asleep… it\'s now or never', 3, 'Eurylochus');
    this.world.interact.find((i) => i.id === 'log').enabled = true;
  }

  async lieDown() {
    const r = this.cy.root, start = r.position.clone(), rot0 = r.rotation.clone();
    this.cy.play('idle', 1, 0.25);
    this.cy.eyeOpen = 1;
    // lie on his back with the head toward the middle of the cave (reachable with the stake)
    const toC = V(-start.x, 0, -start.z).normalize();
    const yaw = Math.atan2(-toC.x, -toC.z);
    r.rotation.order = 'YXZ';
    for (let t = 0; t < 3; t += 1 / 30) {
      await this.wait(1 / 30);
      const k = THREE.MathUtils.smoothstep(t / 3, 0, 1);
      r.rotation.set(-Math.PI / 2 * k, rot0.y + (yaw - rot0.y) * Math.min(1, k * 2), 0);
      r.position.set(start.x, start.y + 0.9 * k, start.z);
      this.cy.eyeOpen = 1 - k;
      if (t > 2.6 && !this._laid) { this._laid = true; this.audio.stomp(start, 1.6); this.player.shake = 1; this.particles.dust(start, 40, 6); }
    }
    this.cy.eyeOpen = 0;
    this.cyState.lying = true;
  }

  async standUp() {
    const r = this.cy.root, start = r.position.clone(), rot0 = r.rotation.clone();
    for (let t = 0; t < 2.5; t += 1 / 30) {
      await this.wait(1 / 30);
      const k = THREE.MathUtils.smoothstep(t / 2.5, 0, 1);
      r.rotation.set(rot0.x * (1 - k), rot0.y, 0);
      r.position.y = start.y - 0.9 * k;
    }
    r.rotation.x = 0;
    this.cyState.lying = false;
  }

  async blindCyclops() {
    // the stake goes in: flash, shriek, blood, the giant rises blind
    this.cyState.mode = 'script';
    this.player.locked = true;
    const eye = this.cy.eyeWorld();
    this.particles.blood(eye, V(0, 1, 0), 220, 6);
    this.particles.sparks(eye, 60);
    this.decals.add(V(eye.x, floorHeightAt(eye.x, eye.z), eye.z), 3);
    this.post.grade.uniforms.get('uFlash').value = 0.35;
    this.audio.sizzle(true); setTimeout(() => this.audio.sizzle(false), 1500);
    this.audio.roar(eye, { dur: 4.5, vol: 1.6, pitch: 1.1, pain: true });
    this.player.shake = 2.2;
    this.player.setCarry(null);
    this.stakeGlow.intensity = 0;
    this.cy.setBlind();
    this.cy.eyeOpen = 0;
    await this.wait(1.2);
    this.player.locked = false;
    this.player.vel.set(0, 3, 0).addScaledVector(flat(this.player.pos.clone().sub(eye)).normalize(), 6);
    await this.standUp();
    this.audio.roar(this.cy.eyeWorld(), { dur: 3.5, vol: 1.3, pitch: 1.0, pain: true });
    this.player.shake = 1.5;
    this.runBlind();
  }

  async runBlind() {
    this.setPhase('blind');
    this.setTension(0.85);
    this.cyState.mode = 'blind';
    this.cyState.lying = false;
    this.say('It\'s done! Now he\'ll guard the door… our only way out is with the sheep', 5, 'Odysseus');
    this.world.interact.filter((i) => i.id === 'straw').forEach((i) => (i.enabled = true));
    await Promise.race([this.wait(55), this.until(() => this.player.disguised && this.phaseT > 12)]);
    this.runGate();
  }

  async runGate() {
    this.setPhase('gate');
    this.cyState.mode = 'script';
    this.setTension(0.7);
    const gate = V(LAYOUT.tunnelZ0 * 0 + 1.2, 0, 13);
    await this.cyWalkTo(gate.clone().add(V(0, 0, -1)), 2.4);
    this.cyState.heading = 0;
    await this.wait(0.6);
    await this.openBoulder(0.6);
    // he sits down in the gap, facing inward, hands on the ground to feel each sheep
    this.cyState.heading = Math.PI;
    this.cyState.mode = 'gate';
    this.cy.play('idle', 0.6, 0.6);
    this.flock.mode = 'exit';
    this.flock.released = 0;
    const doorX = this.world.boulder.position.x;
    this.flock.exitPoint = V(this.cy.root.position.x - 2.5, 0, this.cy.root.position.z + 1);
    this.flock.exitPoint2 = V(this.cy.root.position.x - 2.5, 0, 40);
    this.say('He\'s feeling every sheep as it passes… straw on your back. Go on all fours', 5, 'Eurylochus');
    // release sheep gradually; companions crawl with them
    this.soldiers.filter((s) => s.alive).forEach((s, i) => { s.state = 'crawlOut'; s.crawlDelay = 6 + i * 5; });
    for (let i = 0; i < 40; i++) {
      this.flock.released = i + 1;
      await this.wait(1.6);
      if (this.phase !== 'gate') return;
    }
  }

  async runEscape() {
    this.setPhase('escape');
    this.player.locked = true;
    this.cyState.mode = 'script';
    this.setTension(1);
    const survivors = this.soldiers.filter((s) => s.alive).length;
    this.hud.fade.style.transition = 'opacity 1.5s'; this.hud.fade.style.background = '#cfe6ea'; this.hud.fade.style.opacity = 1;
    await this.wait(1.6);
    // outside, looking back at the cave mouth
    this.setDaylight(1.4);
    this.world.sky.material.uniforms.uBright.value = 0.28;
    this.scene.fog.density = 0.006; this.scene.fog.color.set(0x3d5358);
    this.world.hemi.intensity = 1.2; this.world.hemi.color.set(0x9ec4d0); this.world.hemi.groundColor.set(0x3a3322);
    this.player.pos.set(this.world.doorClosed.x - 6, 1, 64);
    this.player.yaw = 0.12; this.player.pitch = 0.2;
    this.placeCy(V(this.world.doorClosed.x - 3, 0, 41)); this.cy.root.position.y = 0.9; this.cy.root.rotation.set(0, 0, 0); this.cyState.heading = 0;
    this.cy.play('sad_pose', 0.1);
    this.hud.fade.style.opacity = 0;
    await this.wait(2);
    this.audio.roar(this.cy.eyeWorld(), { dur: 3, vol: 0.9, pitch: 0.7 });
    this.say('Father Poseidon, they blinded me…', 4.5, 'Polyphemus');
    await this.wait(4.8);
    this.say('Vengeance, father… vengeance for me…', 4.5, 'Polyphemus');
    await this.wait(4.8);
    this.say('It can talk. Why didn\'t it talk before?', 3.2, 'Polites');
    await this.wait(3.4);
    this.say('Do you talk to ants?', 3.5, 'Odysseus');
    await this.wait(4);
    this.endScreen(true, survivors);
  }

  endScreen(win, survivors = 0, reason = '') {
    if (this.ended) return;
    this.ended = true;
    document.exitPointerLock?.();
    const el = document.createElement('div'); el.className = 'end ' + (win ? 'passed' : 'wasted');
    el.innerHTML = win
      ? `<div class="banner">MISSION PASSED</div><h1>ESCAPED</h1><p>Men who survived: ${survivors} / 12  (devoured: ${12 - survivors})</p><p style="font-size:14px;color:#8a7b66">With the giant\'s curse at his back, Odysseus ran for the ships.</p><button onclick="location.href=location.pathname">PLAY AGAIN</button>`
      : `<div class="banner">WASTED</div><h1>DEVOURED</h1><p>${reason}</p><button id="retry">FROM CHECKPOINT</button> <button onclick="location.href=location.pathname">FROM THE START</button>`;
    document.body.appendChild(el);
    const r = el.querySelector('#retry');
    if (r) r.onclick = () => (location.href = `${location.pathname}?phase=${this.checkpointFor()}`);
  }
  checkpointFor() { return { intro: 'night', trapped: 'night', night: 'night', sleep: 'sleep', stakeHot: 'sleep', blind: 'blind', gate: 'gate' }[this.phase] || 'night'; }

  setTension(x) { this.tension = x; this.audio.setTension(x); }

  // ------------------------------------------------------------------ cyclops behaviour
  async cyWalkTo(p, speed = 2.2) {
    const st = this.cyState;
    st.walkTarget = V(p.x, 0, p.z); st.walkSpeed = speed;
    await this.until(() => !st.walkTarget);
  }

  cyMove(dt) {
    const st = this.cyState, r = this.cy.root;
    if (st.walkTarget) {
      const d = flat(st.walkTarget).sub(flat(r.position));
      const dist = d.length();
      if (dist < 0.6) { st.walkTarget = null; this.cy.play('idle'); return; }
      st.heading = Math.atan2(d.x, d.z);
      const sp = Math.min(st.walkSpeed, dist * 1.5);
      const nx = r.position.x + (d.x / dist) * sp * dt, nz = r.position.z + (d.z / dist) * sp * dt;
      if (st.noClip || walkable(nx, nz, 1.2) || nz > 12) { r.position.x = nx; r.position.z = nz; }
      else if (walkable(nx, r.position.z, 1.2)) r.position.x = nx;
      else if (walkable(r.position.x, nz, 1.2)) r.position.z = nz;
      else { st.walkTarget = null; this.cy.play('idle'); }
      r.position.y = floorHeightAt(r.position.x, r.position.z);
      this.cy.play(st.walkSpeed > 3 ? 'run' : 'walk', 0.5, st.walkSpeed > 3 ? 0.35 : 0.42);
      st.step += dt * sp;
      if (st.step > 3.2) { st.step = 0; this.stomp(); }
    }
    // turn toward heading
    let dh = st.heading - r.rotation.y; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    if (!st.lying) r.rotation.y += dh * Math.min(1, dt * 2);
  }

  stomp() {
    const p = this.cy.root.position;
    this.audio.stomp(p, 1);
    const d = p.distanceTo(this.player.pos);
    this.player.shake = Math.max(this.player.shake, Math.min(1.1, 9 / (d + 3)));
    if (d < 18) this.haptic(Math.round(60 * (1 - d / 18)) + 10);
    this.particles.dust(p.clone().add(V((Math.random() - 0.5) * 3, 0.2, (Math.random() - 0.5) * 3)), 6, 2.5);
  }

  // reach for a target (soldier or player). resolves true if caught.
  async cyGrab(getTarget, windup = 1.4) {
    const st = this.cyState;
    const hand = this.cy.bones.RightHand;
    const ik = (this.cy.ik.R = { target: getTarget().clone(), w: 0 });
    st.grabbing = true;
    this.audio.roar(this.cy.eyeWorld(), { dur: 1.2, vol: 0.4, pitch: 1.2 });
    let caught = false;
    for (let t = 0; t < windup; t += 1 / 30) {
      await this.wait(1 / 30);
      if (st.stun > 0) { this.cy.ik.R = null; st.grabbing = false; return false; }
      ik.target.lerp(getTarget(), 0.25);
      ik.w = Math.min(1, t / windup * 1.3);
    }
    const hp = hand.getWorldPosition(V(0, 0, 0));
    caught = flat(hp).distanceTo(flat(getTarget())) < 3.0 || flat(this.cy.root.position).distanceTo(flat(getTarget())) < 8.5;
    st.grabbing = false;
    return caught;
  }

  async cyEat() {
    const alive = this.soldiers.filter((s) => s.alive && s.state !== 'grabbed');
    if (!alive.length) return;
    // pick the closest man
    const cp = this.cy.root.position;
    alive.sort((a, b) => a.root.position.distanceTo(cp) - b.root.position.distanceTo(cp));
    const victim = alive[0];
    victim.state = 'frozen';
    this.cyState.mode = 'script';
    const vp = victim.root.position;
    const stand = vp.clone().add(flat(cp).sub(flat(vp)).normalize().multiplyScalar(4.5));
    this.cyState.noClip = true;
    await this.cyWalkTo(stand, 2.3);
    this.cyState.noClip = false;
    if (this.cyState.stun > 0) { this.cyState.mode = 'tend'; return; }
    this.cyState.heading = Math.atan2(victim.root.position.x - cp.x, victim.root.position.z - cp.z);
    victim.state = 'frozen';
    this.audio.scream(victim.root.position);
    const caught = await this.cyGrab(() => victim.root.position.clone().add(V(0, 1, 0)), 1.2);
    if (!caught || this.cyState.stun > 0 || !victim.alive) { this.cy.ik.R = null; victim.state = 'hide'; this.cyState.mode = 'tend'; return; }
    victim.state = 'grabbed';
    this.say(`${victim.name}！`, 2, '');
    // lift to the mouth
    const hand = this.cy.bones.RightHand;
    for (let t = 0; t < 2.2; t += 1 / 30) {
      await this.wait(1 / 30);
      const mouth = this.cy.mouthWorld();
      const k = THREE.MathUtils.smoothstep(t / 2.2, 0, 1);
      this.cy.ik.R.target.lerpVectors(this.cy.ik.R.target, mouth.clone().add(V(0, -1.2, 0.5)), 0.08 + k * 0.1);
      this.cy.ik.R.w = 1;
      hand.getWorldPosition(victim.root.position); victim.root.position.y -= 1.0;
      victim.root.rotation.z = Math.sin(t * 20) * 0.3;
      if (this.cyState.stun > 0) { // dropped!
        victim.state = 'hide'; victim.root.rotation.z = 0; victim.root.position.y = floorHeightAt(victim.root.position.x, victim.root.position.z);
        this.cy.ik.R = null; this.say(`He dropped ${victim.name}! Run!`, 3); this.cyState.mode = 'tend'; return;
      }
    }
    const mouth = this.cy.mouthWorld();
    this.audio.crunch(mouth);
    this.particles.blood(mouth, V(0, -1, 0), 160, 3);
    this.decals.add(V(mouth.x, floorHeightAt(mouth.x, mouth.z), mouth.z), 2.2);
    this.killSoldier(victim);
    await this.wait(1.5);
    this.cy.ik.R = null;
    this.cyState.mode = 'tend';
  }

  killSoldier(s) {
    s.alive = false; s.state = 'dead'; s.root.visible = false;
    if (s.torchLight) s.torchLight.intensity = 0;
    this.eaten++;
  }

  // light level at a point (for being seen by the giant)
  lightAt(p) {
    let l = 0;
    const df = p.distanceTo(this.world.firePos);
    l += 3 / (1 + df * df * 0.05);
    for (const s of this.soldiers) if (s.alive && s.torchLight) { const d = p.distanceTo(s.root.position); l += 1 / (1 + d * d * 0.2); }
    for (const t of this.world.torches) { const d = p.distanceTo(t.group.position); l += 0.8 / (1 + d * d * 0.2); }
    l += this.world.sun.intensity > 0 && p.z > 6 ? 1 : 0;
    return l;
  }

  makeNoise(p, loud, ring = false) {
    const st = this.cyState;
    if (ring) this.noiseRings.push({ p: p.clone(), t: 1 });
    if (!this.cy.root.visible) return;
    const d = p.distanceTo(this.cy.root.position);
    const heard = loud * 30 / (d + 5);
    if (st.mode === 'sleep') {
      if (heard > 1.6) this.wakeUp();
      return;
    }
    if (st.mode === 'blind' || st.mode === 'tend') {
      if (heard > 0.35) { st.noiseAt = p.clone(); st.alert = Math.min(1.5, st.alert + heard * 0.5); }
    }
  }

  async wakeUp() {
    if (this.cyState.mode !== 'sleep') return;
    this.cyState.mode = 'script';
    this.say('No, he\'s waking up!', 3);
    this.cy.eyeOpen = 1;
    await this.standUp();
    this.audio.roar(this.cy.eyeWorld(), { dur: 2.5, vol: 1 });
    this.cyState.mode = 'tend'; this.cyState.alert = 1.2; this.cyState.noiseAt = this.player.pos.clone();
    this.setTension(0.8);
    await this.wait(30);
    if (this.phase === 'sleep' || this.phase === 'stakeHot') {
      this.cyState.mode = 'script';
      const bed = V(-15, 0, -12);
      await this.cyWalkTo(bed, 2);
      this._laid = false;
      await this.lieDown();
      this.cyState.mode = 'sleep';
      this.setTension(0.25);
    }
  }

  cyThink(dt) {
    const st = this.cyState, P = this.player, cy = this.cy;
    if (st.stun > 0) {
      st.stun -= dt;
      cy.play('idle', 0.3, 2.2);
      cy.eyeOpen = 0;
      if (st.stun <= 0) { cy.eyeOpen = 1; st.alert = 1.2; st.noiseAt = P.pos.clone(); }
      return;
    }
    const cp = cy.root.position;
    const dP = flat(P.pos).distanceTo(flat(cp));
    if (st.mode === 'tend' || st.mode === 'blind') {
      // perception
      if (st.mode === 'tend' && !P.dead) {
        const eye = cy.eyeWorld();
        const toP = P.pos.clone().add(V(0, 1, 0)).sub(eye); const dist = toP.length(); toP.normalize();
        const fwd = V(Math.sin(cy.root.rotation.y), 0, Math.cos(cy.root.rotation.y));
        const inView = toP.dot(fwd) > this.VIEW_DOT && dist < this.VIEW_RANGE;
        const lit = this.lightAt(P.pos);
        // Metal Gear-like detection: distance, light, stance and movement all matter
        const vis = inView && !P.hiddenInStraw ? Math.min(2, lit * 1.2 + 0.25) * (P.prone ? 0.22 : P.crouch ? 0.55 : 1) * (P.moving > 0.5 ? 1.3 : 0.8) * Math.max(0, 1 - dist / this.VIEW_RANGE) * 1.6 : 0;
        if (vis > 0 && !this.physics.raycastSegment(eye, P.pos.clone().add(V(0, 1.2, 0)))) { st.alert += vis * dt; st.noiseAt = P.pos.clone(); }
        this.makeNoise(P.pos, P.noise * dt * 8);
      }
      if (st.mode === 'blind') this.makeNoise(P.pos, P.noise * dt * 10);
      st.alert = Math.max(0, st.alert - dt * 0.08);
      if (st.alert > 1 && st.noiseAt && st.noiseAt.distanceTo(P.pos) < 3) this.alertSys.spotted();
      else if (st.alert > 0.35) this.alertSys.suspicious();
      if (st.alert > 1 && st.noiseAt && !st.grabbing) {
        // hunt the source
        const target = st.noiseAt;
        const dT = flat(target).distanceTo(flat(cp));
        if (dT > 5.5) {
          st.walkTarget = V(target.x, 0, target.z); st.walkSpeed = st.mode === 'blind' ? 3.2 : 2.8;
        } else {
          st.walkTarget = null;
          st.heading = Math.atan2(target.x - cp.x, target.z - cp.z);
          if (dP < 7.5 && !st.grabbing && !P.dead) this.tryGrabPlayer();
          else { st.alert = 0.6; if (st.mode === 'blind') this.sweepArms(); }
        }
      } else if (!st.walkTarget && !st.grabbing) {
        // idle behaviour: tend the fire / wander (blind: grope around)
        st.idleT = (st.idleT || 0) - dt;
        if (st.idleT < 0) {
          st.idleT = 6 + Math.random() * 8;
          const home = st.home || V(-3, 0, 1);
          const a = Math.random() * 6.28, r = 3 + Math.random() * 7;
          const x = home.x + Math.cos(a) * r, z = home.z + Math.sin(a) * r;
          if (walkable(x, z, 2)) { st.walkTarget = V(x, 0, z); st.walkSpeed = st.mode === 'blind' ? 1.6 : 1.5; }
        }
        if (st.mode === 'blind' && Math.random() < dt * 0.15) this.audio.roar(cy.eyeWorld(), { dur: 2, vol: 0.6, pitch: 0.9, pain: true });
      }
    }
    // heartbeat when he's close/alerted
    const danger = THREE.MathUtils.clamp((st.alert || 0) * 0.6 + (18 - dP) / 18, 0, 1);
    this.audio.heartbeat(danger > 0.45 && st.mode !== 'sleep' ? 60 + danger * 70 : 0);
    this.hud.dmg.style.opacity = Math.max(0, danger - 0.5) * 0.8;
  }

  async sweepArms() {
    if (this._sweeping) return; this._sweeping = true;
    const cp = this.cy.root.position;
    const ang = this.cy.root.rotation.y;
    for (let t = 0; t < 1.6; t += 1 / 30) {
      await this.wait(1 / 30);
      const a = ang + Math.sin(t * 3) * 0.9;
      this.cy.ik.R = { target: V(cp.x + Math.sin(a) * 6, 1.2, cp.z + Math.cos(a) * 6), w: Math.sin(t / 1.6 * Math.PI) };
      const hp = this.cy.bones.RightHand.getWorldPosition(V(0, 0, 0));
      if (!this.player.dead && flat(hp).distanceTo(flat(this.player.pos)) < 1.8 && hp.y < 3) { this.caughtPlayer('A blind, groping hand found you.'); break; }
    }
    this.cy.ik.R = null; this._sweeping = false;
  }

  async tryGrabPlayer() {
    const st = this.cyState;
    if (st.grabbing) return;
    this.say('He\'s coming! Aim for the eye!', 1.5);
    const caught = await this.cyGrab(() => this.player.pos.clone().add(V(0, 1.2, 0)), st.mode === 'blind' ? 1.0 : 1.5);
    if (caught && !this.player.dead) this.caughtPlayer(st.mode === 'blind' ? 'The blind giant\'s hand felt you out.' : 'The giant\'s hand closed around you.');
    else { this.cy.ik.R = null; st.alert = 0.7; }
  }

  async caughtPlayer(reason) {
    const P = this.player;
    if (P.dead || P.grabbed || this.params.has('god')) return;
    P.grabbed = true; P.locked = true;
    this.audio.roar(this.cy.eyeWorld(), { dur: 1.5, vol: 1 });
    this.haptic([80, 40, 80]);
    const hand = this.cy.bones.RightHand;
    this.hud.dmg.style.opacity = 1;
    // lifted toward the mouth while you struggle (God of War style mash)
    let lifting = true;
    (async () => {
      while (lifting) {
        await this.wait(1 / 30);
        const mouth = this.cy.mouthWorld();
        this.cy.ik.R = { target: mouth.clone().add(V(0, -2.2, 0.8)), w: 1 };
        hand.getWorldPosition(P.pos); P.pos.y -= 1.4;
        const look = mouth.clone().sub(this.camera.position);
        P.yaw = Math.atan2(-look.x, -look.z); P.pitch = Math.atan2(look.y, Math.hypot(look.x, look.z));
        P.shake = Math.max(P.shake, 0.6);
      }
    })();
    this.slowPunch = 2.6;
    const escaped = P.hp > 40 && await this.qte.mash({ label: 'BREAK FREE', count: this.input.touch ? 9 : 12, time: 2.4 });
    lifting = false; this.slowPunch = 0;
    if (escaped) {
      // he drops you: you take a hard fall but live
      P.hp -= 40;
      this.cy.ik.R = null;
      this.cyState.stun = 2.5; this.cyState.alert = 0.8;
      this.audio.roar(this.cy.eyeWorld(), { dur: 1.2, vol: 0.9, pain: true });
      const away = flat(P.pos).sub(flat(this.cy.root.position)).normalize();
      P.pos.copy(this.cy.root.position).addScaledVector(away, 5); P.pos.y = floorHeightAt(P.pos.x, P.pos.z) + 2.5;
      P.vel.set(away.x * 3, 0, away.z * 3);
      P.lastSafe = null;
      this.popText('BROKE FREE');
      this.haptic(150);
      this.hud.dmg.style.opacity = 0.4;
      P.grabbed = false; P.locked = false;
      this._gateGrab = false;
      return;
    }
    P.dead = true;
    this.audio.crunch(this.camera.position);
    this.haptic(500);
    this.post.grade.uniforms.get('uFlash').value = 0;
    this.hud.fade.style.transition = 'opacity 0.3s'; this.hud.fade.style.background = '#300'; this.hud.fade.style.opacity = 1;
    await this.wait(1);
    this.endScreen(false, 0, reason);
  }

  // projectile vs cyclops / soldiers
  projectileHit(a, b, p) {
    if (!this.cy.root.visible) return false;
    const seg = new THREE.Line3(a, b), cp = V(0, 0, 0);
    let best = null;
    for (const z of this.cy.zones) {
      seg.closestPointToPoint(z.world, true, cp);
      const d = cp.distanceTo(z.world);
      if (d < z.r && (!best || (z.name === 'eye') || d / z.r < best.k)) { best = { z, k: d / z.r, at: cp.clone() }; if (z.name === 'eye') break; }
    }
    if (!best) return false;
    const st = this.cyState;
    const dir = b.clone().sub(a).normalize();
    if (best.z.name === 'eye' && !this.cy.blind) {
      this.audio.impact(best.at, 'flesh');
      this.audio.roar(best.at, { dur: 2.2, vol: 1.3, pain: true, pitch: 1.2 });
      this.particles.blood(best.at, dir.clone().negate(), 80, 3);
      st.stun = p.kind === 'spear' ? 6 : 4.5;
      this.cy.ik.R = null;
      this.player.shake = 0.8;
      this.say('Hit the eye! Get away while you can', 2.5);
      this.hitMarker(true);
      if (st.mode === 'sleep') this.wakeUp();
    } else {
      this.audio.impact(best.at, 'flesh');
      this.particles.blood(best.at, dir.clone().negate(), 25, 2);
      this.hitMarker(false);
      // arrows stick in the giant
      const m = p.mesh.clone(); m.position.copy(best.at); m.lookAt(best.at.clone().add(dir));
      best.z.obj.attach(m);
      st.alert = Math.min(2, st.alert + 0.8); st.noiseAt = this.player.pos.clone();
      if (Math.random() < 0.5) this.audio.roar(best.at, { dur: 1.2, vol: 0.6, pitch: 1.1 });
      if (st.mode === 'sleep') this.wakeUp();
    }
    return true;
  }

  // ------------------------------------------------------------------ interactions
  interactions() {
    const P = this.player, I = this.input;
    let prompt = '';
    const W = this.world;
    const holdE = I.down('KeyE');
    // pick up spent arrows/spears
    if (P.nearPickup()) { prompt = '[E] Pick up arrow / spear'; if (I.pressed('KeyE')) P.tryPickup(); }
    { const it = this.pickups.nearest(P.pos); if (it) { prompt = this.pickups.prompt(it); if (I.pressed('KeyE')) this.pickups.take(it); } }
    const pp = P.pos;
    const log = W.interact.find((i) => i.id === 'log');
    if (log.enabled && !P.carrying && log.obj.visible && pp.distanceTo(log.obj.position) < 4) {
      prompt = '[E] Shoulder the olive-wood log';
      if (I.pressed('KeyE')) { P.setCarry(log.obj); log.obj.visible = false; this.say('Heavy… but sharpened and hardened in the fire…', 3, 'Odysseus'); }
    }
    if (P.carrying && this.stakeHeat < 1 && pp.distanceTo(W.firePos) < 3.2) {
      prompt = `[Hold E] Harden the stake\'s point in the fire<div class="bar"><div style="width:${Math.round(this.stakeHeat * 100)}%"></div></div>`;
      if (holdE) {
        this.stakeHeat = Math.min(1, this.stakeHeat + this.dt / 4.5);
        this.audio.sizzle(true);
        if (Math.random() < 0.3) this.particles.sparks(W.firePos.clone().add(V(0, 0.6, 0)), 2);
        if (this.stakeHeat >= 1) { this.audio.sizzle(false); this.setPhase('stakeHot'); this.say('The tip is glowing red. Now', 3, 'Odysseus'); }
      } else this.audio.sizzle(false);
    }
    if (P.carrying && this.carryMeshGlow !== this.stakeHeat) {
      this.carryMeshGlow = this.stakeHeat;
      P.carryMesh?.traverse((o) => { if (o.isMesh) { o.material.emissive = new THREE.Color(0xff3a00); o.material.emissiveIntensity = this.stakeHeat * 1.5; } });
    }
    if (P.carrying && this.stakeHeat > 0) {
      this.camera.localToWorld(this.stakeGlow.position.set(0.3, -0.3, -2.4));
      this.stakeGlow.intensity = 6 * this.stakeHeat * (0.8 + Math.random() * 0.2);
    }
    if (P.carrying && this.stakeHeat >= 1 && this.cyState.mode === 'sleep') {
      const eye = this.cy.eyeWorld();
      if (flat(pp).distanceTo(flat(eye)) < 3.2) {
        prompt = '[E] Drive the burning stake into his eye';
        if (I.pressed('KeyE')) this.strikeEye();
      }
    }
    // straw disguise
    for (const s of W.interact.filter((i) => i.id === 'straw')) {
      if (s.enabled && !P.disguised && pp.distanceTo(s.pos) < 2.8) {
        prompt = '[E] Tie straw to your back (disguise as a sheep)';
        if (I.pressed('KeyE')) { P.disguised = true; this.say('Straw tied on. Crouched, I should pass for a sheep… I hope', 3.5, 'Odysseus'); }
      }
    }
    this.hud.prompt.innerHTML = this.qte.el.classList.contains('on') ? '' : prompt;
  }

  // ------------------------------------------------------------------ soldiers
  updateSoldiers(dt, t) {
    const cp = this.cy.root.position;
    for (const s of this.soldiers) {
      if (!s.alive) continue;
      s.mixer.update(dt);
      if (s.state === 'grabbed') continue;
      const r = s.root;
      let target = null, speed = 1.2, anim = 'idle';
      if (s.state === 'frozen') { anim = 'sneak_pose'; const d = flat(cp).sub(flat(r.position)); r.rotation.y = Math.atan2(d.x, d.z); }
      else if (s.state === 'hide' || s.state === 'panic') {
        // keep away from the giant, press against the east wall
        const away = flat(r.position).sub(flat(cp)); const d = away.length();
        if (this.cy.root.visible && d < 11) { target = r.position.clone().add(away.normalize().multiplyScalar(3)); speed = s.state === 'panic' ? 4.5 : 3.5; anim = 'run'; }
        else if (r.position.distanceTo(s.home) > 1) { target = s.home; speed = 1.4; anim = 'walk'; }
        else anim = this.cy.root.visible ? 'sneak_pose' : 'idle';
      } else if (s.state === 'crawlOut') {
        s.crawlDelay -= dt;
        anim = 'sneak_pose';
        if (s.crawlDelay < 0) { target = this.flock.exitPoint ? this.flock.exitPoint.clone() : null; speed = 1.1; anim = 'walk'; }
        if (r.position.z > this.world.doorClosed.z + 3) { r.visible = false; s.escaped = true; continue; }
      } else if (this.phase === 'intro') {
        // wander around the cheese
        s.wT = (s.wT || Math.random() * 5) - dt;
        if (s.wT < 0) { s.wT = 4 + Math.random() * 6; s.goal = s.home.clone().add(V((Math.random() - 0.5) * 4, 0, (Math.random() - 0.5) * 4)); }
        if (s.goal && r.position.distanceTo(s.goal) > 0.5) { target = s.goal; speed = 1.1; anim = 'walk'; }
      }
      if (target) {
        const d = flat(target).sub(flat(r.position)); const dist = d.length();
        if (dist > 0.3) {
          d.normalize();
          const nx = r.position.x + d.x * speed * dt, nz = r.position.z + d.z * speed * dt;
          const ox = r.position.x, oz = r.position.z;
          const ok = (x, z) => s.state === 'crawlOut' || walkable(x, z, 0.15) || !walkable(ox, oz, 0.15);
          if (ok(nx, nz)) { r.position.x = nx; r.position.z = nz; }
          else if (ok(nx, oz)) r.position.x = nx;         // slide along the wall
          else if (ok(ox, nz)) r.position.z = nz;
          r.position.y = floorHeightAt(r.position.x, r.position.z);
          // stuck detection: if he barely moved for a while, give up on this target
          const moved = Math.hypot(r.position.x - ox, r.position.z - oz);
          s.stuckT = moved < speed * dt * 0.3 ? (s.stuckT || 0) + dt : 0;
          if (s.stuckT > 0.6) { s.stuckT = 0; s.goal = null; s.home = r.position.clone(); anim = s.state === 'crawlOut' ? 'sneak_pose' : 'idle'; }
          const h = Math.atan2(d.x, d.z); let dh = h - r.rotation.y; dh = Math.atan2(Math.sin(dh), Math.cos(dh)); r.rotation.y += dh * Math.min(1, dt * 6);
        }
      }
      const sp = Math.hypot(r.position.x - (s._px ?? r.position.x), r.position.z - (s._pz ?? r.position.z)) / Math.max(dt, 1e-4);
      s._px = r.position.x; s._pz = r.position.z;
      if ((anim === 'walk' || anim === 'run') && sp < 0.15) anim = s.state === 'crawlOut' ? 'sneak_pose' : 'idle';
      s.play(anim, 0.3, anim === 'walk' ? Math.max(0.5, sp / 1.3) : anim === 'run' ? Math.max(0.6, sp / 4) : 1);
      if (s.state === 'crawlOut') { r.scale.y = r.scale.x * 0.6; } // hunched under straw
      if (s.torchLight) s.torchLight.intensity = 16 + Math.sin(t * 17 + s.home.x) * 3;
    }
  }

  // ------------------------------------------------------------------ gate check
  gateCheck() {
    const P = this.player, cp = this.cy.root.position;
    if (this.phase !== 'gate' || P.dead) return;
    const d = flat(P.pos).distanceTo(flat(cp));
    const nearSheep = this.flock.nearest(P.pos, 3.5);
    if (d < 6.5) {
      const ok = P.disguised && P.crouch && P.noise < 0.3 && nearSheep;
      if (!ok && !this._gateGrab) {
        this._gateGrab = true;
        this.caughtPlayer(!P.disguised ? 'His fingers knew you were no sheep.' : !P.crouch ? 'Standing upright, you looked nothing like a sheep.' : 'You strayed too far from the flock.');
      } else if (ok && Math.random() < this.dt * 0.8) {
        // his hand pats your back… hold still
        this.cy.ik.L = { target: P.pos.clone().add(V(0, 1.0, 0)), w: 0.8 };
        this.player.shake = 0.3;
        setTimeout(() => (this.cy.ik.L = null), 900);
      }
    }
    if (P.pos.z > this.world.doorClosed.z + 4.5 && !this.escaping) { this.escaping = true; this.runEscape(); }
  }

  // ------------------------------------------------------------------ real-time helpers (unaffected by slow motion)
  realFrame() { return new Promise((r) => this.realTasks.push({ frame: true, r })); }
  realWait(sec) { return new Promise((r) => this.realTasks.push({ t: (this.realTime || 0) + sec, r })); }
  haptic(ms) { try { navigator.vibrate?.(ms); } catch (e) {} }

  setupPickups() {
    const W = this.world, S = this.scene;
    for (const w of W.cheeseWheels || []) this.pickups.add(w, 'cheese', 35);
    // a dropped quiver and a pile of throwing stones
    const quiver = new THREE.Group();
    const qm = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.55, 12), new THREE.MeshStandardMaterial({ color: 0x4a3222, roughness: 0.8 }));
    qm.rotation.z = 1.35; qm.castShadow = true; quiver.add(qm);
    quiver.position.set(-9, floorHeightAt(-9, 7) + 0.08, 7); S.add(quiver);
    this.pickups.add(quiver, 'arrows', 6);
    const pile = new THREE.Group();
    for (let i = 0; i < 7; i++) { const m = new THREE.Mesh(new THREE.DodecahedronGeometry(0.07 + Math.random() * 0.04, 0), new THREE.MeshStandardMaterial({ color: 0x8a8070, roughness: 0.95 })); m.position.set((Math.random() - 0.5) * 0.4, 0.05, (Math.random() - 0.5) * 0.4); m.castShadow = true; pile.add(m); }
    pile.position.set(4, floorHeightAt(4, -8) + 0.02, -8); S.add(pile);
    this.pickups.add(pile, 'stones', 4);
  }

  // God of War style timing strike to blind the giant
  async strikeEye() {
    if (this._striking) return; this._striking = true;
    const P = this.player;
    P.locked = true;
    this.slowPunch = 2.2; // world in slow motion while you line up the blow
    const eye = this.cy.eyeWorld();
    const side = V(-Math.sin(P.yaw), 0, -Math.cos(P.yaw));
    this.camOverride = eye.clone().addScaledVector(side, -3.2).add(V(0.8, 1.6, 0)); this.camTarget = eye.clone();
    this.say('Wait for the moment…', 1.5, 'Odysseus');
    const ok = await this.qte.timing({ label: 'DRIVE THE STAKE', dur: 1.7 });
    this.slowPunch = 0; this.camOverride = null; this.camTarget = null; P.locked = false; this._striking = false;
    if (ok) { this.haptic([60, 40, 120]); this.blindCyclops(); }
    else { this.say('Too early — he stirs!', 2); this.haptic(200); this.wakeUp(); }
  }

  // ------------------------------------------------------------------ Metal Gear: knock on the wall to lure the giant
  knock() {
    const P = this.player;
    const dir = V(-Math.sin(P.yaw), 0, -Math.cos(P.yaw));
    let wall = null;
    for (const a of [0, 0.6, -0.6, 1.2, -1.2]) {
      const d = dir.clone().applyAxisAngle(V(0, 1, 0), a);
      for (let r = 0.4; r <= 1.6; r += 0.2) { const q = P.pos.clone().add(V(0, 1.2, 0)).addScaledVector(d, r); if (rockField(q.x, q.y, q.z) > 0) { wall = q; break; } }
      if (wall) break;
    }
    if (!wall) { this.say('Nothing to knock on here', 1.2); return; }
    this.audio.knock?.(wall);
    this.makeNoise(wall, 1.1, true);
  }

  // ------------------------------------------------------------------ GTA V: switch to another crewman (sky-cam)
  switchCharacter() {
    const alive = this.soldiers.filter((s) => s.alive && s.root.visible && s.state !== 'grabbed');
    if (!alive.length || this.switcher.busy) return;
    this._swIdx = ((this._swIdx ?? -1) + 1) % alive.length;
    // prefer the man furthest from the giant
    alive.sort((a, b) => b.root.position.distanceTo(this.cy.root.position) - a.root.position.distanceTo(this.cy.root.position));
    this.switcher.switchTo(alive[this._swIdx % alive.length]);
  }

  // where the GTA-style radar marker should point
  objectivePoint() {
    const W = this.world, P = this.player;
    const log = W.interact.find((i) => i.id === 'log');
    switch (this.phase) {
      case 'intro': return V(3, 0, -12);
      case 'sleep': return P.carrying ? W.firePos : log.obj.position;
      case 'stakeHot': return this.cy.eyeWorld();
      case 'blind': { if (P.disguised) return null; const s = W.interact.filter((i) => i.id === 'straw').sort((a, b) => a.pos.distanceTo(P.pos) - b.pos.distanceTo(P.pos))[0]; return s && s.pos; }
      case 'gate': return W.doorClosed;
      default: return null;
    }
  }

  // ------------------------------------------------------------------ bullet time (Breath of the Wild style)
  updateBulletTime(dtReal) {
    const P = this.player;
    // aiming the bow while in the air slows the world down, as long as there is stamina
    const want = this.started && !P.dead && !P.locked && !P.carrying && P.weapon === 'bow' && P.airTime > 0.12 &&
      (P.aim > 0.5 || P.drawing) && P.stamina > 0 && !P.exhausted;
    P.bulletTime = want;
    this.slowPunch = Math.max(0, (this.slowPunch || 0) - dtReal);
    const target = this.slowPunch > 0 ? (this.slowPunch > 1 ? 0.3 : 0.08) : this.wheel?.open ? 0.15 : want ? 0.2 : 1;
    // ease into slow motion quickly, out of it a bit slower
    const k = Math.min(1, dtReal * (want ? 10 : 5));
    this.timeScale = THREE.MathUtils.lerp(this.timeScale ?? 1, target, k);
    if (Math.abs(this.timeScale - 1) < 0.01) this.timeScale = 1;
    const slow = 1 - (this.timeScale - 0.2) / 0.8;   // 0..1
    this._slowFx = THREE.MathUtils.clamp(slow, 0, 1);
    // cinematic look: desaturate, deepen the vignette, a touch of aberration
    this.post.vignette.darkness = 0.72 + this._slowFx * 0.2;
    this.post.ca.offset.set(0.0006 + this._slowFx * 0.0022, 0.0004 + this._slowFx * 0.0014);
    if (this.post.hs) this.post.hs.saturation = -0.08 - this._slowFx * 0.35;
    this.audio.setSlowMo?.(this._slowFx);
    document.body.classList.toggle('slowmo', this._slowFx > 0.3);
  }

  updateStaminaWheel() {
    const P = this.player;
    if (!this.stamWheel) {
      this.stamWheel = document.createElement('div'); this.stamWheel.id = 'stamina';
      this.stamWheel.innerHTML = '<svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="16" class="bg"/><circle cx="20" cy="20" r="16" class="fg"/></svg>';
      document.getElementById('hud').appendChild(this.stamWheel);
      this.stamFg = this.stamWheel.querySelector('.fg');
    }
    const c = 2 * Math.PI * 16;
    this.stamFg.style.strokeDasharray = `${c * P.stamina} ${c}`;
    this.stamWheel.classList.toggle('show', P.stamina < 0.999);
    this.stamWheel.classList.toggle('exhausted', P.exhausted);
  }

  hitMarker(critical) {
    this.slowPunch = Math.max(this.slowPunch || 0, critical ? 0.3 : 0.07); // hit-stop
    this.haptic(critical ? 90 : 30);
    const c = this.hud.cross;
    c.classList.remove('hit', 'crit'); void c.offsetWidth;
    c.classList.add(critical ? 'crit' : 'hit');
    if (critical) this.popText('CRITICAL');
  }
  popText(txt) {
    const el = document.createElement('div'); el.className = 'pop'; el.textContent = txt;
    document.getElementById('hud').appendChild(el); setTimeout(() => el.remove(), 1200);
  }

  // ------------------------------------------------------------------ main update
  update(dt, t, dtReal = dt) {
    this.dt = dt;
    // real-time tasks (QTE, photo mode) run even when the world is slowed or frozen
    this.realTime = (this.realTime || 0) + dtReal; this.lastRealDt = dtReal;
    if (this.realTasks?.length) { const rt = this.realTasks; this.realTasks = []; for (const k of rt) { if (k.frame || this.realTime >= k.t) k.r(); else this.realTasks.push(k); } }
    if (this.photo && this.started) {
      if (this.input.pressed('KeyP')) this.photo.toggle();
      if (this.photo.on) { this.timeScale = 0; this.photo.update(dtReal); this.input.endFrame(); return; }
    }
    this.updateBulletTime(dtReal);
    if (!this.started) { this.cy.update(dt); return; }
    this.time += dt; this.phaseT += dt;
    // resolve waits
    const done = this.tasks.filter((k) => (k.t !== undefined ? this.time >= k.t : k.fn()));
    this.tasks = this.tasks.filter((k) => !done.includes(k));
    done.forEach((k) => k.r());

    this.wheel.update(this.input);
    this.player.update(dt, t, dtReal);
    if (this.camOverride) { this.camera.position.copy(this.camOverride); this.camera.lookAt(this.camTarget); }
    this.radar.update(dtReal);
    this.meter.update(dtReal);
    // hiding in a straw pile (crouched/prone right next to it)
    { const P = this.player; P.hiddenInStraw = (P.crouch || P.prone) && this.world.interact.some((i) => i.id === 'straw' && flat(i.pos).distanceTo(flat(P.pos)) < 1.9); }
    this.alertSys.update(dtReal);
    for (const n of this.noiseRings) n.t -= dtReal * 0.8;
    this.noiseRings = this.noiseRings.filter((n) => n.t > 0);
    // safety net: never fall through the cave floor
    { // if the player ever ends up inside solid rock or below the world, put him back where he last stood
      const P = this.player;
      const inRock = rockField(P.pos.x, P.pos.y + 1.0, P.pos.z) > 0.3 && P.pos.z < 30;
      if (inRock || P.pos.y < -4) { if (P.lastSafe) { P.pos.copy(P.lastSafe); P.vel.set(0, 0, 0); } }
      else if (P.onGround) (P.lastSafe ||= new THREE.Vector3()).copy(P.pos);
    }
    if (this.cy.root.visible) {
      if (this.cyState.mode !== 'sleep' && this.cyState.mode !== 'gate') this.cyMove(dt);
      this.cyThink(dt);
      this.cy.update(dt);
    }
    this.updateSoldiers(dt, t);
    this.flock.update(dt, t, { player: this.player, cyclops: this.cy, blocked: (x, z) => !walkable(x, z, 0.5) && z < 12 });
    this.particles.update(dt);
    this.interactions();
    this.gateCheck();
    // audio listener
    this.audio.listener = { pos: this.camera.position, yaw: this.player.yaw };
    this.audio.update(dt, this.camera.position.distanceTo(this.world.firePos));
    this.audio.updateWorld?.(dt, this);
    // flash decay
    const fl = this.post.grade.uniforms.get('uFlash'); fl.value = Math.max(0, fl.value - dt * 0.6);
    // HUD
    const P = this.player;
    this.hud.weapon.innerHTML = P.carrying ? '<b>STAKE</b>' : P.weapon === 'bow' ? `<b>BOW</b>  arrows ${P.arrows}` : P.weapon === 'stone' ? `<b>STONE</b>  ${P.stones}` : `<b>SPEAR</b>  ${P.spears}`;
    this.hud.status.innerHTML = `<div class="hp"><div style="width:${Math.max(0, P.hp)}%"></div></div>Men ${this.soldiers.filter((s) => s.alive).length} / 12${P.disguised ? '<br>Wearing straw' : ''}${P.prone ? '<br>Prone' : P.crouch ? '<br>Crouching' : ''}${P.climbing ? '<br>Climbing' : ''}`;
    this.hud.cross.classList.toggle('aim', P.aim > 0.5 || P.drawing);
    this.hud.cross.style.setProperty('--draw', P.draw.toFixed(3));
    this.updateStaminaWheel();
    this.input.endFrame();
  }
}
