// Recorded sound effects (Freesound, CC0; see public/assets/sfx/CREDITS.md).
// Loaded in the background after the audio context starts. Every sound falls back to the
// procedural version (audio.js / foley.js) until its samples are decoded.
const BASE = (import.meta.env?.BASE_URL || '/') + 'assets/sfx/';
const R = (a, b) => a + Math.random() * (b - a);

// foley names -> recorded sample sets, with a playback-rate tweak when the sample is used
const ALIAS = { pantIn: 'pant', pantOut: 'pant', giantIn: 'giantBreath', giantOut: 'giantBreath', gasp: 'hurt' };
const RATE = { giantIn: 0.6, giantOut: 0.55, snore: 0.62, creak: 1.25 };
const VOL = { walk: 1.1, run: 1.0, sneak: 0.9, pantIn: 0.8, pantOut: 0.8, giantIn: 1.2, giantOut: 1.2, snore: 1.0, rustle: 0.8, drag: 1.0, scrape: 0.9 };

export function installSamples(Audio) {
  const P = Audio.prototype;

  P.loadSamples = async function () {
    if (this._samplesLoading || !this.ctx) return;
    this._samplesLoading = true;
    this.samples = {};
    let manifest;
    try { manifest = await (await fetch(BASE + 'manifest.json')).json(); } catch (e) { console.warn('sfx manifest missing', e); return; }
    // loops and frequent sounds first
    const order = Object.keys(manifest).sort((a, b) => (/Loop$/.test(b) ? 1 : 0) - (/Loop$/.test(a) ? 1 : 0));
    await Promise.all(order.map(async (key) => {
      const bufs = [];
      for (const f of manifest[key]) {
        try { const ab = await (await fetch(BASE + f)).arrayBuffer(); bufs.push(await this.ctx.decodeAudioData(ab)); } catch (e) { /* skip */ }
      }
      if (bufs.length) { this.samples[key] = bufs; if (/Loop$/.test(key)) this.startLoop(key); }
    }));
  };
  P.S = function (key) { const l = this.samples?.[key]; return l && l.length ? l : null; };
  P.pick = function (key) {
    const l = this.S(key); if (!l) return null;
    // avoid repeating the same take twice in a row
    let i = (Math.random() * l.length) | 0; const last = (this._lastPick ||= {})[key];
    if (l.length > 1 && i === last) i = (i + 1) % l.length;
    this._lastPick[key] = i; return l[i];
  };
  // one-shot sample with distance attenuation, pan and room send
  P.playS = function (key, { pos = null, vol = 1, rate = 1, wet = 0.4, pan = 0, minG = 0, when = 0, dur = 0, lp = 0 } = {}) {
    const b = this.pick(key); if (!b) return null;
    const { g: sg, pan: sp } = pos ? this.spatial(pos) : { g: 1, pan: 0 };
    const gain = vol * Math.max(minG, sg);
    if (gain < 0.004) return null;
    if ((this._voices || 0) > 64 && vol < 0.6) return null;
    const ctx = this.ctx, t = ctx.currentTime + when;
    const s = ctx.createBufferSource(); s.buffer = b; s.playbackRate.value = rate;
    const g = ctx.createGain(); g.gain.setValueAtTime(gain, t);
    let n = s;
    if (lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; n.connect(f); n = f; }
    n.connect(g); this.out(g, wet, pos ? sp : pan);
    this._voices = (this._voices || 0) + 1; s.onended = () => { this._voices--; g.disconnect(); };
    s.start(t);
    if (dur && dur < b.duration / rate) { g.gain.setValueAtTime(gain, t + dur * 0.75); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); s.stop(t + dur + 0.05); }
    return s;
  };

  // --- ambience beds -------------------------------------------------------------------
  P.startLoop = function (key) {
    const ctx = this.ctx, b = this.pick(key);
    const s = ctx.createBufferSource(); s.buffer = b; s.loop = true;
    s.loopStart = 0.06; s.loopEnd = b.duration - 0.06;   // skip mp3 encoder padding
    const g = ctx.createGain(); g.gain.value = 0;
    s.connect(g); const pn = this.out(g, key === 'caveLoop' ? 0.3 : 0.15);
    s.start(0, R(0.1, b.duration - 0.2));
    (this.loops ||= {})[key] = { s, g, pn };
    // the recorded beds replace the synthetic noise beds
    const t = ctx.currentTime;
    if (key === 'fireLoop') this.fireGain?.gain.cancelScheduledValues(t);
    if (key === 'caveLoop') this.ambGain?.gain.setTargetAtTime(0.12, t, 2);
    if (key === 'seaLoop') this.seaGain && (this.seaGain.gain.value = 0);
    if (key === 'windLoop') this.windGain && (this.windGain.gain.value = 0);
  };

  // --- per-frame: keep the beds mixed with the listener position -------------------------
  const wrap = (name, fn) => { const orig = P[name]; P[name] = function (...a) { return fn.call(this, orig, ...a); }; };

  wrap('update', function (orig, dt, fireDist) {
    orig?.call(this, dt, fireDist);
    if (!this.ctx) return;
    if (!this._samplesLoading) this.loadSamples();
    const L = this.loops; if (!L) return;
    const t = this.ctx.currentTime;
    if (L.fireLoop) {
      L.fireLoop.g.gain.setTargetAtTime(0.9 / (1 + fireDist * 0.3), t, 0.2);
      this.fireGain.gain.setTargetAtTime(0, t, 0.3); // mute the noise bed
      const fp = this._g?.world?.firePos;
      if (fp) L.fireLoop.pn.pan.setTargetAtTime(this.spatial(fp).pan * 0.8, t, 0.2);
    }
    const day = Math.min(1, Math.max(0, this._g?.world?.sky?.material?.uniforms?.uBright?.value ?? 0));
    if (L.caveLoop) L.caveLoop.g.gain.setTargetAtTime(0.35 * (1 - day * 0.7), t, 1.5);
    if (L.seaLoop) { L.seaLoop.g.gain.setTargetAtTime(0.7 * day, t, 1.5); this.seaGain?.gain.setTargetAtTime(0, t, 0.5); }
    if (L.windLoop) { L.windLoop.g.gain.setTargetAtTime(0.06 + 0.3 * day, t, 1.5); this.windGain?.gain.setTargetAtTime(0, t, 0.5); this.caveWind?.gain.setTargetAtTime(0.015, t, 1); }
  });

  // --- foley one-shots: use the recording when there is one ------------------------------
  wrap('sfx', function (orig, name, o = {}) {
    const key = ALIAS[name] || name;
    if (!this.S(key)) return orig.call(this, name, o);
    return this.playS(key, { ...o, rate: (o.rate || 1) * (RATE[name] || 1) * R(0.95, 1.05), vol: (o.vol ?? 1) * (VOL[name] || 1) });
  });

  // --- the original synthesized sounds, replaced by recordings when loaded ----------------
  wrap('bleat', function (orig, pos) {
    if (!this.S('bleat')) return orig.call(this, pos);
    const { d } = this.spatial(pos); if (d > 40) return;
    this.playS('bleat', { pos, vol: 0.55, rate: R(0.9, 1.1), wet: 0.5 });
  });
  wrap('roar', function (orig, pos, o = {}) {
    const { dur = 2.2, pitch = 1, vol = 1, pain = false } = o;
    const key = pain && this.S('painRoar') ? 'painRoar' : 'roar';
    if (!this.S(key)) return orig.call(this, pos, o);
    if (pain && this.cyGroan(pos, { vol: Math.min(1.4, vol) })) { // the groan leads, the old roar sits underneath
      this.playS(key, { pos, vol: 0.45 * vol, rate: 0.6 * (0.85 + pitch * 0.15), wet: 0.75, minG: 0.4, dur: dur + 0.4, lp: 3000 });
      return;
    }
    // a giant's voice: recorded human / creature voices pitched down
    const rate = (pain ? 0.6 : 0.68) * (0.85 + pitch * 0.15);
    this.playS(key, { pos, vol: 1.1 * vol, rate, wet: 0.75, minG: 0.5, dur: dur + 0.4, lp: 5000 });
    this.playS(key, { pos, vol: 0.45 * vol, rate: rate * 0.5, wet: 0.9, minG: 0.5, dur: dur + 0.4, lp: 1200 }); // chest resonance
    if (vol >= 0.9) this.playS('rockfall', { vol: 0.25 * vol, wet: 0.9, when: R(0.5, 1.2), pan: R(-0.8, 0.8), lp: 3000 });
  });
  wrap('scream', function (orig, pos) {
    if (!this.S('scream')) return orig.call(this, pos);
    this.playS('scream', { pos, vol: 0.8, rate: R(0.95, 1.05), wet: 0.7, minG: 0.4 });
  });
  wrap('stomp', function (orig, pos, vol = 1) {
    if (!this.S('giantStep')) return orig.call(this, pos, vol);
    orig.call(this, pos, vol * 0.5); // keep a bit of the synthetic sub thump for weight
    this.playS('giantStep', { pos, vol: 1.1 * vol, rate: R(0.75, 0.9), wet: 0.6, minG: 0.35 });
  });
  wrap('drip', function (orig) {
    if (!this.S('drip')) return orig.call(this);
    this.playS('drip', { vol: R(0.15, 0.35), rate: R(0.85, 1.25), wet: 0.95, pan: R(-1, 1) });
  });
  wrap('heartbeat', function (orig, rate) {
    if (!this.S('heart')) return orig.call(this, rate);
    const now = this.ctx.currentTime; this._hb = this._hb || 0;
    if (rate <= 0 || now < this._hb) return;
    this._hb = now + 60 / rate;
    this.playS('heart', { vol: 0.9, wet: 0.05, lp: 900 });
    this.playS('heart', { vol: 0.55, wet: 0.05, lp: 700, rate: 0.9, when: 0.17 });
  });
  wrap('sizzle', function (orig, on) {
    if (!this.S('sizzle')) return orig.call(this, on);
    if (on && !this._sizS) {
      const b = this.pick('sizzle'), ctx = this.ctx, s = ctx.createBufferSource(); s.buffer = b; s.loop = true; s.loopStart = 0.1; s.loopEnd = b.duration - 0.1;
      const g = ctx.createGain(); g.gain.value = 0.35; s.connect(g); this.out(g, 0.25); s.start();
      this._sizS = { s, g }; this._siz = this._sizS;
    } else if (!on && this._sizS) {
      const { s, g } = this._sizS; g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1); s.stop(this.ctx.currentTime + 0.5);
      this._sizS = null; this._siz = null;
    }
  });
  wrap('rumble', function (orig, dur = 4, vol = 1) {
    if (!this.S('grind')) return orig.call(this, dur, vol);
    orig.call(this, dur, vol * 0.6);
    const b = this.pick('grind'), rate = Math.min(1, b.duration / dur) * 0.9;
    this.playS('grind', { vol: 1.1 * vol, rate: Math.max(0.55, rate), wet: 0.5, dur, lp: 6000 });
    this.playS('rockfall', { vol: 0.35 * vol, wet: 0.7, when: dur * 0.4, pan: R(-0.6, 0.6) });
  });
  wrap('knock', function (orig, pos) {
    if (!this.S('knock')) return orig.call(this, pos);
    this.playS('knock', { pos, vol: 0.8, wet: 0.7, minG: 0.5, lp: 3500, rate: 0.85 });
  });
  wrap('whoosh', function (orig, vol = 0.3) {
    if (!this.S('whoosh')) return orig.call(this, vol);
    this.playS('whoosh', { vol: vol * 1.4, rate: R(0.9, 1.1), wet: 0.2 });
  });
  // the bow, made heavy: a loud dry creak of the limbs while drawing, a fat thump on release
  wrap('twang', function (orig, power = 1) {
    if (!this.S('string')) return orig.call(this, power);
    this.stopBowDraw?.();
    if (this.S('bowRelease')) this.playS('bowRelease', { vol: 1.1 + power * 0.7, rate: R(0.88, 0.98) + power * 0.06, wet: 0.3 });
    this.playS('string', { vol: 0.7 + power * 0.5, rate: 0.85 + power * 0.12, wet: 0.35 });
    this.playS('arrowFly', { vol: 0.45 * power, wet: 0.4, when: 0.03 });
    this.sub?.(0.55 * power, { from: 110, to: 45, dur: 0.3 });   // felt in the chest
  });
  wrap('bowDraw', function (orig) {
    if (!this.S('creak')) return orig.call(this);
    this.stopBowDraw?.();
    const a = this.S('bowDrawHeavy') && this.playS('bowDrawHeavy', { vol: 1.5, rate: R(0.85, 0.95), wet: 0.12 });
    const b = this.playS('creak', { vol: 1.0, rate: 1.1, wet: 0.1, dur: 0.9 });
    this.sfx('rustle', { vol: 0.35, wet: 0.1 });
    this._bowDrawSrc = [a, b].filter(Boolean);
  });
  // letting go early cuts the creak so it doesn't ring over the shot
  P.stopBowDraw = function () {
    const t = this.ctx?.currentTime; if (!t || !this._bowDrawSrc) return;
    for (const s of this._bowDrawSrc) { try { s.stop(t + 0.04); } catch (e) { /* already ended */ } }
    this._bowDrawSrc = null;
  };
  wrap('impact', function (orig, pos, kind = 'rock') {
    if (!this.ctx) return;
    if (kind === 'rock' && this.S('stone')) return void this.playS('stone', { pos, vol: 0.7, wet: 0.5, minG: 0.25 });
    if (kind === 'wood' && this.S('knock')) return void this.playS('knock', { pos, vol: 0.6, wet: 0.5, minG: 0.25 });
    if (kind === 'flesh' && this.S('flesh')) return void this.fleshHit(pos);
    return orig.call(this, pos, kind);
  });
  // an arrow sinking into the giant: meaty thwack + wet flesh + a cinematic punch you hear from anywhere
  P.fleshHit = function (pos, { crit = false } = {}) {
    const k = crit ? 1.25 : 1;
    if (this.S('arrowFlesh')) this.playS('arrowFlesh', { pos, vol: 1.6 * k, rate: R(0.82, 0.95), wet: 0.35, minG: 0.75 });
    this.playS('flesh', { pos, vol: 1.2 * k, rate: R(0.8, 0.95), wet: 0.4, minG: 0.6, when: 0.01 });
    if (this.S('squelch')) this.playS('squelch', { pos, vol: 0.7 * k, rate: R(0.75, 0.9), wet: 0.4, minG: 0.5, when: 0.04, dur: 0.6 });
    // the "you hit it" layer is not spatialised: always loud and clear at the player
    if (this.S('hitPunch')) this.playS('hitPunch', { vol: 1.0 * k, rate: R(0.9, 1.0), wet: 0.3, lp: crit ? 0 : 5000, dur: crit ? 3 : 1.6 });
    this.sub?.(0.9 * k, { from: 85, to: 28, dur: crit ? 1.6 : 0.9 });
    if (crit) this.playS('boom', { vol: 0.8, wet: 0.5, lp: 3000, when: 0.02 });
  };
  // the giant hurting: a mangled, gurgling groan (cyGroan) over the old pain roar
  P.cyGroan = function (pos, { vol = 1, when = 0 } = {}) {
    if (!this.S('cyGroan')) return false;
    this.playS('cyGroan', { pos, vol: 1.5 * vol, rate: R(0.88, 1.02), wet: 0.7, minG: 0.6, when });
    this.playS('cyGroan', { pos, vol: 0.5 * vol, rate: R(0.45, 0.52), wet: 0.9, minG: 0.5, lp: 900, when: when + 0.03 }); // an octave below, in the chest
    return true;
  };
  // a high, strangled shriek: the mangled groan pitched up, doubled with a pitched-down human scream
  P.cyShriek = function (pos, { vol = 1, when = 0 } = {}) {
    if (!this.S('cyGroan')) return false;
    this.playS('cyGroan', { pos, vol: 1.2 * vol, rate: R(1.45, 1.7), wet: 0.65, minG: 0.6, when, dur: 1.6 });
    if (this.S('scream')) this.playS('scream', { pos, vol: 0.9 * vol, rate: R(0.72, 0.82), wet: 0.7, minG: 0.55, when: when + 0.02, dur: 1.8 });
    return true;
  };
  wrap('gullCry', function (orig, pan) {
    if (!this.S('gull')) return orig.call(this, pan);
    this.playS('gull', { vol: R(0.15, 0.35), pan, wet: 0.2 });
  });
}

