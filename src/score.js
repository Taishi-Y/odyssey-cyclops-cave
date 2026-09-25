// Eerie low score that never stops (procedural WebAudio, no files).
//  - sub: a D1 sine with a slow breathing swell, felt more than heard
//  - pad: a dark cluster (D, E-flat, A-flat: minor second + tritone) of detuned saws under a slowly wandering low-pass
//  - events every 7-18 s: a groan that sags in pitch, a low inharmonic bell, or a far-off hollow swell of air
// Tension (0..1) opens the filter and raises the level; at 0 (the peaceful intro) it is quiet but already uneasy.
const R = (a, b) => a + Math.random() * (b - a);

export function installScore(Audio) {
  const P = Audio.prototype;

  P.startScore = function () {
    const ctx = this.ctx, t = ctx.currentTime;
    const bus = (this.scoreBus = ctx.createGain()); bus.gain.value = 0;
    bus.gain.setTargetAtTime(0.55, t, 3); // fade in over the first seconds
    this.out(bus, 0.75);

    // sub
    const sub = ctx.createOscillator(); sub.type = 'sine'; sub.frequency.value = 36.7;
    const subG = ctx.createGain(); subG.gain.value = 0.22;
    const breathe = ctx.createOscillator(); breathe.frequency.value = 0.045; const bg = ctx.createGain(); bg.gain.value = 0.12;
    breathe.connect(bg).connect(subG.gain); breathe.start();
    sub.connect(subG).connect(bus); sub.start();

    // pad
    const lp = (this.scoreLP = ctx.createBiquadFilter()); lp.type = 'lowpass'; lp.frequency.value = 160; lp.Q.value = 4;
    const sweep = ctx.createOscillator(); sweep.frequency.value = 0.021; const sw = ctx.createGain(); sw.gain.value = 70;
    sweep.connect(sw).connect(lp.frequency); sweep.start();
    const padG = ctx.createGain(); padG.gain.value = 0.5;
    for (const [f, det] of [[73.4, -9], [73.4, 8], [77.8, -4], [103.8, 6], [36.7, 0], [155.6, -12]]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
      const og = ctx.createGain(); og.gain.value = f > 150 ? 0.018 : 0.045;
      const lfo = ctx.createOscillator(); lfo.frequency.value = R(0.02, 0.08); const lg = ctx.createGain(); lg.gain.value = og.gain.value * 0.8;
      lfo.connect(lg).connect(og.gain); lfo.start();
      o.connect(og).connect(lp); o.start();
    }
    lp.connect(padG).connect(bus);

    this._scoreT = R(4, 8);
    this.scoreTension(0);
  };

  P.scoreTension = function (x) {
    if (!this.scoreBus) return;
    const t = this.ctx.currentTime;
    this.scoreBus.gain.setTargetAtTime(0.55 + x * 0.45, t, 2);
    this.scoreLP.frequency.setTargetAtTime(160 + x * 260, t, 2);
    this._scoreX = x;
  };

  // call every frame: schedules the occasional eerie event
  P.updateScore = function (dt) {
    if (!this.scoreBus) return;
    this._scoreT -= dt; if (this._scoreT > 0) return;
    const x = this._scoreX || 0;
    this._scoreT = R(7, 18) * (1 - x * 0.4);
    const k = Math.random();
    if (k < 0.4) this.scoreGroan(); else if (k < 0.7) this.scoreBell(); else this.scoreAir();
  };

  // a low tone that swells in and sags a few semitones, like something huge sighing in the dark
  P.scoreGroan = function () {
    const ctx = this.ctx, t = ctx.currentTime, f = R(48, 70), len = R(5, 9);
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * R(0.78, 0.88), t + len);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220; lp.Q.value = 6;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16, t + len * 0.45); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(lp).connect(g).connect(this.scoreBus); o.start(t); o.stop(t + len + 0.1);
  };

  // a dull, inharmonic low bell far away (partials that don't belong together)
  P.scoreBell = function () {
    const ctx = this.ctx, t = ctx.currentTime, f = R(55, 82), len = R(6, 10);
    for (const [m, a] of [[1, 0.11], [2.76, 0.05], [5.4, 0.025], [1.007, 0.08]]) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f * m;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(a, t + 0.08); g.gain.exponentialRampToValueAtTime(0.0001, t + len / m ** 0.3);
      o.connect(g).connect(this.scoreBus); o.start(t); o.stop(t + len + 0.1);
    }
  };

  // hollow air swelling up out of nowhere and dying away (filtered noise through the cave reverb)
  P.scoreAir = function () {
    const ctx = this.ctx, t = ctx.currentTime, len = R(6, 11);
    const n = this.noiseSrc(this.brownBuf, true);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 9;
    bp.frequency.setValueAtTime(R(140, 260), t); bp.frequency.exponentialRampToValueAtTime(R(60, 110), t + len);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + len * 0.6); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    n.connect(bp).connect(g).connect(this.scoreBus); n.start(t); n.stop(t + len + 0.1);
  };
}
