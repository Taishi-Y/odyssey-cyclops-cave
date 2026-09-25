import { crewBark } from './voices.js';
import { equipSwords, updateCrewFight } from './crewfight.js';
import { updateSquad, squadStep, poseLeader } from './squad.js';
import * as THREE from 'three';
import { loadCharacterAssets, Cyclops, Soldier, CREW_MODELS } from './characters.js';
import { Flock } from './sheep.js';
import { floorHeightAt, LAYOUT, airDist, rockField } from './cave.js';
import { Physics } from './physics.js';
import { Fire } from './fire.js';
import { loadNav, navSeek, tunnelCenterX } from './nav.js';
import { updateCower } from './cower.js';
import { setupCheeseCrew, cheeseStep, poseCheese, endCheese } from './cheese.js';
import { Player } from './player.js';
import { Input, isTouchDevice, attachTouchControls } from './input.js';
import { HelpScreen } from './help.js';
import { Audio } from './audio.js';
import { Particles, Decals } from './fx.js';
import { BloodSpray, BloodSplats, SkinStains, addStump } from './blood.js';
import { ArrowFX } from './arrowfx.js';
import { Radar, AlertSystem, WeaponWheel, CharacterSwitch } from './tactical.js';
import { StealthMeter, QTE, PhotoMode, Pickups } from './modern.js';