// ---- cinematic low end: booms, braams, sub drops and a tremor bed that follows the giant ----
export function installLowEnd(Audio) {
  const P = Audio.prototype;
  const R = (a, b) => a + Math.random() * (b - a);
  // a dry synthesized sub sweep (felt more than heard) under every big hit
  P.sub = function (vol = 1, { from = 55, to = 24, dur = 2.5, when = 0 } = {}) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + when;
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(from, t); o.frequency.exponentialRampToValueAtTime(to, t + dur);
    const sh = ctx.createWaveShaper(); const c = new Float32Array(512); for (let i = 0; i < 512; i++) { const x = i / 256 - 1; c[i] = Math.tanh(x * 2.2); } sh.curve = c; // harmonics so laptops still hear it
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.9 * vol, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(sh).connect(g); this.out(g, 0.15); o.start(t); o.stop(t + dur + 0.05);
  };
  // kind: impact | arrival | quake | sting
  P.boom = function (kind = 'impact', vol = 1) {
    if (!this.ctx) return;
    if (kind === 'impact') {
      this.sub(vol, { from: 60, to: 22, dur: 3 });
      this.playS?.('boom', { vol: 1.0 * vol, wet: 0.5, lp: 4000 });
      this.playS?.('quake', { vol: 0.5 * vol, wet: 0.6, when: 0.2, dur: 4 });
    } else if (kind === 'arrival') {
      this.sub(vol, { from: 48, to: 26, dur: 4 });
      this.playS?.('braam', { vol: 0.9 * vol, wet: 0.5 });
      this.playS?.('boom', { vol: 0.9 * vol, wet: 0.5, lp: 3000 });
    } else if (kind === 'quake') {
      this.sub(0.7 * vol, { from: 38, to: 28, dur: 5 });
      this.playS?.('quake', { vol: 1.0 * vol, wet: 0.6, dur: 6 });
      this.playS?.('pebbles', { vol: 0.4 * vol, wet: 0.9, when: R(0.5, 1.5), pan: R(-0.7, 0.7) });
    } else if (kind === 'sting') {
      this.sub(0.8 * vol, { from: 70, to: 30, dur: 2 });
      this.playS?.('subdrop', { vol: 0.9 * vol, wet: 0.3 });
      this.playS?.('boom', { vol: 0.55 * vol, wet: 0.4, lp: 2500 });
    }
  };
  const wrap = (name, fn) => { const orig = P[name]; P[name] = function (...a) { return fn.call(this, orig, ...a); }; };
  // spotted: the "!" gets a trailer-style hit under it
  wrap('alertSting', function (orig, ...a) { orig?.apply(this, a); if (!this._stingT || this.ctx.currentTime > this._stingT) { this._stingT = this.ctx.currentTime + 4; this.boom('sting', 1); } });
  // each giant step: the closer he is, the more the floor thumps
  wrap('stomp', function (orig, pos, vol = 1) {
    orig.call(this, pos, vol);
    if (!this.ctx) return;
    const { d = 30 } = this.spatial(pos); const close = Math.max(0, 1 - d / 28);
    if (close > 0) { this.sub(0.6 * close * vol, { from: 50, to: 26, dur: 1.2 }); this.playS?.('boom', { vol: 0.35 * close * vol, lp: 220, wet: 0.3, dur: 1.5 }); }
  });
  // big roars shake the chest
  wrap('roar', function (orig, pos, o = {}) {
    orig.call(this, pos, o);
    if (this.ctx && (o.vol ?? 1) >= 0.9) { this.sub(0.5 * (o.vol ?? 1), { from: 42, to: 30, dur: (o.dur || 2) + 0.5 }); this.playS?.('boom', { vol: 0.35, lp: 400, wet: 0.5, dur: (o.dur || 2) + 1 }); }
  });
  wrap('rumble', function (orig, dur = 4, vol = 1) { orig.call(this, dur, vol); this.playS?.('quake', { vol: 0.8 * vol, wet: 0.5, dur }); });
  // tremor bed: low rumble that swells with tension and the giant's proximity
  wrap('update', function (orig, dt, fireDist) {
    orig?.call(this, dt, fireDist);
    const L = this.loops, G = this._g; if (!L?.tremorLoop || !G) return;
    const cy = G.cy, st = G.cyState;
    let near = 0;
    if (cy?.root.visible && st && st.mode !== 'sleep') { const { d = 40 } = this.spatial(cy.root.position); near = Math.max(0, 1 - d / 30) * (st.walkTarget ? 1 : 0.5); }
    const k = Math.min(1, (G.tension || 0) * 0.5 + near + Math.min(1, st?.alert || 0) * 0.4);
    L.tremorLoop.g.gain.setTargetAtTime(0.9 * k, this.ctx.currentTime, 0.8);
  });
}

