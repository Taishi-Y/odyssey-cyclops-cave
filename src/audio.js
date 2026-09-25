// Procedural sound design (WebAudio): cave ambience, fire, giant footsteps, roars, sheep, bow, impacts, score.
export class Audio {
  constructor() {
    this.ctx = null;
    this.listener = null;
  }
  init() {
    if (this.ctx) return;
    const ctx = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
    this.master = ctx.createGain(); this.master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    // big stone-room reverb
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(4.5, 2.2);
    this.revSend = ctx.createGain(); this.revSend.gain.value = 0.55;
    this.revSend.connect(this.reverb).connect(this.master);
    this.dry = ctx.createGain(); this.dry.connect(this.master);
    // slow-motion: muffle everything through a low-pass on the master bus
    this.slowLP = ctx.createBiquadFilter(); this.slowLP.type = 'lowpass'; this.slowLP.frequency.value = 20000;
    this.master.disconnect(); this.master.connect(this.slowLP).connect(comp);
    this.noiseBuf = this.makeNoise(3);
    this.brownBuf = this.makeBrown(4);
    this.startAmbience();
  }
  impulse(sec, decay) {
    const ctx = this.ctx, len = ctx.sampleRate * sec, b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay) * (i < 400 ? i / 400 : 1); }
    return b;
  }
  makeNoise(sec) { const ctx = this.ctx, b = ctx.createBuffer(1, ctx.sampleRate * sec, ctx.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return b; }
  makeBrown(sec) { const ctx = this.ctx, b = ctx.createBuffer(1, ctx.sampleRate * sec, ctx.sampleRate), d = b.getChannelData(0); let l = 0; for (let i = 0; i < d.length; i++) { l = (l + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = l * 3.5; } return b; }
  out(gainNode, wet = 0.5, pan = 0) {
    const p = this.ctx.createStereoPanner(); p.pan.value = pan;
    gainNode.connect(p);
    const d = this.ctx.createGain(); d.gain.value = 1 - wet * 0.5; p.connect(d).connect(this.dry);
    const w = this.ctx.createGain(); w.gain.value = wet; p.connect(w).connect(this.revSend);
    return p;
  }
  // spatial helpers: distance attenuation + pan from listener
  spatial(pos) {
    if (!this.listener || !pos) return { g: 1, pan: 0 };
    const L = this.listener;
    const dx = pos.x - L.pos.x, dz = pos.z - L.pos.z, dy = pos.y - L.pos.y;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const right = { x: Math.cos(L.yaw), z: -Math.sin(L.yaw) };
    const pan = Math.max(-1, Math.min(1, (dx * right.x + dz * right.z) / Math.max(d, 1)));
    return { g: 1 / (1 + d * 0.12), pan, d };
  }
  noiseSrc(buf = this.noiseBuf, loop = false) { const s = this.ctx.createBufferSource(); s.buffer = buf; s.loop = loop; return s; }

  startAmbience() {
    const ctx = this.ctx;
    // low cave rumble / air
    const air = this.noiseSrc(this.brownBuf, true);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 180;
    const g = ctx.createGain(); g.gain.value = 0.35;
    air.connect(lp).connect(g); this.out(g, 0.6); air.start();
    this.ambGain = g;
    // fire crackle bed
    const fire = this.noiseSrc(this.noiseBuf, true);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.6;
    this.fireGain = ctx.createGain(); this.fireGain.gain.value = 0.05;
    fire.connect(bp).connect(this.fireGain); this.out(this.fireGain, 0.3); fire.start();
    // score: dissonant low drone (strings-like saw pad)
    this.drone = ctx.createGain(); this.drone.gain.value = 0.0;
    const flt = ctx.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = 420; flt.Q.value = 2;
    this.droneFilter = flt;
    for (const [f, det] of [[43.65, -8], [43.65, 7], [46.25, 0], [65.4, 4], [92.5, -5]]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
      const og = ctx.createGain(); og.gain.value = 0.06;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.05 + Math.random() * 0.1; const lg = ctx.createGain(); lg.gain.value = 0.03;
      lfo.connect(lg).connect(og.gain); lfo.start();
      o.connect(og).connect(flt); o.start();
    }
    flt.connect(this.drone); this.out(this.drone, 0.7);
    this.dripT = 0;
  }
  // the Metal Gear "!" sting: a bright stabbing chord
  alertSting() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    for (const [f, d] of [[1318.5, 0], [1760, 0], [2637, 0.01], [880, 0]]) {
      const o = ctx.createOscillator(); o.type = 'square'; o.frequency.setValueAtTime(f, t + d); o.frequency.exponentialRampToValueAtTime(f * 0.985, t + 0.5);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t + d); g.gain.exponentialRampToValueAtTime(0.09, t + d + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
      o.connect(g); this.out(g, 0.35); o.start(t + d); o.stop(t + 0.75);
    }
  }
  huh() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime, o = ctx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(420, t); o.frequency.exponentialRampToValueAtTime(640, t + 0.25);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.1, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(g); this.out(g, 0.3); o.start(t); o.stop(t + 0.4);
  }
  knock(pos) { for (const d of [0, 0.18]) setTimeout(() => this.impact(pos, 'wood'), d * 1000); }
  setSlowMo(k) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.slowLP.frequency.setTargetAtTime(20000 * Math.pow(0.03, k), t, 0.05);
    if (k > 0.5 && !this._slowWas) { this._slowWas = true; this.whoosh(0.35); }
    if (k < 0.2) this._slowWas = false;
  }
  setTension(x) { // 0..1
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.drone.gain.setTargetAtTime(0.25 + x * 0.9, t, 1.5);
    this.droneFilter.frequency.setTargetAtTime(300 + x * 1600, t, 1.0);
  }
  update(dt, fireDist) {
    if (!this.ctx) return;
    this.fireGain.gain.setTargetAtTime(0.28 / (1 + fireDist * 0.35), this.ctx.currentTime, 0.2);
    // random fire pops
    if (Math.random() < dt * 6) this.click(0.08 / (1 + fireDist * 0.3), 2500 + Math.random() * 3000);
    // water drips somewhere in the cave
    this.dripT -= dt;
    if (this.dripT < 0) { this.dripT = 1.5 + Math.random() * 5; this.drip(); }
  }
  click(vol, freq) {
    const ctx = this.ctx, s = this.noiseSrc(); const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = freq;
    const g = ctx.createGain(); const t = ctx.currentTime; g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
    s.connect(f).connect(g); this.out(g, 0.2); s.start(t, Math.random() * 2, 0.05);
  }
  drip() {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime;
    o.type = 'sine'; const f = 900 + Math.random() * 900; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 2.2, t + 0.05);
    g.gain.setValueAtTime(0.05, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(g); this.out(g, 0.95, Math.random() * 2 - 1); o.start(t); o.stop(t + 0.15);
  }
  // giant footstep: sub thump + gravel
  stomp(pos, vol = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime, { g: sg, pan } = this.spatial(pos);
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(28, t + 0.35);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.9 * vol * Math.max(0.35, sg), t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    o.connect(g); this.out(g, 0.5, pan * 0.5); o.start(t); o.stop(t + 0.7);
    const n = this.noiseSrc(); const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500;
    const ng = ctx.createGain(); ng.gain.setValueAtTime(0.35 * vol * sg, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    n.connect(f).connect(ng); this.out(ng, 0.5, pan); n.start(t, Math.random(), 0.5);
  }
  // cyclops roar / groan: formant-filtered saw + noise, pitch contour
  roar(pos, { dur = 2.2, pitch = 1, vol = 1, pain = false } = {}) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime, { g: sg, pan } = this.spatial(pos);
    const out = ctx.createGain(); out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(1.1 * vol * Math.max(0.5, sg), t + 0.25);
    out.gain.setValueAtTime(1.1 * vol * Math.max(0.5, sg), t + dur * 0.6);
    out.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const base = (pain ? 95 : 62) * pitch;
    for (const mul of [1, 1.005, 2.01]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(base * mul * 0.8, t);
      o.frequency.linearRampToValueAtTime(base * mul * (pain ? 1.6 : 1.15), t + dur * 0.3);
      o.frequency.linearRampToValueAtTime(base * mul * 0.7, t + dur);
      const vib = ctx.createOscillator(); vib.frequency.value = 5.5; const vg = ctx.createGain(); vg.gain.value = base * 0.04;
      vib.connect(vg).connect(o.frequency); vib.start(t); vib.stop(t + dur);
      const og = ctx.createGain(); og.gain.value = mul === 2.01 ? 0.15 : 0.3;
      o.connect(og);
      for (const [ff, q, gg] of [[500, 6, 1], [900, 7, 0.7], [2400, 9, 0.35]]) {
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = ff * (pain ? 1.2 : 1); bp.Q.value = q;
        const bg = ctx.createGain(); bg.gain.value = gg; og.connect(bp).connect(bg).connect(out);
      }
      o.start(t); o.stop(t + dur);
    }
    const n = this.noiseSrc(); const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 700; nf.Q.value = 0.8;
    const ng = ctx.createGain(); ng.gain.value = 0.5; n.connect(nf).connect(ng).connect(out); n.start(t, 0, dur);
    const dist = ctx.createWaveShaper(); const curve = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 3); } dist.curve = curve;
    out.connect(dist); const dg = ctx.createGain(); dg.gain.value = 0.9; dist.connect(dg); this.out(dg, 0.8, pan * 0.6);
  }
  bleat(pos) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime, { g: sg, pan, d } = this.spatial(pos);
    if (d > 40) return;
    const o = ctx.createOscillator(); o.type = 'sawtooth'; const f = 330 + Math.random() * 120;
    o.frequency.setValueAtTime(f, t); o.frequency.linearRampToValueAtTime(f * 0.92, t + 0.6);
    const vib = ctx.createOscillator(); vib.frequency.value = 22 + Math.random() * 8; const vg = ctx.createGain(); vg.gain.value = 18;
    vib.connect(vg).connect(o.frequency);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16 * sg, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 1100; f1.Q.value = 3;
    const f2 = ctx.createBiquadFilter(); f2.type = 'peaking'; f2.frequency.value = 2500; f2.gain.value = 8;
    o.connect(f1).connect(f2).connect(g); this.out(g, 0.5, pan); vib.start(t); o.start(t); o.stop(t + 0.75); vib.stop(t + 0.75);
  }
  bowDraw() { if (!this.ctx) return; const ctx = this.ctx, t = ctx.currentTime, s = this.noiseSrc(); const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 4; const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.05, t + 0.5); g.gain.linearRampToValueAtTime(0.0001, t + 0.9); s.connect(f).connect(g); this.out(g, 0.1); s.start(t, 0, 1); }
  twang(power = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(90, t + 0.25);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.35 * power, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(g); this.out(g, 0.3); o.start(t); o.stop(t + 0.4);
    this.whoosh(0.25 * power);
  }
  whoosh(vol = 0.3) { if (!this.ctx) return; const ctx = this.ctx, t = ctx.currentTime, s = this.noiseSrc(); const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.setValueAtTime(3000, t); f.frequency.exponentialRampToValueAtTime(500, t + 0.3); const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35); s.connect(f).connect(g); this.out(g, 0.3); s.start(t, Math.random(), 0.4); }
  impact(pos, kind = 'rock') {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime, { g: sg, pan } = this.spatial(pos);
    const s = this.noiseSrc(); const f = ctx.createBiquadFilter();
    f.type = kind === 'flesh' ? 'lowpass' : 'bandpass'; f.frequency.value = kind === 'flesh' ? 600 : 2200; f.Q.value = 1.5;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.5 * sg, t); g.gain.exponentialRampToValueAtTime(0.0001, t + (kind === 'flesh' ? 0.25 : 0.12));
    s.connect(f).connect(g); this.out(g, 0.5, pan); s.start(t, Math.random(), 0.3);
    if (kind === 'wood' || kind === 'rock') { const o = ctx.createOscillator(); o.frequency.value = kind === 'wood' ? 220 : 480; const og = ctx.createGain(); og.gain.setValueAtTime(0.12 * sg, t); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.08); o.connect(og); this.out(og, 0.4, pan); o.start(t); o.stop(t + 0.1); }
  }
  crunch(pos) {
    if (!this.ctx) return;
    const ctx = this.ctx, t0 = ctx.currentTime, { g: sg, pan } = this.spatial(pos);
    for (let i = 0; i < 7; i++) {
      const t = t0 + i * 0.09 + Math.random() * 0.04, s = this.noiseSrc(); const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 400 + Math.random() * 1500; f.Q.value = 2;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.6 * Math.max(0.4, sg), t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
      s.connect(f).connect(g); this.out(g, 0.5, pan); s.start(t, Math.random() * 2, 0.08);
    }
  }
  scream(pos) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime, { g: sg, pan } = this.spatial(pos);
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(380, t); o.frequency.linearRampToValueAtTime(520, t + 0.3); o.frequency.linearRampToValueAtTime(300, t + 1.1);
    const vib = ctx.createOscillator(); vib.frequency.value = 7; const vg = ctx.createGain(); vg.gain.value = 14; vib.connect(vg).connect(o.frequency);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1300; bp.Q.value = 3;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.3 * Math.max(0.4, sg), t + 0.08); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    o.connect(bp).connect(g); this.out(g, 0.7, pan); o.start(t); vib.start(t); o.stop(t + 1.3); vib.stop(t + 1.3);
  }
  rumble(dur = 4, vol = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime, s = this.noiseSrc(this.brownBuf);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 220;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(1.6 * vol, t + 0.6); g.gain.setValueAtTime(1.6 * vol, t + dur - 0.8); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g); this.out(g, 0.6); s.start(t, 0, dur);
    const o = ctx.createOscillator(); o.frequency.value = 32; const og = ctx.createGain(); og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(0.6 * vol, t + 0.5); og.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(og); this.out(og, 0.3); o.start(t); o.stop(t + dur);
  }
  sizzle(on) {
    if (!this.ctx) return;
    if (on && !this._siz) {
      const s = this.noiseSrc(this.noiseBuf, true); const f = this.ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 3500;
      const g = this.ctx.createGain(); g.gain.value = 0.12; s.connect(f).connect(g); this.out(g, 0.2); s.start(); this._siz = { s, g };
    } else if (!on && this._siz) { this._siz.s.stop(); this._siz = null; }
  }
  heartbeat(rate) {
    if (!this.ctx) return;
    this._hb = (this._hb || 0);
    const now = this.ctx.currentTime;
    if (rate <= 0 || now < this._hb) return;
    this._hb = now + 60 / rate;
    for (const [dt, v] of [[0, 0.5], [0.16, 0.35]]) {
      const o = this.ctx.createOscillator(); o.frequency.value = 50; const g = this.ctx.createGain(); const t = now + dt;
      g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18); o.connect(g); this.out(g, 0.05); o.start(t); o.stop(t + 0.2);
    }
  }
}