const $ = (id) => document.getElementById(id);
// giant's grab / eat actions run this much slower than the original timing (heavier, more deliberate)
const CY_SLOW = 1.7;
// how far his fingers curl round a man he holds (radians per joint); a full fist would pass through the body
const GRIP = 0.8;
// seconds the cinematic shot of him eating a man lasts before the camera hands control back
const EAT_CAM_HOLD = 1.4;
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
  sleep: ['THE GIANT SLEEPS', 'Take the burning brand from the fire'],
  stakeHot: ['THE BRAND BURNS', 'Strike his eye to open it, then drive the brand in'],
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
    // NPC walkability from the real rock shape (the giant, the men and the sheep must not walk through walls)
    this.nav = await loadNav();
    this.nav.man.addObstacles(world.colliders.filter((c) => c !== world.cave && c !== world.boulder).map((c) => {
      const b = new THREE.Box3().setFromObject(c);
      return { x: (b.min.x + b.max.x) / 2, z: (b.min.z + b.max.z) / 2, r: Math.min(b.max.x - b.min.x, b.max.z - b.min.z) * 0.42 };
    }));
    // while the door-stone is shut nobody walks into it
    this.nav.man.extraBlock = (x, z) => this.doorShut && z > this.world.doorClosed.z - 5.2;
    // heavy blood drops leave small splats where they hit the floor (a few per frame at most)
    this._splatFrame = -1; this._splats = 0;
    const floorFx = {
      ground: floorHeightAt,
      onLand: (x, y, z, size) => {
        if (this._splatFrame !== this.frameNo) { this._splatFrame = this.frameNo; this._splats = 0; }
        if (this._splats++ < 4) this.decals.add(V(x, y - 0.02, z), 0.12 + size * 2.5 + Math.random() * 0.15);
      },
    };
    this.particles = new Particles(scene, 3000, floorFx);
    // gore from the giant's meals: world-sized drops so they read from across the cave
    this.bloodSplats = new BloodSplats(scene);
    this.gore = new BloodSpray(scene, this.camera, this.renderer, {
      ground: floorHeightAt,
      onLand: (x, y, z, size, vx, vz) => this.bloodSplats.add(x, y, z, size, vx, vz, this.frameNo),
    });
    this.decals = new Decals(scene);
    this.player = new Player({ camera: this.camera, scene, physics: this.physics, audio: this.audio, input: this.input });
    this.player.pos.set(3, floorHeightAt(3, 12), 12);
    this.player.yaw = 0.15;
    this.player.onProjectileTest = (a, b, p) => this.projectileHit(a, b, p);
    // Odysseus himself, seen over the shoulder
    this.odysseus = new Soldier(scene, { seed: 42, hero: true });
    this.player.setAvatar(this.odysseus);
    this.arrowFx = new ArrowFX(scene, this.camera, this.player, this.physics);
    this.arrowFx.zoneTest = (a, b) => this.zoneAlong(a, b);
    this.arrowFx.eyeTarget = () => (this.cy.root.visible && !this.cy.blind ? this.cy.eyeWorld() : null);
    this.arrowFx.onTargetChange = (zone) => { if (zone === 'eye') { this.haptic(20); this.audio.uiTick?.(); } };
    this.player.onImpact = (pt, n, p) => {
      const big = p && p.kind !== 'stone';
      this.particles.dust(pt, big ? 10 : 4, big ? 0.6 : 0.3); this.particles.sparks(pt, big ? 18 : 5);
      this.arrowFx.impact(pt, n, p);
      this.makeNoise(pt, 0.35);
    };
    this.player.onFire = () => {
      this.makeNoise(this.player.pos, 0.35);
      const c = this.hud.cross; c.classList.remove('release'); void c.offsetWidth; c.classList.add('release');
    };
    this.onProgress?.(0.5);

    // Polyphemus
    this.cy = new Cyclops(scene, 13);
    this.cy.squatRate = 1.2; // bends the knees slowly when reaching down
    this.cyStains = new SkinStains(this.cy); // blood on his mouth, chin and fist from each meal
    this.cy.root.position.set(0, 0, 60);
    this.cy.root.visible = false;
    this.cyState = { mode: 'away', target: null, alert: 0, stun: 0, anger: 0, step: 0, grabbing: null, heading: Math.PI, hp: 100 };
    this.onProgress?.(0.7);

    // companions (12 men followed Odysseus into the cave)
    this.soldiers = [];
    // they start crowded under the cheese sacks on the back wall (x 9..18, z -17), next to the flock (~(12,-7))
    const spots = [[8, -13], [8.5, -15], [9, -11.5], [14.5, -13], [15.5, -15], [16, -12], [17, -14], [18, -16], [14.5, -10.5], [17.5, -11], [19, -13.5], [16.5, -17]];
    const clearSpot = (x, z) => { // nearest walkable point (never inside rock or a prop)
      for (let r = 0; r <= 3; r += 0.5) for (let a = 0; a < 6.28; a += 0.8) {
        const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        if (this.nav.man.clear(px, pz)) return [px, pz];
        if (!r) break;
      }
      return [x, z];
    };
    spots.forEach(([x0, z0], i) => {
      const [x, z] = clearSpot(x0, z0);
      const nm = ['Eurylochus', 'Polites', 'Perimedes', 'Elpenor', 'Antiphus', 'Cleitus', 'Lycus', 'Dorion', 'Megon', 'Theon', 'Nicon', 'Aristo'][i].toLowerCase();
      const model = CREW_MODELS.includes(nm) ? nm : CREW_MODELS[i % CREW_MODELS.length];
      const s = new Soldier(scene, { torch: i % 4 === 0, seed: i + 1, model, helmet: [0, 4, 8].includes(i) }); // only three keep their helmets on
      s.home = V(x, floorHeightAt(x, z), z);
      s.root.position.copy(s.home);
      s.root.rotation.y = Math.PI + (Math.random() - 0.5) * 1.6; // looking up at the sacks
      s.name = ['Eurylochus', 'Polites', 'Perimedes', 'Elpenor', 'Antiphus', 'Cleitus', 'Lycus', 'Dorion', 'Megon', 'Theon', 'Nicon', 'Aristo'][i];
      if (s.torchTip) {
        const l = new THREE.PointLight(0xff8a3a, 20, 12, 1.8); s.torchTip.add(l); s.torchLight = l;
        const fl = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 2.2, 0.5) })); s.torchTip.add(fl);
      }
      s.cower = [5, 7, 10].includes(i); // Cleitus, Dorion, Nicon freeze in terror against the wall
      s.voice = [2, 6, 3, 7, 8, 0, 5, 4, 1, 7, 6, 8][i]; // crew voice A-I (Eurylochus C, Polites tenor, Perimedes D)
      this.soldiers.push(s);
    });
    equipSwords(this);
    setupCheeseCrew(this, clearSpot); // everyone starts raiding the cheese store
    this.onProgress?.(0.85);

    // the flock (the film used 40 sheep; 10 keeps the cave readable and the frame light)
    this.flock = new Flock(scene, 10, V(12, 0, -7), 3.5);
    this.flock.onBleat = (p) => this.audio.bleat(p);

    // heated stake glow
    this.stakeGlow = new THREE.PointLight(0xff5a10, 0, 5, 2);
    scene.add(this.stakeGlow);
    this.stakeHeat = 0;

    // Metal Gear / GTA systems
    this.VIEW_DOT = 0.2; this.VIEW_RANGE = 34;
    this.CY_WALK_PACE = 0.4; // giant's walking speed (and walk-cycle rate) multiplier
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
    this.help = new HelpScreen(this);
    this.input.onHelp = () => this.help.toggle();
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
    this.cyMeals = 0; // men the giant has actually eaten
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
    const sp = who && this.soldiers?.find((m) => m.name === who && m.alive);
    this.audio.sayVoice?.(text, sp ? sp.root.position.clone().setY(sp.root.position.y + 1.6) : null);
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
    document.body.classList.add('playing');
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
    else if (cp === 'blind') { this.soldiers.slice(0, 2).forEach((s) => this.killSoldier(s)); this.cy.setBlind(); this.placeCy(V(-8, 0, -8)); this.runBlind(); }
    else if (cp === 'gate') { this.soldiers.slice(0, 2).forEach((s) => this.killSoldier(s)); this.cy.setBlind(); this.placeCy(V(-2, 0, 3)); this.player.disguised = true; this.runGate(); }
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
    // a good while to explore and watch the men gorge themselves before he comes home:
    // at least 45 s, then he returns once the player has reached the cheese store (or 30 s more at the latest)
    await this.wait(45);
    await Promise.race([this.wait(30), this.until(() => Math.hypot(this.player.pos.x - 14, this.player.pos.z + 13) < 8)]);
    // the giant returns
    this.audio.stomp(V(0, 0, 45), 1.2); this.player.shake = 0.6;
    this.audio.boom?.('quake', 1);
    this.say('…The ground is shaking', 3, 'Perimedes');
    crewBark(this, 'arrive', { n: 3, delay: 1.6 });
    await this.wait(1.4);
    this.audio.stomp(V(0, 0, 42), 1.4); this.player.shake = 0.8;
    await this.wait(1.4);
    this.cy.root.visible = true;
    this.audio.boom?.('arrival', 1.2);
    this.placeCy(V(tunnelCenterX(17.8), 0, 17.8)); this.cy.crouch = 1; this.cy.squat = 0.35; this.cyState.heading = this.cy.root.rotation.y = Math.PI;
    this.cyState.mode = 'script';
    endCheese(this);
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
    crewBark(this, 'sealed', { n: 4, delay: 2.6, spread: 0.7 });
    await this.wait(4);
    this.runNight();
  }

  // The door-stone. Only the slab's free edge sticks out of the tunnel wall, so he walks up to it, clamps that edge
  // between both palms (one on each face) and hauls it out walking backwards; then he moves round to the cave side,
  // hooks his right hand round the edge, plants the left on its face and drags it shut in heaves.
  // Every hand target is a point on the rock itself (slab-local), so the hands travel with the stone.
  async closeBoulder() {
    const W = this.world, b = W.boulder, cy = this.cy, st = this.cyState, slab = b.children[0], r = cy.root;
    const from = b.position.clone(), to = W.doorClosed.clone(), rot0 = b.rotation.clone();
    const sw = cy.height / 13, s = sw / b.scale.x, X = V(1, 0, 0), Y = V(0, 1, 0), Z = V(0, 0, 1);
    const rc = new THREE.Raycaster();
    const L2W = (v) => b.localToWorld(v.clone());
    const dirW = (v) => v.clone().applyQuaternion(b.quaternion).normalize();
    b.updateMatrixWorld(true);
    const surf = (o, d) => { rc.set(L2W(o), dirW(d)); rc.far = 40; const h = rc.intersectObject(slab, false)[0]; return h ? b.worldToLocal(h.point.clone()) : o.clone(); };
    const edgeX = (y) => surf(V(-12, y, 0), X).x;
    const hand = 0.42 * s; // wrist sits this far off the rock
    // grip sets: stand point (slab-local, on the floor), heading offset and per-hand wrist / finger / palm directions
    const e1 = edgeX(4.8), e1b = edgeX(3.6);
    const pinch = {
      stand: V(e1 - 3.3 * s, 0, 0), face: X,
      R: { at: surf(V(e1 + 0.9, 4.8, 5), Z.clone().negate()).add(V(-0.35, 0, hand)), fingers: X, palm: Z.clone().negate(), grip: 0.55 },
      L: { at: surf(V(e1b + 0.9, 3.6, -5), Z).add(V(-0.35, 0, -hand)), fingers: X, palm: Z, grip: 0.55 },
    };
    const e3 = edgeX(5.6); // chest height: where the push clip's hands are
    const hook = {
      stand: V(e3 - 0.8 * s, 0, -3.3 * s), face: Z,
      R: { at: V(e3 - hand, 5.6, -0.15), fingers: Z.clone().addScaledVector(X, 0.25), palm: X, grip: 0.8 },
      L: { at: surf(V(e3 + 1.1, 4.4, -5), Z).add(V(0, 0, -hand)), fingers: Y.clone().addScaledVector(X, -0.3), palm: Z, grip: 0.25 },
    };
    const headingOf = (f) => { const d = dirW(f); return Math.atan2(d.x, d.z); };
    const standW = (g) => { const p = L2W(g.stand); p.y = floorHeightAt(p.x, p.z); return p; };
    const place = (k) => {
      b.position.lerpVectors(from, to, k);
      b.rotation.set(rot0.x, rot0.y, rot0.z + Math.sin(k * Math.PI) * 0.035); // the slab tips a little as it scrapes along
      b.updateMatrixWorld(true);
      this.setDaylight(1 - k);
    };
    const hold = (g, w, lead = V()) => {
      const p = standW(g).add(lead); r.position.copy(p);
      st.heading = r.rotation.y = headingOf(g.face);
      for (const side of ['R', 'L']) {
        const h = g[side], ik = cy.ik[side] || (cy.ik[side] = { target: V(), w: 0 });
        ik.target.copy(L2W(h.at)); ik.w = w[side] ?? w; ik.noSquat = true; // posture comes from the clip
        ik.aim = { fingers: dirW(h.fingers), palm: dirW(h.palm) };
      }
      cy.grip = g.R.grip * (w.R ?? w); cy.gripL = g.L.grip * (w.L ?? w); cy.gripSign = 1;
      cy.lookAt = L2W(g.R.at.clone().lerp(g.L.at, 0.5));
    };
    const frame = () => this.wait(1 / 30);
    const walk = async (target, heading, speed, back = false) => {
      const p0 = r.position.clone(), d = target.clone().sub(p0); d.y = 0;
      const dur = Math.max(0.4, d.length() / speed), h0 = r.rotation.y;
      let dh = heading - h0; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      cy.play('walk', 0.3, (back ? -0.42 : 0.42) * this.CY_WALK_PACE);
      for (let t = 0; t < dur; t += 1 / 30) {
        await frame();
        const u = THREE.MathUtils.smoothstep(t / dur, 0, 1);
        r.position.lerpVectors(p0, target, u); r.position.y = floorHeightAt(r.position.x, r.position.z);
        st.heading = r.rotation.y = h0 + dh * Math.min(1, u * 1.6);
      }
      cy.play('idle', 0.4);
      this.stomp();
    };
    const reach = async (g, dur, on) => {
      for (let t = 0; t <= dur; t += 1 / 30) { await frame(); const u = THREE.MathUtils.smoothstep(t / dur, 0, 1); hold(g, on ? u : 1 - u); }
    };
    // hauls: the body leads (arms straighten, he throws his weight back), then the stone follows with a grinding lurch
    // body: the mocap pushing loop (played backwards while he hauls the stone towards himself)
    const haul = async (g, k0, k1, dur, away, push = 1) => {
      cy.play(cy.actions.m_push ? 'm_push' : 'idle', 0.35, push * 0.55);
      for (let t = 0; t < dur; t += 1 / 30) {
        await frame();
        const u = t / dur, ks = THREE.MathUtils.smoothstep(u, 0.12, 1), kb = THREE.MathUtils.smoothstep(u, 0, 0.85);
        place(k0 + (k1 - k0) * ks);
        hold(g, 1, away.clone().multiplyScalar(0.55 * sw * (kb - ks)));
        this.player.shake = Math.max(this.player.shake, 0.3 + 0.2 * Math.sin(u * Math.PI));
        if (Math.random() < 0.35 * (ks - kb + 1)) this.particles.dust(L2W(V(THREE.MathUtils.lerp(-5, 5, Math.random()), 0.3, (Math.random() - 0.5) * 2)), 3, 2);
      }
      this.audio.stomp(b.position, 0.9); this.stomp();
      this.player.shake = Math.max(this.player.shake, 0.55);
    };
    const pullDir = to.clone().sub(from).setY(0).normalize();
    // move from one grip set to another without letting go of the arms: the stand point, facing and both hands glide
    // across (each hand lifts off the rock in a short arc, the fingers open on the way and close again on arrival)
    const lerpGrip = (a, c, u, lift) => {
      const hand = (A, C, d) => {
        const v = THREE.MathUtils.smoothstep(u, d, d + 0.6), up = Math.sin(v * Math.PI) * lift;
        // a hand crossing from one face to the other goes round the slab's edge, never through the stone
        let at;
        if (Math.sign(A.at.z) !== Math.sign(C.at.z) && A.at.z * C.at.z < -0.1) {
          const M = V(Math.min(A.at.x, C.at.x) - 1.1 * s, (A.at.y + C.at.y) / 2, 0);
          at = v < 0.5 ? A.at.clone().lerp(M, v * 2) : M.clone().lerp(C.at, v * 2 - 1);
        } else at = A.at.clone().lerp(C.at, v).add(V(0, up * 0.6, -up));
        return { at, fingers: A.fingers.clone().lerp(C.fingers, v).normalize(), palm: A.palm.clone().lerp(C.palm, v).normalize(), grip: THREE.MathUtils.lerp(A.grip, C.grip, v) * (1 - Math.sin(v * Math.PI) * 0.9) };
      };
      const k = THREE.MathUtils.smoothstep(u, 0, 1);
      return { stand: a.stand.clone().lerp(c.stand, k), face: a.face.clone().lerp(c.face, k).normalize(), R: hand(a.R, c.R, 0), L: hand(a.L, c.L, 0.4) };
    };
    const regrip = async (a, c, dur, lift, stepping) => {
      if (stepping) cy.play('walk', 0.3, 0.42 * this.CY_WALK_PACE);
      for (let t = 0; t <= dur; t += 1 / 30) { await frame(); hold(lerpGrip(a, c, t / dur, lift), 1); }
      if (stepping) { cy.play('idle', 0.4, 0.5); this.stomp(); }
    };

    // 1. walk up to the edge sticking out of the wall, hook it and lean into the stone (the mocap push loop drives
    //    his legs and back; the hands are pinned to the rock by IK)
    st.walkTarget = null;
    cy.noDuck = true; // the widened entrance is tall enough: no ducking while he works the stone
    await walk(standW(hook), headingOf(hook.face), 3.6);
    if (cy.actions.m_push) cy.play('m_push', 0.4, 0.05);
    await reach(hook, 0.5, true);
    // 4. three heaves drag it across the entrance; the right hand shifts onto the face before the edge buries itself in the far wall
    this.audio.rumble(6, 1.3);
    const side = dirW(X.clone().negate()).setY(0).normalize();
    await haul(hook, 0, 0.4, 1.4, side);
    await haul(hook, 0.4, 0.78, 1.4, side);
    // for the last shove he shifts away from the far wall: both palms flat on the face, further along
    const shove = {
      stand: hook.stand.clone().add(V(3.2, 0, 0)), face: Z,
      R: { ...hook.L, at: hook.L.at.clone().add(V(-0.5, 1.1, 0)), grip: 0.25 },
      L: { ...hook.L, at: surf(V(e3 + 5.0, 5.0, -5), Z).add(V(0, 0, -hand)) },
    };
    await regrip(hook, shove, 0.4, 0.8 * s, false);
    await haul(shove, 0.78, 1, 0.9, side);
    place(1);
    this.setDaylight(0);
    this.audio.stomp(b.position, 1.5); this.player.shake = 1.2;
    this.audio.boom?.('impact', 1.4);
    for (let i = 0; i < 6; i++) this.particles.dust(L2W(V(-5 + i * 2, 0.4, -1.2)), 5, 3);
    await this.wait(0.2);
    // let go: the hands come back down onto the knees, where the ducking pose puts them anyway
    {
      const f = V(Math.sin(r.rotation.y), 0, Math.cos(r.rotation.y)), rt = V(f.z, 0, -f.x);
      const start = { R: cy.ik.R.target.clone(), L: cy.ik.L.target.clone() };
      for (let t = 0; t <= 0.4; t += 1 / 30) {
        await frame();
        const u = THREE.MathUtils.smoothstep(t / 0.4, 0, 1);
        for (const [sd, sg] of [['R', -1], ['L', 1]]) {
          const tuck = r.position.clone().addScaledVector(f, 2.2 * sw).addScaledVector(rt, sg * 0.9 * sw).add(V(0, 3.2 * sw, 0));
          const ik = cy.ik[sd]; ik.target.lerpVectors(start[sd], tuck, u); ik.w = 1 - u; ik.aim = null;
        }
        cy.grip = cy.gripL = 0.3 * (1 - u);
      }
    }
    cy.ik.R = cy.ik.L = null; cy.grip = cy.gripL = 0; cy.lookAt = null; cy.noDuck = false;
    cy.play('idle', 0.5);
    b.rotation.copy(rot0);
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
    // his meal: two men (any he snatches on his own count too), then he lies down and sleeps it off
    let told = false;
    while (this.cyMeals < 2 && this.phase === 'night') {
      await this.cyEat();
      if (this.cyMeals >= 1 && !told) { told = true; this.say('That eye… he only has the one. Aim for it', 4, 'Odysseus'); }
      if (this.cyMeals < 2) await this.wait(7);
    }
    if (this.phase !== 'night') return;
    this.cyState.mode = 'script';
    await this.wait(2);
    this.runSleep();
  }

  async runSleep() {
    this.setPhase('sleep');
    this.cyState.mode = 'script';
    this.bed ||= this.findBed();
    const bed = this.bed.pos;
    if (this.cy.root.position.distanceTo(bed) > 3) await this.cyWalkTo(bed, 2);
    this.placeCy(bed);
    this.audio.roar(this.cy.eyeWorld(), { dur: 2.5, vol: 0.35, pitch: 0.6 });
    await this.lieDown(this.bed.yaw);
    this.cyState.mode = 'sleep';
    this.eyeHits = 0;
    this.setTension(0.25);
    this.say('He\'s asleep… it\'s now or never', 3, 'Eurylochus');
    this.placeBrand();
    this.world.interact.find((i) => i.id === 'log').enabled = true;
    this.gatherCrew();
  }

  // where he lies: on his side with his face a few metres from the fire (so the firelight is on it)
  // and his body in the open. yaw is his lying heading (head along local -x, face along local +z)
  findBed() {
    const F = this.world.firePos, g = this.nav.giant, H = this.cy.height;
    const from = this.cy.root.position;
    let best = null;
    for (let i = 0; i < 48; i++) {
      const yaw = i / 48 * Math.PI * 2;
      const head = V(-Math.cos(yaw), 0, Math.sin(yaw)), face = V(Math.sin(yaw), 0, Math.cos(yaw));
      for (const D of [4.2, 4.8, 5.4]) {
        // eye sits ~0.96 H along the head axis and a little toward the face from the root
        const root = F.clone().addScaledVector(face, -D - 0.55).addScaledVector(head, -0.96 * H);
        let ok = true;
        for (let a = -0.05; a <= 1.02 && ok; a += 0.08) for (const o of [-1.6, 0, 1.6]) {
          const q = root.clone().addScaledVector(head, a * H).addScaledVector(face, o);
          if (!g.clear(q.x, q.z) || flat(q).distanceTo(flat(F)) < 2.2) { ok = false; break; }
        }
        // room for the men (and you) between his face and the fire
        const gap = F.clone().addScaledVector(face, -D * 0.5);
        if (ok && !this.nav.man.clear(gap.x, gap.z)) ok = false;
        if (!ok) continue;
        const cost = root.distanceTo(from) + D * 2;
        if (!best || cost < best.cost) best = { pos: V(root.x, 0, root.z), yaw, cost };
      }
    }
    return best || { pos: V(-15, 0, -12), yaw: null };
  }

  // the burning brand: a stick lying with its tip in the fire, on the far side from his face
  placeBrand() {
    const W = this.world, S = W.stakeLog, F = W.firePos;
    if (!this._brandTip) {
      S.scale.setScalar(0.62);
      S.rotation.set(0, 0, 0); S.position.set(0, 0, 0); S.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(S), c = b.getCenter(V()), sz = b.getSize(V());
      const tip = sz.x >= sz.z ? V(b.max.x, c.y, c.z) : V(c.x, c.y, b.max.z);
      this._brandTip = tip.clone().sub(V(c.x, 0, c.z)); this._brandCenter = V(c.x, b.min.y, c.z);
      this.brandFire = new Fire(this.scene, V(), { size: 0.32, count: 14, light: false, smoke: true, cards: 2 });
      W.updaters.push((dt, t) => this.updateBrand(dt, t));
    }
    const face = this.bed?.yaw != null ? V(Math.sin(this.bed.yaw), 0, Math.cos(this.bed.yaw)) : V(1, 0, 0);
    const u = face.clone(); // from the fire away from his face
    const d = this._brandTip.clone().setY(0).normalize();
    const th = Math.atan2(-u.x, -u.z) - Math.atan2(d.x, d.z);
    S.rotation.set(0, th, 0);
    const tipW = F.clone().addScaledVector(u, 0.55);
    const off = this._brandTip.clone().setY(0).applyAxisAngle(V(0, 1, 0), th);
    const cOff = this._brandCenter.clone().setY(0).applyAxisAngle(V(0, 1, 0), th);
    S.position.set(tipW.x - off.x - cOff.x, 0, tipW.z - off.z - cOff.z);
    S.position.y = floorHeightAt(S.position.x, S.position.z) - this._brandCenter.y + 0.05;
    S.visible = true;
    const log = W.interact.find((i) => i.id === 'log'); log.pos.copy(S.position);
  }

  // keep the little flame on the brand's tip, on the floor or in your hands
  updateBrand(dt, t) {
    const f = this.brandFire; if (!f) return;
    const P = this.player, S = this.world.stakeLog;
    let on = false;
    if (P.carrying && P.carryMesh && this.stakeHeat > 0) { P.carryMesh.localToWorld(f.group.position.copy(this._brandTip)); on = true; }
    else if (S.visible && this._brandTip) { S.localToWorld(f.group.position.copy(this._brandTip)); on = true; }
    f.group.visible = on;
    if (on) f.update(dt, t);
  }

  // the men creep up and crowd round his sleeping face, in the firelight
  gatherCrew() {
    if (!this.bed || this.bed.yaw == null) return;
    const eye = this.cy.eyeWorld(), face = V(Math.sin(this.bed.yaw), 0, Math.cos(this.bed.yaw)), F = this.world.firePos;
    const men = this.soldiers.filter((s) => s.alive && !s.escaped && s.state !== 'fight');
    // spots on both flanks of his face, nearest first; the lane straight in front of the eye stays open for you
    const spots = [];
    for (let r = 2.4; r < 6.5; r += 0.6) for (let a = -1.5; a <= 1.5; a += 0.12) {
      if (Math.abs(a) < 0.3 || spots.length >= men.length) continue;
      const p = V(eye.x, 0, eye.z).addScaledVector(face.clone().applyAxisAngle(V(0, 1, 0), a), r);
      if (flat(p).distanceTo(flat(F)) < 2 || !this.nav.man.clear(p.x, p.z)) continue;
      if (spots.some((q) => q.distanceTo(p) < 1.1)) continue;
      spots.push(p);
    }
    men.forEach((s, i) => { if (spots[i]) { s.gatherAt = spots[i]; s.state = 'gather'; } });
  }
  scatterCrew() { for (const s of this.soldiers) if (s.state === 'gather') { s.state = 'panic'; s.gatherAt = null; } }

  async lieDown(yawWant = null) {
    const r = this.cy.root, start = r.position.clone(), rot0 = r.rotation.clone();
    this.cy.play('idle', 1, 0.25);
    this.cy.eyeOpen = 1;
    // lie on his side (rolled onto his right shoulder), face toward the fire (or the head toward the middle of the cave)
    const toC = V(-start.x, 0, -start.z).normalize();
    const yaw = yawWant ?? Math.atan2(toC.z, -toC.x); // local -x (where the head goes after the roll)
    let dy = yaw - rot0.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    r.rotation.order = 'YXZ';
    for (let t = 0; t < 3; t += 1 / 30) {
      await this.wait(1 / 30);
      const k = THREE.MathUtils.smoothstep(t / 3, 0, 1);
      r.rotation.set(0, rot0.y + dy * Math.min(1, k * 2), Math.PI / 2 * k);
      r.position.set(start.x, start.y + 1.5 * k, start.z);
      this.cy.eyeOpen = 1 - k;
      if (t > 2.6 && !this._laid) { this._laid = true; this.audio.stomp(start, 1.6); this.player.shake = 1; this.particles.dust(start, 40, 6); }
    }
    this.cy.eyeOpen = 0;
    this.cyState.lying = true;
    this.sleepArms();
  }

  // arms folded for sleeping on his side: lower hand tucked under the head like a pillow, upper arm draped in front
  sleepArms() {
    const cy = this.cy, r = cy.root, H = cy.height;
    const head = V(-Math.cos(r.rotation.y), 0, Math.sin(r.rotation.y)); // local -x after the roll
    const face = V(Math.sin(r.rotation.y), 0, Math.cos(r.rotation.y));
    const at = (along, out, up) => { const p = r.position.clone().addScaledVector(head, along * H).addScaledVector(face, out * H); p.y = floorHeightAt(p.x, p.z) + up * H; return p; };
    cy.ik.R = { target: at(0.92, 0.12, 0.03), w: 1 };
    cy.ik.L = { target: at(0.55, 0.22, 0.06), w: 1 };
    // face turned out toward the fire so the firelight is on it (and on the eye)
    cy.headLift = 1;
    const e = cy.eyeWorld(); cy.lookAt = this.bed?.yaw != null ? this.world.firePos.clone().setY(e.y) : e.clone().addScaledVector(face, 10);
  }

  async standUp() {
    this.cy.ik.R = null; this.cy.ik.L = null; this.cy.lookAt = null; this.cy.headLift = 0;
    const r = this.cy.root, start = r.position.clone(), rot0 = r.rotation.clone();
    for (let t = 0; t < 2.5; t += 1 / 30) {
      await this.wait(1 / 30);
      const k = THREE.MathUtils.smoothstep(t / 2.5, 0, 1);
      r.rotation.set(rot0.x * (1 - k), rot0.y, rot0.z * (1 - k));
      r.position.y = start.y - (start.y - floorHeightAt(start.x, start.z)) * k;
    }
    r.rotation.x = 0; r.rotation.z = 0;
    this.cyState.lying = false;
  }

  // blinded on the floor: rolls and kicks, both hands clawing at the burning eye, screaming
  async thrash(dur) {
    const cy = this.cy, r = cy.root, y0 = r.rotation.y, z0 = r.rotation.z, base = r.position.clone(), H = cy.height;
    const face = () => V(Math.sin(r.rotation.y), 0, Math.cos(r.rotation.y));
    let nextYell = 0.9;
    for (let t = 0; t < dur; t += 1 / 30) {
      await this.wait(1 / 30);
      const k = Math.min(1, t / 0.3) * (t > dur - 0.6 ? (dur - t) / 0.6 : 1);
      r.rotation.z = z0 + (Math.sin(t * 7.3) * 0.22 + Math.sin(t * 12.9) * 0.08) * k;
      r.rotation.y = y0 + Math.sin(t * 4.1) * 0.12 * k;
      r.position.set(base.x, base.y + Math.abs(Math.sin(t * 7.3)) * 0.35 * k, base.z);
      cy.forceSquat = 0.6 + Math.sin(t * 9.7) * 0.4 * k; cy.squatRate = 9;
      const eye = cy.eyeWorld(), f = face();
      cy.ik.R = { target: eye.clone().addScaledVector(f, 0.08 * H).add(V(0, 0.03 * H, 0)), w: 0.95 * k + 0.05 };
      cy.ik.L = { target: eye.clone().addScaledVector(f, 0.09 * H).add(V(0, -0.04 * H, 0)), w: 0.95 * k + 0.05 };
      if (Math.random() < 0.35) this.particles.blood(eye, f.clone().add(V(0, 0.6, 0)), 6, 3);
      if (Math.random() < 0.08) { this.audio.stomp(base, 0.8); this.particles.dust(base, 10, 4); }
      this.player.shake = Math.max(this.player.shake, 0.9 * k);
      if (t > nextYell) { nextYell = t + 1.1 + Math.random() * 0.4; this.audio.cyShriek?.(eye, { vol: 1.3 }); this.audio.roar(eye, { dur: 1.6, vol: 1.2, pitch: 1.25, pain: true }); }
    }
    r.rotation.set(0, y0, z0); r.position.copy(base);
    cy.forceSquat = 0; cy.squatRate = 1.2; cy.ik.R = null; cy.ik.L = null;
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
    // "GYAAAAAAAH": a long shriek stacked over the pain roar, again and again while he thrashes
    this.audio.cyShriek?.(eye, { vol: 1.6 });
    this.audio.roar(eye, { dur: 5.5, vol: 2, pitch: 1.3, pain: true });
    this.audio.scream(eye);
    this.audio.boom?.('arrival', 1.3);
    this.say('GYAAAAAAAAAAAAAAAARGH!!!', 3.5, 'Polyphemus');
    this.scatterCrew();
    crewBark(this, 'blind', { n: 4, delay: 0.6 });
    this.player.shake = 2.6;
    this.player.setCarry(null);
    this.stakeHeat = 0;
    this.stakeGlow.intensity = 0;
    this.cy.setBlind();
    this.cy.eyeOpen = 0;
    await this.wait(0.5);
    this.player.locked = false;
    this.player.vel.set(0, 3, 0).addScaledVector(flat(this.player.pos.clone().sub(eye)).normalize(), 7);
    await this.thrash(3.6);
    await this.standUp();
    // on his feet, still clutching the eye and rocking in pain before he starts to grope around
    this.cyState.stun = 2.6; this.cyState.eyePain = 2.6;
    this.audio.cyShriek?.(this.cy.eyeWorld(), { vol: 1.4 });
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
    crewBark(this, 'blind', { n: 3, delay: 6 });
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
    // spread the flock over the same ~64 s the crew needs to crawl out
    const n = this.flock.count;
    for (let i = 0; i < n; i++) {
      this.flock.released = i + 1;
      await this.wait(64 / n);
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
    this.post.grade.uniforms.get('uCave').value = 0;
    this.world.sky.material.uniforms.uBright.value = 0.28;
    this.scene.fog.density = 0.006; this.scene.fog.color.set(0x3d5358);
    this.world.hemi.intensity = 1.2; this.world.hemi.color.set(0x9ec4d0); this.world.hemi.groundColor.set(0x3a3322);
    this.player.pos.set(this.world.doorClosed.x - 6, 1, 64);
    this.player.yaw = 0.12; this.player.pitch = 0.2;
    this.placeCy(V(this.world.doorClosed.x - 3, 0, 41)); this.cy.root.position.y = 0.9; this.cy.root.rotation.set(0, 0, 0); this.cyState.heading = 0;
    this.cy.play('sad_pose', 0.1);
    this.hud.fade.style.opacity = 0;
    await this.wait(2);
    const vlen = this.audio.voice(this.cy.eyeWorld(), { vol: 1.4, wet: 0.7, minG: 0.8 });
    if (!vlen) this.audio.roar(this.cy.eyeWorld(), { dur: 3, vol: 0.9, pitch: 0.7 });
    this.say('Father Poseidon, they blinded me…', vlen ? 6.5 : 4.5, 'Polyphemus');
    await this.wait(vlen ? 6.7 : 4.8);
    this.say(vlen ? 'Vengeance, father… vengeance for me… Poseidon, vengeance for me…' : 'Vengeance, father… vengeance for me…', vlen ? 6.8 : 4.5, 'Polyphemus');
    await this.wait(vlen ? 7.3 : 4.8);
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
    const st = this.cyState, r = this.cy.root, nav = this.nav.giant;
    if (st.walkTarget) {
      // in the low entrance tunnel he ducks (see update) and keeps to its centre line;
      // everywhere else he walks the grid path
      const inSlot = r.position.z > 14.5;
      const sz = Math.max(r.position.z - 1.5, 14);
      const wp = inSlot ? [tunnelCenterX(sz), sz] : navSeek(nav, st, r.position, st.walkTarget, dt, 0.9);
      const final = !inSlot && st.path.length <= 1;
      const d = V(wp[0] - r.position.x, 0, wp[1] - r.position.z);
      const dist = d.length();
      if (final && dist < 0.6) { st.walkTarget = null; st.path = null; this.cy.play('idle'); return; }
      st.heading = Math.atan2(d.x, d.z);
      // walking pace is slowed down to read as a heavy giant (running stays as it was)
      const run = st.walkSpeed > 3, pace = run ? 1 : this.CY_WALK_PACE;
      let sp = (final ? Math.min(st.walkSpeed, dist * 1.5) : st.walkSpeed) * pace;
      if (st.hurt > 0) sp *= 0.15;
      if ((this.cy.sitW || 0) > 0.15) sp = 0; // still getting up off the floor // an arrow just went in: he stops short and clutches it
      const dx = (d.x / Math.max(dist, 1e-4)) * sp * dt, dz = (d.z / Math.max(dist, 1e-4)) * sp * dt;
      if (inSlot) { r.position.x += dx; r.position.z += dz; st.blockedT = 0; }
      else if (nav.step(r.position, dx, dz)) st.blockedT = 0;
      else if ((st.blockedT = (st.blockedT || 0) + dt) > 0.8) { st.walkTarget = null; st.path = null; st.blockedT = 0; this.cy.play('idle'); }
      r.position.y = nav.floorY(r.position.x, r.position.z) ?? floorHeightAt(r.position.x, r.position.z);
      this.cy.play(run ? 'run' : 'walk', 0.5, run ? 0.35 : 0.42 * pace);
      st.step += dt * sp;
      if (st.step > 3.2) { st.step = 0; this.stomp(); }
    }
    if (st.hurt > 0) st.hurt -= dt;
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
    this.cy.forceSquat = 0.45; // bend the knees a little to reach down
    windup *= CY_SLOW;
    this.audio.roar(this.cy.eyeWorld(), { dur: 1.2, vol: 0.4, pitch: 1.2 });
    let caught = false;
    for (let t = 0; t < windup; t += 1 / 30) {
      await this.wait(1 / 30);
      if (st.stun > 0) { this.cy.ik.R = null; st.grabbing = false; return false; }
      ik.target.lerp(getTarget(), 0.12);
      ik.w = Math.min(1, t / windup * 1.3);
    }
    const hp = hand.getWorldPosition(V(0, 0, 0));
    caught = flat(hp).distanceTo(flat(getTarget())) < 3.0 || flat(this.cy.root.position).distanceTo(flat(getTarget())) < 8.5;
    st.grabbing = false;
    return caught;
  }

  // the crewman the giant goes for: whoever just cut him, else the nearest man in the open
  crewPrey(maxDist = Infinity) {
    const cp = this.cy.root.position, now = this.time;
    const men = this.soldiers.filter((s) => s.alive && s.root.visible && s.state !== 'grabbed' && s.state !== 'dead' && s.state !== 'crawlOut');
    const score = (s) => flat(s.root.position).distanceTo(flat(cp)) - (s.hitAt && now - s.hitAt < 6 ? 8 : 0) + (s.sitting ? 6 : 0);
    men.sort((a, b) => score(a) - score(b));
    const m = men[0];
    return m && flat(m.root.position).distanceTo(flat(cp)) < maxDist ? m : null;
  }

  async cyEat(prey = null) {
    if (this._eating) await this.until(() => !this._eating);
    this._eating = true;
    try { await this.cyEatOnce(prey); } finally { this._eating = false; this.cy.forceSquat = 0; this.cyState.eatCd = this.time + 16; }
  }

  async cyEatOnce(prey) {
    const victim = prey && prey.alive && prey.state !== 'grabbed' ? prey : this.crewPrey();
    if (!victim) return;
    const cp = this.cy.root.position;
    victim.state = 'frozen';
    this.cyState.mode = 'script';
    const vp = victim.root.position;
    const stand = vp.clone().add(flat(cp).sub(flat(vp)).normalize().multiplyScalar(4.5));
    await this.cyWalkTo(stand, 1.8);
    if (this.cyState.stun > 0) { this.cyState.mode = 'tend'; return; }
    this.cyState.heading = Math.atan2(victim.root.position.x - cp.x, victim.root.position.z - cp.z);
    victim.state = 'frozen';
    this.audio.scream(victim.root.position);
    crewBark(this, 'grab', { who: victim, cooldown: 0 });
    const caught = await this.cyGrab(() => victim.root.position.clone().add(V(0, 1, 0)), 1.2);
    if (!caught || this.cyState.stun > 0 || !victim.alive) { this.cy.ik.R = null; victim.state = 'hide'; this.cyState.mode = 'tend'; return; }
    victim.state = 'grabbed';
    this._handShot = false; this._preyAlive = true;
    this.startEatCam(victim);
    crewBark(this, 'witness', { n: 4, near: vp, delay: 0.4, spread: 0.6 });
    this.say(`${victim.name}！`, 2, '');
    // lift to the mouth
    this.cy.forceSquat = 0.4;
    const LIFT = 2.2 * CY_SLOW;
    this.cy.gripSign = this._gripSign || 1;
    for (let t = 0; t < LIFT; t += 1 / 30) {
      await this.wait(1 / 30);
      const mouth = this.cy.mouthWorld();
      const k = THREE.MathUtils.smoothstep(t / LIFT, 0, 1);
      const fw = V(Math.sin(this.cy.root.rotation.y), 0, Math.cos(this.cy.root.rotation.y));
      this.cy.ik.R.target.lerpVectors(this.cy.ik.R.target, mouth.clone().addScaledVector(fw, 3.0).add(V(0, -1.9, 0)), 0.04 + k * 0.05);
      this.cy.ik.R.w = 1;
      this.cy.grip = Math.min(GRIP, t / (0.5 * CY_SLOW) * GRIP); // close the fist on him first
      this.holdInFist(victim, Math.sin(t * 20) * 0.3);
      if (this.cyState.stun > 0 || this._handShot) { await this.releasePrey(victim); return; } // dropped!
    }
    await this.cyMunch(victim);
  }

  // one-handed eating: he holds the man round the waist and bites him down in several mouthfuls
  async cyMunch(victim) {
    const cy = this.cy, hand = cy.bones.RightHand, ik = cy.ik.R, vb = victim.bmap || {};
    const fwd = () => V(0, 0, 1).applyQuaternion(cy.root.quaternion).setY(0).normalize();
    const hold = (k, side = 0) => {
      // k=0: held at chest height in front of the face, k=1: the man's head in the mouth
      const m = cy.mouthWorld();
      return m.add(fwd().multiplyScalar(THREE.MathUtils.lerp(3.0, 1.15, k))).add(V(0, THREE.MathUtils.lerp(-1.9, -0.85, k), 0))
        .add(V(0, 1, 0).cross(fwd()).multiplyScalar(side));
    };
    const gone = [], wounds = [];
    const P = (b) => b.getWorldPosition(V(0, 0, 0));
    // where a bitten-off part was: the stump, and the way blood leaves it (out of the body, a little up)
    const stump = (b) => { const at = P(b), out = b.parent?.isBone ? at.clone().sub(P(b.parent)).normalize() : V(0, 1, 0); return { at, out: out.add(V(0, 0.5, 0)).normalize() }; };
    const eat = (bone, r) => { if (bone) { addStump(bone, r); bone.scale.setScalar(0.001); gone.push(bone); wounds.push({ bone, t0: this.time }); } };
    const bleed = () => { // pulsing arterial jets from every open wound, fading as he bleeds out
      if (!victim.root.visible) return;
      for (const w of wounds) {
        const age = this.time - w.t0, beat = Math.max(0, Math.sin(age * Math.PI * 2 * 1.4));
        const { at, out } = stump(w.bone);
        this.gore.spurt(at, out, Math.exp(-age / 4) * (0.3 + 0.7 * beat * beat));
        if (Math.random() < 0.35) this.gore.drip(at, 1, 0.2);
      }
      if (wounds.length && Math.random() < 0.25) this.gore.drip(cy.mouthWorld(), 1, 0.25); // running off his lips
    };
    victim.play('run', 0.15, 2.2); // legs kicking in the fist
    cy.grip = GRIP; cy.gripSign = this._gripSign || 1;
    let alive = true;
    const step = async (dur, fn) => {
      dur *= CY_SLOW;
      for (let t = 0; t < dur; t += 1 / 30) {
        await this.wait(1 / 30);
        fn(Math.min(1, t / dur), t);
        this.holdInFist(victim, alive ? Math.sin(t * 18) * 0.25 : 0);
        bleed();
        if (this.cyState.stun > 0 || (alive && this._handShot)) return false;
      }
      return true;
    };
    const parts = [vb.head, vb.lArm || vb.lShoulder, vb.spine2 || vb.spine1, null];
    for (let n = 0; n < parts.length; n++) {
      const side = (n % 2 ? -1 : 1) * 0.35;
      // bring him in and lunge
      if (!(await step(n === 0 ? 0.9 : 0.55, (k) => { const e = THREE.MathUtils.smoothstep(k, 0, 1); ik.target.lerp(hold(e, side * (1 - e)), 0.2); cy.bite = e; cy.chew = 0; }))) break;
      // snap
      const mouth = cy.mouthWorld();
      this.audio.crunch(mouth); this.haptic(40);
      const sideDir = V(0, 1, 0).cross(fwd()).multiplyScalar(Math.random() < 0.5 ? -1 : 1);
      this.gore.gore(mouth.clone().addScaledVector(fwd(), 0.4), fwd().multiplyScalar(0.6).add(sideDir).add(V(0, 0.15, 0)), n === 3 ? 260 : 180, 5.5);
      this.gore.gore(mouth.clone().addScaledVector(fwd(), 0.4), sideDir.clone().negate().add(V(0, -0.4, 0)), 70, 4);
      this.decals.add(V(mouth.x, floorHeightAt(mouth.x, mouth.z), mouth.z), 1 + n * 0.5);
      if (n === 0) { alive = false; this._preyAlive = false; victim.play('sad_pose', 0.1); crewBark(this, 'eaten', { n: 2, delay: 0.9, spread: 1.4 }); }
      if (parts[n]) eat(parts[n], [0.075, 0.06, 0.13][n]);
      // blood on his lips and chin, running further down with every bite
      this.cyStains.add('mouth', mouth, cy.bones.Head, 0.28, 1, 0.6 + n * 0.5);
      if (n === parts.length - 1) { victim.root.visible = false; break; }
      // tear the mouthful off: yank the fist down and away, head jerks back
      if (!(await step(0.35, (k) => { ik.target.lerp(hold(0, side * 2).add(V(0, -0.5, 0)), 0.15); cy.bite = 1 - k * 1.25; }))) break;
      // the torn end sprays as it comes out of his teeth
      const last = wounds[wounds.length - 1];
      if (last && victim.root.visible) { const { at, out } = stump(last.bone); this.gore.gore(at, out.add(V(0, 0.3, 0)), 120, 4.5); }
      this.gore.drip(hand.getWorldPosition(V(0, 0, 0)), 6, 0.4);
      this.cyStains.add('fist', hand.getWorldPosition(V(0, 0, 0)), hand, 0.35, 1, 0.5); // it runs over his knuckles and wrist
      // chew
      const chewDur = 0.8 + Math.random() * 0.5;
      this.audio.sfx?.('chew', { pos: cy.mouthWorld(), vol: 1, rate: 0.55, wet: 0.5 });
      if (!(await step(chewDur, (k, t) => { ik.target.lerp(hold(0.1, side), 0.12); cy.bite = -0.25 * (1 - k); cy.chew = Math.sin(t * 7) * 0.6; }))) break;
    }
    // shot in the hand before he bit: the fist opens and the man falls out alive
    if (alive && (this._handShot || this.cyState.stun > 0)) { cy.bite = cy.chew = 0; await this.releasePrey(victim); return; }
    // swallow and put the arm down
    await this.wait(0.6 * CY_SLOW);
    cy.bite = cy.chew = 0; cy.grip = 0;
    this.killSoldier(victim);
    this.cyMeals++;
    await this.wait(0.9);
    this.endEatCam();
    cy.ik.R = null;
    // full after two men: stay scripted so he doesn't grab a third before lying down
    this.cyState.mode = this.phase === 'night' && this.cyMeals >= 2 ? 'script' : 'tend';
  }

  // the fist opens: the man drops to the floor, lands hard and runs for it
  async releasePrey(victim) {
    const cy = this.cy, r = victim.root;
    this._handShot = false; this._preyAlive = false;
    cy.grip = 0; cy.ik.R = null;
    this.endEatCam();
    victim.state = 'frozen'; // no steering while he falls
    const yaw = Math.atan2(r.position.x - cy.root.position.x, r.position.z - cy.root.position.z);
    const q0 = r.quaternion.clone(), q1 = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0));
    const vel = flat(r.position).sub(flat(cy.root.position)).normalize().multiplyScalar(2.2);
    victim.play('run', 0.1, 2.5);
    this.audio.scream(r.position.clone());
    this.say(`He dropped ${victim.name}! Run!`, 3); crewBark(this, 'dropped', { n: 3, cooldown: 2 });
    for (let t = 0; t < 3; t += 1 / 30) {
      await this.wait(1 / 30);
      vel.y -= 9.8 / 30;
      r.position.addScaledVector(vel, 1 / 30);
      r.quaternion.slerpQuaternions(q0, q1, Math.min(1, t / 0.35));
      const fy = floorHeightAt(r.position.x, r.position.z);
      if (r.position.y <= fy) break;
    }
    r.rotation.set(0, yaw, 0);
    r.position.y = floorHeightAt(r.position.x, r.position.z);
    this.particles.dust(r.position.clone().add(V(0, 0.2, 0)), 10, 1.5);
    this.audio.impact(r.position.clone(), 'flesh');
    this.haptic(60);
    victim.state = 'panic';
    if (this.cyState.mode === 'script') this.cyState.mode = 'tend';
  }

  // the man sits inside the curled fingers: his waist in the hole of the fist, his body running along
  // the fist's axis (index -> pinky), facing the giant. wiggle = struggling sway about his waist
  holdInFist(victim, wiggle = 0) {
    const cy = this.cy, F = cy.rFingers, r = victim.root;
    const P = (b) => b.getWorldPosition(V(0, 0, 0));
    const w = P(cy.bones.RightHand);
    let c, up;
    if (F[1]?.length >= 3 && F[0]?.length && F[3]?.length) {
      const k = P(F[1][0]);
      // centre of the hole the curled fingers make: knuckle, middle-finger joints and the palm
      c = k.clone().add(P(F[1][1])).add(P(F[1][2])).add(w.clone().lerp(k, 0.55)).multiplyScalar(0.25);
      up = P(F[0][0]).sub(P(F[3][0])).normalize();
      if (up.y < 0) up.negate();
      up.lerp(V(0, 1, 0), 0.35).normalize(); // hang a little toward gravity
    } else { c = w; up = V(0, 1, 0); }
    const d = cy.root.position.clone().sub(c); d.addScaledVector(up, -d.dot(up));
    const z = d.lengthSq() > 1e-6 ? d.normalize() : V(0, 0, 1);
    const x = up.clone().cross(z).normalize(); z.crossVectors(x, up);
    r.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, up, z));
    if (wiggle) r.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), wiggle));
    r.position.copy(c);
    const hips = victim.bmap?.hips;
    if (hips) { r.updateMatrixWorld(true); r.position.add(c.clone().sub(P(hips))); }
    else r.position.addScaledVector(up, -0.95);
  }

  // pulled-back cinematic shot of the whole giant while he eats (clear line of sight, not inside rock)
  eatCamFrame() {
    const cy = this.cy, m = cy.mouthWorld(), h = cy.handWorld();
    return m.lerp(h, 0.4).add(V(0, -2.2, 0));
  }
  startEatCam(victim) {
    const cy = this.cy, tgt = this.eatCamFrame();
    const f = V(0, 0, 1).applyQuaternion(cy.root.quaternion).setY(0).normalize(), r = V(0, 1, 0).cross(f);
    // prefer the side the player is on, so the shot reads as "what you are witnessing"
    const ps = Math.sign(this.player.pos.clone().sub(cy.root.position).dot(r)) || 1;
    let best = null;
    for (const dist of [16, 13, 19, 10]) {
      for (const a of [1.1, 0.85, 1.35, 0.55]) for (const sd of [ps, -ps]) {
        const dir = f.clone().multiplyScalar(Math.cos(a)).addScaledVector(r, Math.sin(a) * sd);
        const pos = tgt.clone().addScaledVector(dir, dist); pos.y = Math.max(tgt.y - 2.0, floorHeightAt(pos.x, pos.z) + 1.8);
        if (rockField(pos.x, pos.y, pos.z) > -1.0) continue;
        if (this.physics.raycastSegment(tgt, pos)) continue;
        best = pos; break;
      }
      if (best) break;
    }
    if (!best) return; // nowhere clear to put the camera: stay in the player's view
    this.eatCam = { pos: best, look: tgt.clone(), w: 0, on: true, until: this.time + EAT_CAM_HOLD };
    this._eatLock = !this.player.locked; if (this._eatLock) this.player.locked = true;
  }
  endEatCam() {
    if (!this.eatCam) return;
    this.eatCam.on = false;
    if (this._eatLock) { this.player.locked = false; this._eatLock = false; }
  }
  updateEatCam(dt) {
    const c = this.eatCam; if (!c) return;
    if (c.on && this.time >= c.until) this.endEatCam(); // only a glimpse, then control comes straight back
    c.w = THREE.MathUtils.clamp(c.w + (c.on ? dt / 0.45 : -dt / 0.5), 0, 1);
    if (!c.on && c.w <= 0) { this.eatCam = null; return; }
    c.look.lerp(this.eatCamFrame(), Math.min(1, dt * 1.5));
    const e = c.w * c.w * (3 - 2 * c.w);
    const cam = this.camera, from = cam.position.clone(), fq = cam.quaternion.clone();
    cam.position.lerpVectors(from, c.pos, e);
    cam.lookAt(c.look);
    cam.quaternion.copy(fq.slerp(cam.quaternion.clone(), e));
    cam.fov = THREE.MathUtils.lerp(cam.fov, 50, e); cam.updateProjectionMatrix();
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
    crewBark(this, 'waking', { n: 3 });
    this.scatterCrew();
    this.eyeHits = 0;
    this.cy.eyeOpen = 1;
    await this.standUp();
    this.audio.roar(this.cy.eyeWorld(), { dur: 2.5, vol: 1 });
    this.cyState.mode = 'tend'; this.cyState.alert = 1.2; this.cyState.noiseAt = this.player.pos.clone();
    this.setTension(0.8);
    await this.wait(30);
    if (this.phase === 'sleep' || this.phase === 'stakeHot') {
      this.cyState.mode = 'script';
      const bed = this.bed?.pos || V(-15, 0, -12);
      await this.cyWalkTo(bed, 2);
      this.placeCy(bed);
      this._laid = false;
      await this.lieDown(this.bed?.yaw);
      this.cyState.mode = 'sleep';
      this.eyeHits = 0;
      this.setTension(0.25);
      this.gatherCrew();
    }
  }

  cyThink(dt) {
    const st = this.cyState, P = this.player, cy = this.cy;
    if (st.walkTarget || st.grabbing || this._eating) st.busyBefore = true;
    if (!st.grabbing && !this._eating && !P.grabbed) cy.forceSquat = 0;
    else if (P.grabbed) cy.forceSquat = 0.3;
    if (st.stun > 0) {
      st.stun -= dt;
      cy.play('idle', 0.3, 2.2);
      cy.eyeOpen = 0;
      if (st.eyePain > 0) {
        // shot in the eye: he drops into a crouch, both hands clamped over the eye, rocking in pain
        st.eyePain -= dt;
        const k = Math.min(1, st.eyePain / 0.8);               // rises again over the last 0.8 s
        cy.forceSquat = 0.85 * k; cy.squatRate = 7;
        cy.writhe = k;
        const eye = cy.eyeWorld(), f = V(Math.sin(cy.root.rotation.y), 0, Math.cos(cy.root.rotation.y)), r = V(f.z, 0, -f.x);
        const hk = cy.height / 13;
        cy.ik.R = { target: eye.clone().addScaledVector(f, 0.9 * hk).addScaledVector(r, -0.35 * hk), w: 0.95 * k };
        cy.ik.L = { target: eye.clone().addScaledVector(f, 0.9 * hk).addScaledVector(r, 0.35 * hk).add(V(0, -0.3 * hk, 0)), w: 0.95 * k };
        if (Math.random() < dt * 0.6) this.audio.cyGroan?.(eye, { vol: 0.9 });
        if (st.eyePain <= 0 || st.stun <= 0) { st.eyePain = 0; cy.writhe = 0; cy.forceSquat = 0; cy.squatRate = 1.2; cy.ik.R = null; cy.ik.L = null; }
      }
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
      // his men first: while crewmen are within reach he goes for them, not for Odysseus (unless you are right under his hand)
      const prey = st.mode === 'tend' && !(this.phase === 'night' && this.cyMeals >= 2) && st.alert > 1 && !st.grabbing && !this._eating && this.time > (st.eatCd || 0) ? this.crewPrey(18) : null;
      if (prey && !(dP < 4 && !P.hiddenInStraw)) { st.alert = 0.6; st.walkTarget = null; this.cyEat(prey); }
      else if (st.alert > 1 && st.noiseAt && !st.grabbing) {
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
      } else if (!st.walkTarget && !st.grabbing && !this._eating && !st.fidget) {
        // idle behaviour: after every action a pause / fidget, then tend the fire / wander (blind: grope around)
        if (st.busyBefore) { st.busyBefore = false; st.idleT = 0.6 + Math.random() * 0.8; st.fidgetNext = true; }
        st.idleT = (st.idleT || 0) - dt;
        if (st.idleT < 0 && st.fidgetNext && st.alert < 0.35) { st.fidgetNext = false; this.cyFidget(); }
        else if (st.idleT < 0) {
          st.fidgetNext = true;
          st.idleT = 6 + Math.random() * 8;
          const home = st.home || V(-3, 0, 1);
          const a = Math.random() * 6.28, r = 3 + Math.random() * 7;
          const x = home.x + Math.cos(a) * r, z = home.z + Math.sin(a) * r;
          if (this.nav.giant.clear(x, z)) { st.walkTarget = V(x, 0, z); st.walkSpeed = st.mode === 'blind' ? 1.6 : 1.5; }
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
    crewBark(this, 'spotted', { n: 3 });
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
  // which hit zone of the giant a segment passes through (eye wins), or null
  zoneAlong(a, b) {
    if (!this.cy.root.visible) return null;
    const seg = new THREE.Line3(a, b), cp = V(0, 0, 0);
    let best = null;
    for (const z of this.cy.zones) {
      seg.closestPointToPoint(z.world, true, cp);
      const d = cp.distanceTo(z.world);
      if (d < z.r && (!best || (z.name === 'eye') || d / z.r < best.k)) { best = { z, k: d / z.r, at: cp.clone() }; if (z.name === 'eye') break; }
    }
    return best;
  }

  projectileHit(a, b, p) {
    const best = this.zoneAlong(a, b);
    if (!best) return false;
    const st = this.cyState;
    const dir = b.clone().sub(a).normalize();
    if (best.z.name === 'eye' && !this.cy.blind) {
      this.arrowFx.impact(best.at, null, p);
      if (this.audio.fleshHit && this.audio.S?.('flesh')) this.audio.fleshHit(best.at, { crit: true }); else this.audio.impact(best.at, 'flesh');
      // a huge scream: the roar, a shriek on top, a second wail as he doubles over
      this.audio.roar(best.at, { dur: 4, vol: 1.9, pain: true, pitch: 1.2 });
      this.audio.cyShriek?.(best.at, { vol: 1.5 });
      this.audio.cyGroan?.(best.at, { vol: 1.3, when: 1.6 });
      this.audio.cyShriek?.(best.at, { vol: 1.1, when: 2.4 });
      this.audio.boom?.('impact', 1.1);
      this.particles.blood(best.at, dir.clone().negate(), 160, 4);
      this.hitFlash(true);
      st.stun = p.kind === 'spear' ? 6 : 4.5;
      st.eyePain = st.stun;
      this.cy.ik.R = null; this.cy.ik.L = null;
      this.cy.jolt = 1; this.cy.joltSide = Math.random() < 0.5 ? -1 : 1;
      this.player.shake = 1.4;
      this.say('Hit the eye! Get away while you can', 2.5);
      this.hitMarker(true);
      if (st.mode === 'sleep') this.wakeUp();
    } else {
      this.arrowFx.impact(best.at, null, p);
      this.audio.impact(best.at, 'flesh');
      this.particles.blood(best.at, dir.clone().negate(), 55, 2.6);
      this.hitMarker(false);
      this.hitFlash(false);
      this.player.shake = Math.max(this.player.shake, 0.35);
      // arrows stick in the giant: the tip goes in at the skin, the shaft and fletching stay out
      const stuck = this.stickInGiant(p, best, a, dir);
      // the body jerks away from the arrow every time (even mid-volley)
      if (!this.cy.blind || st.mode !== 'script') { this.cy.jolt = 1; this.cy.joltSide = dir.x * Math.cos(this.cy.root.rotation.y) - dir.z * Math.sin(this.cy.root.rotation.y) > 0 ? 1 : -1; }
      st.alert = Math.min(2, st.alert + 0.8); st.noiseAt = this.player.pos.clone();
      const wasAsleep = st.mode === 'sleep';
      // shot the fist that holds a man: he lets go
      const fistHit = best.z.obj === this.cy.bones.RightHand || best.z.obj === this.cy.bones.RightForeArm;
      if (fistHit && this._eating && this._preyAlive && this.cy.grip > 0 && !this._handShot) {
        this._handShot = true;
        this.popText('HE LET GO');
        this.audio.roar(stuck, { dur: 1.8, vol: 1.7, pitch: 1.15, pain: true });
      }
      // every hit hurts: he cries out, flinches and clutches the wound (not on every arrow of a quick volley)
      if (this.time > (this._groanT || 0)) {
        this._groanT = this.time + 1.6;
        this.audio.roar(stuck, { dur: 2.4, vol: 1.6, pitch: 1.05, pain: true });
        this.audio.cyShriek?.(stuck, { vol: 1.0, when: 0.05 });  // a high, strangled yelp on top
        this.audio.cyGroan?.(stuck, { vol: 0.9, when: 1.1 + Math.random() * 0.4 }); // a second, lower groan as he holds it
        if (!wasAsleep) this.cyHurt(best.z, stuck);
      }
      if (wasAsleep) this.wakeUp();
    }
    return true;
  }

  // stick a copy of the projectile into the giant's skin (ray vs the skinned mesh), wound decal included.
  // returns the world point where it went in
  stickInGiant(p, best, a, dir) {
    const cy = this.cy;
    let at = cy.surfaceHit(a, dir, a.distanceTo(best.at) + best.z.r * 2);
    if (!at) at = cy.surfaceHit(best.at.clone().addScaledVector(dir, -best.z.r * 1.6), dir, best.z.r * 3.2);
    if (!at) at = best.at.clone();
    const bone = at.bone || best.z.obj; // attach to the bone that actually moves that skin
    const m = p.mesh.clone();
    if (p.glow) m.remove(m.children[m.children.length - 1]); // the flight glow sprite stays with the flying arrow
    const S = p.kind === 'arrow' ? 3.6 : 1.3;
    m.scale.setScalar(S);
    // arrow tip sits at +0.43 (spear +1.26): bury about a third of it
    const tipZ = p.kind === 'arrow' ? 0.43 : 1.26, buried = p.kind === 'arrow' ? 0.3 : 0.7;
    m.position.copy(at).addScaledVector(dir, -(tipZ - buried) * S);
    m.lookAt(m.position.clone().add(dir));
    this.scene.add(m); m.updateMatrixWorld(true); bone.attach(m);
    // a dark wound where it went in
    const w = new THREE.Mesh(new THREE.CircleGeometry(0.16 + Math.random() * 0.06, 10), this._woundMat ||= new THREE.MeshStandardMaterial({ color: 0x5a0805, roughness: 0.2, polygonOffset: true, polygonOffsetFactor: -2 }));
    w.position.copy(at).addScaledVector(dir, -0.02); w.lookAt(at.clone().sub(dir));
    this.scene.add(w); w.updateMatrixWorld(true); bone.attach(w);
    // a marker at the wound that follows the bone, so the hand can find it while he moves
    const mark = new THREE.Object3D(); mark.position.copy(at).addScaledVector(dir, -0.55 * (cy.height / 13));
    this.scene.add(mark); mark.updateMatrixWorld(true); bone.attach(mark);
    this._lastWound = { mark, zone: best.z };
    this.addBleed(bone, at, dir);
    return at;
  }

  // an open wound around the shaft: pulsing spurts at first, then a trickle running down the skin and dripping
  addBleed(bone, at, dir) {
    const out = dir.clone().negate();
    // points that ride on the bone: the wound mouth (just outside the skin) and one a bit further out along the shaft
    const mouth = new THREE.Object3D(); mouth.position.copy(at).addScaledVector(out, 0.06);
    const ahead = new THREE.Object3D(); ahead.position.copy(at).addScaledVector(out, 1);
    for (const o of [mouth, ahead]) { this.scene.add(o); o.updateMatrixWorld(true); bone.attach(o); }
    // a run of blood down the skin: blobs projected onto the body below the wound, revealed one by one as it trickles down
    const down = new THREE.Vector3(0, -1, 0).addScaledVector(out, out.y).normalize();
    const side = new THREE.Vector3().crossVectors(out, down).normalize();
    const run = [], step = 0.26 * (this.cy.height / 13), n = 7 + ((Math.random() * 5) | 0);
    let wig = 0;
    for (let i = 0; i < n; i++) {
      wig += (Math.random() - 0.5) * 0.12;
      const probe = at.clone().addScaledVector(down, step * (i + 0.5)).addScaledVector(side, wig).addScaledVector(out, 2.5);
      const hit = this.cy.surfaceHit(probe, out.clone().negate(), 4);
      if (!hit) break;
      const blob = new THREE.Mesh(this._blobGeo ||= new THREE.PlaneGeometry(1, 1), this._streakMat ||= this.makeStreakMat());
      blob.position.copy(hit).addScaledVector(out, 0.05);
      blob.up.copy(down).negate(); blob.lookAt(blob.position.clone().add(out));
      const w = (0.3 - i * 0.012) * (0.8 + Math.random() * 0.4);
      blob.scale.set(w, step * 1.6, 1); blob.visible = false; blob.renderOrder = 2;
      this.scene.add(blob); blob.updateMatrixWorld(true); (hit.bone || bone).attach(blob);
      run.push(blob);
    }
    (this.bleeds ||= []).push({ mouth, ahead, run, t: 0, beat: Math.random() * 6 });
    if (this.bleeds.length > 14) this.bleeds.shift(); // oldest wounds just stop bleeding; the arrow stays
  }

  makeStreakMat() {
    // one soft, slightly glossy vertical smear; overlapping ones make a continuous run
    const c = document.createElement('canvas'); c.width = 64; c.height = 128; const g = c.getContext('2d');
    for (let i = 0; i < 3; i++) {
      const x = 32 + (Math.random() - 0.5) * 10, w = 16 + Math.random() * 10;
      const gr = g.createRadialGradient(x, 64, 2, x, 64, 60); gr.addColorStop(0, 'rgba(120,6,4,0.95)'); gr.addColorStop(0.6, 'rgba(100,5,3,0.8)'); gr.addColorStop(1, 'rgba(90,4,2,0)');
      g.fillStyle = gr; g.beginPath(); g.ellipse(x, 64, w, 60, 0, 0, 6.28); g.fill();
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshStandardMaterial({ map: t, transparent: true, depthWrite: false, roughness: 0.15, emissive: 0x1a0000, polygonOffset: true, polygonOffsetFactor: -3 });
  }

  updateBleeds(dt) {
    if (!this.bleeds?.length || !this.cy.root.visible) return;
    const p = new THREE.Vector3(), q = new THREE.Vector3(), d = new THREE.Vector3();
    for (const b of this.bleeds) {
      b.t += dt;
      b.mouth.getWorldPosition(p); b.ahead.getWorldPosition(q); d.subVectors(q, p).normalize();
      // first ~3 s: heartbeat spurts out of the wound
      if (b.t < 3) {
        const beat = Math.max(0, Math.sin((b.t + b.beat) * 7.5)) ** 3 * (1 - b.t / 3);
        this.particles.spurt(p, d.clone().add(new THREE.Vector3(0, -0.4, 0)), beat * 1.3, 2.4);
      }
      // then a steady trickle that slows over a minute but never quite stops while the arrow is in
      const rate = Math.max(1.2, 10 * Math.exp(-b.t / 25));
      b.acc = (b.acc || 0) + rate * dt;
      while (b.acc > 1) { b.acc -= 1; this.particles.drip(p.clone().add(new THREE.Vector3(0, -0.15, 0)), 1, 0.2, 2.6); }
      // the streak runs down the skin
      for (let i = 0; i < b.run.length; i++) if (!b.run[i].visible && b.t > 0.3 + i * 0.35) b.run[i].visible = true;
    }
  }

  // idle fidgets between actions: stand still and look around, scratch his backside, pick his nose, or sit down for a while
  async cyFidget(kind) {
    const st = this.cyState, cy = this.cy, H = cy.height, km = H / 1.95;
    if (st.fidget || st.lying) return;
    kind ||= ['pause', 'scratch', 'nose', 'sit', 'scratch', 'nose', 'sit'][(Math.random() * 7) | 0];
    if (st.mode === 'blind' && kind === 'nose') kind = 'scratch';
    st.fidget = kind;
    const V3 = () => new THREE.Vector3();
    const stop = () => st.alert > 0.6 || st.stun > 0 || st.hurt > 0 || st.walkTarget || st.grabbing || this._eating || this.player.grabbed || !(st.mode === 'tend' || st.mode === 'blind');
    const fwd = () => V3().set(Math.sin(cy.root.rotation.y), 0, Math.cos(cy.root.rotation.y));
    const rightOf = () => cy.bones.RightUpLeg.getWorldPosition(V3()).sub(cy.bones.Hips.getWorldPosition(V3())).setY(0).normalize();
    let ik = null, side = 'R';
    const grab = (sd) => { if (cy.ik[sd]) return null; side = sd; ik = cy.ik[sd] = { target: cy.handWorld(sd), w: 0, free: true, noSquat: true }; return ik; };
    const release = async () => {
      for (let t = 0; t < 0.5 && ik && cy.ik[side] === ik; t += 1 / 30) { ik.w = Math.max(0, ik.w - 1 / 15); await this.wait(1 / 30); }
      if (ik && cy.ik[side] === ik) cy.ik[side] = null;
    };
    try {
      if (kind === 'pause') {
        // stand and look slowly left and right
        const dur = 2.5 + Math.random() * 2.5, h0 = st.heading;
        for (let t = 0; t < dur && !stop(); t += 1 / 30) { await this.wait(1 / 30); st.heading = h0 + Math.sin(t * 1.3) * 0.5; }
        st.heading = h0;
      } else if (kind === 'scratch') {
        // reach round behind and scratch the backside
        const sd = Math.random() < 0.5 ? 'R' : 'L';
        if (!grab(sd)) return;
        const dur = 2.8 + Math.random() * 1.5;
        for (let t = 0; t < dur && !stop() && cy.ik[side] === ik; t += 1 / 30) {
          await this.wait(1 / 30);
          const hips = cy.bones.Hips.getWorldPosition(V3()), rt = rightOf().multiplyScalar(sd === 'R' ? 1 : -1);
          ik.target.copy(hips).addScaledVector(fwd(), -0.16 * km).addScaledVector(rt, 0.075 * km).add(V3().set(0, -0.07 * km + Math.sin(t * 16) * 0.035 * km, 0));
          ik.w = Math.min(1, t / 0.6);
          cy.lookAt = null;
        }
        await release();
      } else if (kind === 'nose') {
        // finger up the nose, dig around, then look at what he found and flick it away
        if (!grab('R')) return;
        const dur = 4 + Math.random() * 1.5;
        const nose = () => cy.eyeGroup.localToWorld(V3().set(0, -0.075, 0.03));
        for (let t = 0; t < dur && !stop() && cy.ik.R === ik; t += 1 / 30) {
          await this.wait(1 / 30);
          const f = fwd();
          if (t < dur - 1.6) {
            ik.target.copy(nose()).addScaledVector(f, 0.07 * km).add(V3().set(Math.sin(t * 9) * 0.01 * km, -0.1 * km + Math.cos(t * 11) * 0.012 * km, 0));
            cy.lookAt = null;
          } else {
            // hand out in front of the eye: inspect, then a flick
            const k = t - (dur - 1.6);
            ik.target.copy(cy.eyeWorld()).addScaledVector(f, 0.28 * km).add(V3().set(0, -0.12 * km + (k > 1.2 ? Math.sin((k - 1.2) * 20) * 0.04 * km : 0), 0));
            cy.lookAt = ik.target.clone().add(V3().set(0, 0.08 * km, 0));
          }
          ik.w = Math.min(1, t / 0.7); cy.point = ik.w;
        }
        cy.lookAt = null; cy.point = 0;
        await release();
      } else if (kind === 'sit') {
        // sit down on the floor for a while, hands resting on the knees
        if (cy._hipH == null || cy._hipH === H * 0.5) cy._hipH = cy.bones.Hips.getWorldPosition(V3()).y - cy.root.position.y;
        cy.sitTarget = 1;
        this.audio.stomp?.(cy.root.position, 0.4);
        const dur = 7 + Math.random() * 6;
        for (let t = 0; t < dur && !stop(); t += 1 / 30) {
          await this.wait(1 / 30);
          if (t > 2.2 && !st._sitThud) { st._sitThud = true; this.stomp(); }
        }
        st._sitThud = false;
        cy.sitTarget = 0;
        await this.until(() => (cy.sitW || 0) < 0.15);
      }
    } finally {
      if (cy.ik[side] === ik && ik) cy.ik[side] = null;
      if (kind === 'nose') { cy.lookAt = null; cy.point = 0; }
      if (kind === 'sit') cy.sitTarget = 0;
      st.fidget = null;
      st.idleT = Math.min(st.idleT || 0, 1 + Math.random() * 2);
    }
  }

  // pain reaction: flinch, stop for a moment, and press a free hand over the arrow
  async cyHurt(zone, at) {
    const cy = this.cy, st = this.cyState;
    if (st.lying || st.stun > 0 || this.cy.blind && st.mode === 'script') return;
    st.hurt = 1.6;
    cy.hurt = 1;
    const mark = this._lastWound?.mark;
    if (!mark) return;
    // which hand: never the arm that was hit, never a hand that is busy grabbing / eating
    const hitRight = at.distanceTo(cy.bones.RightArm.getWorldPosition(new THREE.Vector3())) < at.distanceTo(cy.bones.LeftArm.getWorldPosition(new THREE.Vector3()));
    let side = hitRight ? 'R' : 'L';
    if (zone.name === 'arm') side = zone.obj === cy.bones.RightArm || zone.obj === cy.bones.RightForeArm ? 'L' : 'R';
    const busy = (s) => !!cy.ik[s] || (s === 'R' && (st.grabbing || this._eating || this.player.grabbed || this._sweeping));
    if (busy(side)) side = side === 'R' ? 'L' : 'R';
    if (busy(side)) return;
    const ik = (cy.ik[side] = { target: mark.getWorldPosition(new THREE.Vector3()), w: 0 });
    const dur = 2.2;
    for (let t = 0; t < dur; t += 1 / 30) {
      await this.wait(1 / 30);
      if (cy.ik[side] !== ik) return; // something else took the arm (a grab): let it
      mark.getWorldPosition(ik.target);
      ik.w = Math.min(1, t / 0.3) * Math.min(1, (dur - t) / 0.5);
    }
    if (cy.ik[side] === ik) cy.ik[side] = null;
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
      prompt = '[E] Pull the burning brand from the fire';
      if (I.pressed('KeyE')) {
        P.setCarry(log.obj); log.obj.visible = false; this.stakeHeat = 1; this.carryMeshGlow = -1;
        this.setPhase('stakeHot'); this.say('It\'s burning. Wake that eye, then put it out', 3, 'Odysseus');
      }
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
    if (P.carrying && this.stakeHeat >= 1 && (this.cyState.mode === 'sleep' || this.cyState.mode === 'dazed') && !this._striking) {
      const eye = this.cy.eyeWorld();
      if (flat(pp).distanceTo(flat(eye)) < 3.4) {
        const open = this.cyState.mode === 'dazed';
        prompt = open ? '[E] Drive the burning brand into his eye' : '[E] Strike his eyelid with the brand';
        if (I.pressed('KeyE')) { if (open) this.stabEye(); else this.hitEye(); }
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
    const giantIn = this.cy.root.visible;
    updateSquad(this, dt);
    for (const s of this.soldiers) {
      if (!s.alive) continue;
      if (s.cower && updateCower(this, s, dt)) continue;
      s.mixer.update(dt);
      if (s.state === 'grabbed') continue;
      const r = s.root;
      let target = null, speed = 1.2, anim = 'idle';
      if (s.state === 'fight') { const f = squadStep(this, s, dt); target = f.target; speed = f.speed || speed; anim = f.anim; }
      else if (s.state === 'frozen') { anim = 'sneak_pose'; const d = flat(cp).sub(flat(r.position)); r.rotation.y = Math.atan2(d.x, d.z); }
      else if (s.state === 'gather') {
        // crowd round the sleeping giant's face, tiptoeing in and then holding still, staring at the eye
        if (s.gatherAt && flat(r.position).distanceTo(flat(s.gatherAt)) > 0.5) { target = s.gatherAt; speed = 1.0; anim = 'walk'; }
        else { anim = 'sneak_pose'; const e = this.cy.eyeWorld(), d = flat(e).sub(flat(r.position)); const h = Math.atan2(d.x, d.z); let dh = h - r.rotation.y; dh = Math.atan2(Math.sin(dh), Math.cos(dh)); r.rotation.y += dh * Math.min(1, dt * 4); }
      }
      else if (s.state === 'hide' || s.state === 'panic') {
        // keep away from the giant, press against the east wall
        const away = flat(r.position).sub(flat(cp)); const d = away.length();
        // hysteresis: start running below 11 m, keep going until 14 m (else he dithers on the 11 m line: run out, walk back, run out)
        s.scared = this.cy.root.visible && d < (s.scared ? 14 : 11);
        if (s.scared) { target = r.position.clone().add(away.normalize().multiplyScalar(3)); speed = s.state === 'panic' ? 4.5 : 3.5; anim = 'run'; }
        else if (r.position.distanceTo(s.home) > 1) { target = s.home; speed = 1.4; anim = 'walk'; }
        else anim = this.cy.root.visible ? 'sneak_pose' : 'idle';
      } else if (s.state === 'crawlOut') {
        s.crawlDelay -= dt;
        anim = 'sneak_pose';
        if (s.crawlDelay < 0) { target = this.flock.exitPoint ? this.flock.exitPoint.clone() : null; speed = 1.1; anim = 'walk'; }
        if (r.position.z > this.world.doorClosed.z + 3) { r.visible = false; s.escaped = true; continue; }
      } else if (this.phase === 'intro') {
        // raiding the cheese: reaching for the sacks or eating round the wheels
        const c = cheeseStep(this, s, dt); target = c.target; speed = c.speed || speed; anim = c.anim;
      }
      if (target) {
        const d = flat(target).sub(flat(r.position)); const dist = d.length();
        if (dist > 0.3) {
          // walk the grid path (slides along walls, never into the rock)
          const wp = navSeek(this.nav.man, s, r.position, target, dt, 0.4);
          d.set(wp[0] - r.position.x, 0, wp[1] - r.position.z);
          const wl = d.length();
          if (wl > 1e-4) d.divideScalar(wl);
          const stepLen = Math.min(speed * dt, wl);
          const ox = r.position.x, oz = r.position.z;
          if (s.state === 'crawlOut' && r.position.z > this.world.doorClosed.z) { r.position.x += d.x * stepLen; r.position.z += d.z * stepLen; } // out in the slot, beyond sight
          else this.nav.man.step(r.position, d.x * stepLen, d.z * stepLen);
          r.position.y = this.nav.man.floorY(r.position.x, r.position.z) ?? floorHeightAt(r.position.x, r.position.z);
          // stuck detection: if he barely moved for a while, give up on this target
          const moved = Math.hypot(r.position.x - ox, r.position.z - oz);
          s.stuckT = moved < speed * dt * 0.3 ? (s.stuckT || 0) + dt : 0;
          // (in a fight the squad keeps re-issuing the same blocked post: pick a new one instead of flashing one idle frame
          // between run cycles every 0.6 s)
          if (s.stuckT > 0.6) {
            s.stuckT = 0; s.goal = null; s.path = null;
            if (s.state === 'fight') { s.post = null; s.postT = 0; }
            else { s.home = r.position.clone(); anim = s.state === 'crawlOut' ? 'sneak_pose' : 'idle'; }
          }
          // face where he is really going (smoothed velocity), not the raw waypoint: sliding along a wall
          // or a path corner flips the waypoint direction frame to frame and made him shiver on the spot
          if (moved > 1e-4) { const k = Math.min(1, dt * 8); s._vx = (s._vx || 0) * (1 - k) + (r.position.x - ox) / dt * k; s._vz = (s._vz || 0) * (1 - k) + (r.position.z - oz) / dt * k; }
          const fx = Math.hypot(s._vx || 0, s._vz || 0) > 0.2 ? s._vx : d.x, fz = Math.hypot(s._vx || 0, s._vz || 0) > 0.2 ? s._vz : d.z;
          if (!giantIn) { const h = Math.atan2(fx, fz); let dh = h - r.rotation.y; dh = Math.atan2(Math.sin(dh), Math.cos(dh)); r.rotation.y += dh * Math.min(1, dt * 6); }
        }
      }
      // once the giant is inside, every man keeps his eyes on him whatever he is doing (backs away, sidesteps, charges)
      s.back = false;
      if (giantIn) {
        const g = flat(cp).sub(flat(r.position)), h = Math.atan2(g.x, g.z);
        let dh = h - r.rotation.y; dh = Math.atan2(Math.sin(dh), Math.cos(dh)); r.rotation.y += dh * Math.min(1, dt * 8);
        const vx = s._vx || 0, vz = s._vz || 0, vl = Math.hypot(vx, vz);
        s.back = vl > 0.3 && (vx * Math.sin(r.rotation.y) + vz * Math.cos(r.rotation.y)) / vl < -0.3; // moving away from where he looks
      }
      let sp = Math.hypot(r.position.x - (s._px ?? r.position.x), r.position.z - (s._pz ?? r.position.z)) / Math.max(dt, 1e-4);
      s._px = r.position.x; s._pz = r.position.z;
      if (sp > 12) sp = 0; // teleported (body swap, checkpoint)
      // low-passed speed + on/off hysteresis: one blocked frame must not flip walk -> idle -> walk
      s._sp = (s._sp ?? sp) + (sp - (s._sp ?? sp)) * Math.min(1, dt * 6);
      if (!target) s._sp = Math.min(s._sp, sp); // stopped on purpose: settle at once
      s._moving = s._sp > (s._moving ? 0.12 : 0.35);
      if (!s._moving) { s._vx = 0; s._vz = 0; }
      if ((anim === 'walk' || anim === 'run') && !s._moving) anim = s.state === 'crawlOut' ? 'sneak_pose' : 'idle';
      const rate = anim === 'walk' ? Math.max(0.5, s._sp / 1.3) : anim === 'run' ? Math.max(0.6, s._sp / 4) : 1;
      s.play(anim, 0.3, s.back && (anim === 'walk' || anim === 'run') ? -rate : rate); // backpedal: gait played in reverse
      if (s.state === 'crawlOut') { r.scale.y = r.scale.x * 0.6; } // hunched under straw
      if (s.chore && this.phase === 'intro' && s.state === 'idle') { s.mixer.update(0); poseCheese(this, s, t); }
      if (s.torchLight) s.torchLight.intensity = 16 + Math.sin(t * 17 + s.home.x) * 3;
    }
    updateCrewFight(this);
    poseLeader(this);
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

  // first blow: a whack on the lid with the brand. the eye snaps open, dazed; a few seconds to finish it
  async hitEye() {
    if (this._striking) return; this._striking = true;
    const st = this.cyState, eye = this.cy.eyeWorld();
    st.mode = 'dazed';
    this.eyeHits = 1;
    this.haptic([40, 30, 60]);
    this.audio.sfx?.('hitPunch', { pos: eye, vol: 0.9, rate: 0.8 });
    this.audio.cyGroan?.(eye, { vol: 0.5 });
    this.particles.sparks(eye, 40);
    this.player.shake = Math.max(this.player.shake, 0.4);
    this.cy.eyeOpen = 1;
    this.say('His eye is open! Now!', 2, 'Eurylochus');
    crewBark(this, 'spotted', { n: 2 });
    this._striking = false;
    const t0 = this.time;
    await this.until(() => st.mode !== 'dazed' || this.time - t0 > 4.5);
    if (st.mode === 'dazed') { st.mode = 'sleep'; this.wakeUp(); } // too slow: he comes round
  }

  // second blow: the burning point goes into the open eye
  async stabEye() {
    if (this._striking) return; this._striking = true;
    const P = this.player, eye = this.cy.eyeWorld();
    this.cyState.mode = 'script';
    P.locked = true;
    const side = V(-Math.sin(P.yaw), 0, -Math.cos(P.yaw));
    this.camOverride = eye.clone().addScaledVector(side, -3.4).add(V(0.8, 1.8, 0)); this.camTarget = eye.clone();
    this.slowPunch = 2.2;
    await this.wait(0.35);
    this.slowPunch = 0; this.camOverride = null; this.camTarget = null; P.locked = false; this._striking = false;
    this.haptic([60, 40, 160]);
    this.blindCyclops();
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
    // bow focus: edge blur + a darker vignette while drawing
    const foc = this.player.focus || 0;
    if (this.post.edgePass) {
      this.post.edgePass.enabled = foc > 0.01;
      this.post.edgeBlur.uniforms.get('uAmt').value = foc;
      this.post.edgeBlur.uniforms.get('uAspect').value = this.camera.aspect;
    }
    this.post.vignette.darkness = 0.72 + this._slowFx * 0.2 + foc * 0.18;
    this.post.ca.offset.set(0.0006 + this._slowFx * 0.0022, 0.0004 + this._slowFx * 0.0014);
    if (this.post.caPass) this.post.caPass.enabled = this._slowFx > 0.02 || !!this.photo?.on;
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

  // a red pulse at the screen edges + a white pop so a hit on the giant is unmistakable
  hitFlash(critical) {
    let el = this._hitFlashEl;
    if (!el) { el = this._hitFlashEl = document.createElement('div'); el.id = 'hitflash'; document.getElementById('hud').appendChild(el); }
    el.classList.remove('on', 'crit'); void el.offsetWidth;
    el.classList.add('on'); if (critical) el.classList.add('crit');
    const fl = this.post.grade.uniforms.get('uFlash'); fl.value = Math.max(fl.value, critical ? 0.3 : 0.12);
  }
  hitMarker(critical) {
    this.slowPunch = Math.max(this.slowPunch || 0, critical ? 0.3 : 0.12); // hit-stop
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
    if (this.help?.on && this.started) { this.timeScale = 0; this.input.endFrame(); return; }
    this.updateBulletTime(dtReal);
    if (!this.started) { this.cy.update(dt); return; }
    this.time += dt; this.phaseT += dt;
    // resolve waits
    const done = this.tasks.filter((k) => (k.t !== undefined ? this.time >= k.t : k.fn()));
    this.tasks = this.tasks.filter((k) => !done.includes(k));
    done.forEach((k) => k.r());

    this.wheel.update(this.input);
    // the giant looming over you: tell the camera so it can pull back and show more than his feet
    { const cyOn = this.cy.root.visible && this.cyState.mode !== 'sleep';
      const d = cyOn ? flat(this.cy.root.position).distanceTo(flat(this.player.pos)) : 99;
      this.player.giantNear = 1 - THREE.MathUtils.smoothstep(d, 7, 18); }
    this.player.update(dt, t, dtReal);
    if (this.camOverride) { this.camera.position.copy(this.camOverride); this.camera.lookAt(this.camTarget); }
    else this.updateEatCam(dt);
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
      // in the entrance tunnel the giant stoops a little
      const cz = this.cy.root.position.z, wantCrouch = this.cy.noDuck ? 0 : THREE.MathUtils.smoothstep(cz, 12.3, 14.3);
      this.cy.crouch = (this.cy.crouch || 0) + (wantCrouch - (this.cy.crouch || 0)) * Math.min(1, dt * 3);
      this.cy.crouchDepth = 0.35; // the widened entrance only needs a slight stoop
      this.cyThink(dt);
      this.cy.update(dt);
    }
    this.doorShut = this.world.boulder.position.distanceTo(this.world.doorClosed) < 2;
    this.updateSoldiers(dt, t);
    this.flock.update(dt, t, { player: this.player, cyclops: this.cy, nav: this.nav.man });
    this.frameNo = (this.frameNo || 0) + 1;
    this.updateBleeds(dt);
    this.particles.update(dt);
    this.gore.update(dt);
    this.arrowFx.update(dt);
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
    this.hud.cross.classList.toggle('full', P.drawing && P.draw >= 0.999);
    { const z = this.arrowFx.aimZone, c = this.hud.cross;
      c.classList.toggle('weak', z === 'eye'); c.classList.toggle('head', z === 'head'); c.classList.toggle('onbody', !!z && z !== 'eye' && z !== 'head'); }
    this.updateStaminaWheel();
    this.input.endFrame();
  }
}