// ---- the body: Odysseus's own heartbeat and breath, driven by how close death is -----------
// calm -> nervous shaky breaths -> holding the breath while hiding -> gasp -> panic panting.
// Heard "inside the head": dry, centred, on its own bus; the world ducks a little when it pounds.
export function installBody(Audio) {
  const P = Audio.prototype;
  const R = (a, b) => a + Math.random() * (b - a);

  P.playBody = function (key, { vol = 1, rate = 1, lp = 0, when = 0, dur = 0 } = {}) {
    const b = this.pick?.(key); if (!b || !this.ctx) return null;
    const ctx = this.ctx;
    if (!this.body) { this.body = ctx.createGain(); this.body.connect(this.master); }
    const s = ctx.createBufferSource(); s.buffer = b; s.playbackRate.value = rate;
    const g = ctx.createGain(); g.gain.value = vol; let n = s;
    if (lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; n.connect(f); n = f; }
    n.connect(g).connect(this.body);
    const w = ctx.createGain(); w.gain.value = 0.06; g.connect(w).connect(this.revSend); // a touch of the cave
    s.onended = () => { g.disconnect(); w.disconnect(); };
    const t0 = ctx.currentTime + when; s.start(t0);
    if (dur && dur < b.duration / rate) { g.gain.setValueAtTime(vol, t0 + dur * 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur); s.stop(t0 + dur + 0.05); return dur; }
    return b.duration / rate;
  };

  // the game still calls heartbeat(rate) every frame; once recordings exist the body driver owns it
  const origHB = P.heartbeat;
  P.heartbeat = function (rate) { if (this.S?.('heart')) return; return origHB.call(this, rate); };

  const origUpdate = P.updateWorld;
  P.updateWorld = function (dt, G) {
    origUpdate.call(this, dt, G);
    if (!this.ctx || !this.S?.('heart')) return;
    const Pl = G.player, cy = G.cy, st = G.cyState;
    if (!Pl || !st) return;
    const B = (this.bodyS ||= { hb: 0, br: 0, hold: 0, danger: 0 });
    const t = this.ctx.currentTime;
    // how scared is he? (the giant awake and near, looking for him, or asleep right next to him)
    let danger = 0;
    if (cy?.root.visible && !Pl.dead) {
      const d = Math.hypot(cy.root.position.x - Pl.pos.x, cy.root.position.z - Pl.pos.z);
      if (st.mode === 'sleep') danger = Math.max(0, 1 - d / 9) * 0.55;
      else danger = Math.max(0, 1 - d / 22) * 0.8 + Math.min(1, st.alert || 0) * 0.5 + (st.grabbing ? 0.5 : 0);
      if (G.alertSys?.phase === 'ALERT') danger = Math.max(danger, 0.95);
      else if (G.alertSys?.phase === 'EVASION') danger = Math.max(danger, 0.7);
    }
    danger = Math.min(1, danger);
    B.danger += (danger - B.danger) * Math.min(1, dt * (danger > B.danger ? 3 : 0.4)); // fear rises fast, fades slowly
    const k = B.danger;

    // heartbeat: 64 bpm at rest, up to 160 in terror; louder and more muffled as it pounds
    B.hb -= dt;
    if (k > 0.18 && B.hb <= 0) {
      const bpm = 64 + k * 96;
      B.hb = 60 / bpm;
      this.playBody('heart', { vol: 0.25 + k * 0.95, lp: 380 + k * 500, rate: R(0.97, 1.03) });
    }
    // the world narrows while the heart pounds
    const duck = 1 - Math.max(0, k - 0.45) * 0.45;
    this.dry.gain.setTargetAtTime(duck, t, 0.4);
    this.revSend.gain.setTargetAtTime(0.55 * duck, t, 0.4);

    // breathing
    const hiding = (Pl.crouch || Pl.prone) && st.mode !== 'sleep' && k > 0.35 && k < 0.9;
    const moving = (Pl.moving || 0) > 0.5;
    B.br -= dt;
    if (hiding && !moving) {
      // holding the breath; after a while it gives out in a gasp
      B.hold += dt;
      if (B.hold > R(7, 9)) { this.playBody('gasp', { vol: 0.55 }); B.hold = 0; B.br = R(0.6, 1.0); }
    } else {
      if (B.hold > 2.5) { this.playBody('gasp', { vol: 0.45, lp: 5000 }); B.br = R(0.5, 0.9); } // let the breath go
      B.hold = 0;
      if (B.br <= 0) {
        if (k > 0.7 || (k > 0.4 && (Pl.sprinting || Pl.exhausted))) {
          // panic panting, but never the same beat twice: vary pitch/level, drop in quick double
          // "ha-ha"s, a short pause, or a strained grunt / groan now and then
          const v = 0.45 + k * 0.35, x = Math.random();
          if (x < 0.12 && this.S('hurt')) {            // strained grunt "nngh"
            const d = this.playBody('hurt', { vol: v * R(0.45, 0.65), rate: R(0.8, 0.95), lp: 2500, dur: R(0.3, 0.45) });
            B.br = Math.min(0.6, d || 0.4) + R(0.05, 0.2);
          } else if (x < 0.22 && this.S('relief')) {   // exhale into a low moan
            const d = this.playBody('relief', { vol: v * R(0.5, 0.7), rate: R(0.85, 1.0), lp: 3500, dur: R(0.55, 0.9) });
            B.br = (d || 0.8) * 0.85 + R(0.05, 0.2);
          } else if (x < 0.4) {                        // quick "ha-ha", clipped and higher
            this.playBody('fastBreath', { vol: v * R(0.75, 0.95), rate: R(1.12, 1.3) });
            this.playBody('fastBreath', { vol: v * R(0.7, 0.9), rate: R(1.15, 1.35), when: R(0.22, 0.32) });
            B.br = R(0.6, 0.85);
          } else {
            const d = this.playBody('fastBreath', { vol: v * R(0.75, 1.15), rate: R(0.88, 1.14) });
            B.br = (d || 0.6) + (Math.random() < 0.15 ? R(0.3, 0.7) : R(0.0, 0.15)); // sometimes a catch
          }
        } else if (k > 0.25) {
          const d = this.playBody('scaredBreath', { vol: (0.25 + k * 0.4) * R(0.8, 1.15), lp: Pl.crouch ? 3500 : 0, rate: R(0.9, 1.08) });
          if (k > 0.45 && Math.random() < 0.12 && this.S('relief')) this.playBody('relief', { vol: 0.15 + k * 0.15, rate: R(0.8, 0.92), lp: 2200, when: (d || 2) * R(0.5, 0.8) }); // a small shaky whimper
          B.br = (d || 2) + R(0.2, 0.9);
        } else B.br = 0.5;
        if (k > 0.25) this.foleyT && (this.foleyT.pant = Math.max(this.foleyT.pant, B.br + 0.2)); // don't double up with the stamina panting
      }
    }
    // it has passed: a long shaky exhale
    if (k > 0.55) B.scared = true;
    if (B.scared && k < 0.15) { B.scared = false; this.playBody('relief', { vol: 0.5 }); }
  };
}
