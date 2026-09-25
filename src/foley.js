// Foley layer: sample-based procedural sound effects rendered once into AudioBuffers
// (footsteps on gravel, hooves, bow creak, Karplus-Strong bowstring, arrow whistle, bronze
// clangs, pebble trickles, giant breathing / snoring, fire crackle, sea and gulls outside...).
// Installed onto Audio.prototype: existing sounds keep playing and get realistic layers on top.

// ---- tiny offline DSP helpers ---------------------------------------------------------
class BQ {
  constructor(type, f, q, sr) {
    const w = (2 * Math.PI * Math.min(f, sr * 0.45)) / sr, c = Math.cos(w), al = Math.sin(w) / (2 * q);
    let b0, b1, b2;
    if (type === 'lp') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = (1 - c) / 2; }
    else if (type === 'hp') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = (1 + c) / 2; }
    else { b0 = al; b1 = 0; b2 = -al; }
    const a0 = 1 + al;
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = (-2 * c) / a0; this.a2 = (1 - al) / a0;
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
  }
  p(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y; return y;
  }
}
const R = (a, b) => a + Math.random() * (b - a);
const N = () => Math.random() * 2 - 1;

// add a filtered noise burst into d starting at sample i0
function burst(d, sr, t0, dur, amp, filters, shape = 'exp') {
  const i0 = Math.floor(t0 * sr), n = Math.floor(dur * sr);
  const fs = filters.map(([ty, f, q]) => new BQ(ty, f, q, sr));
  for (let i = 0; i < n + sr * 0.02 && i0 + i < d.length; i++) {
    const k = i / n;
    const env = i >= n ? 0 : shape === 'exp' ? Math.exp(-5 * k) : shape === 'hann' ? Math.sin(Math.PI * k) : 1 - k;
    let x = N() * env;
    for (const f of fs) x = f.p(x);
    d[i0 + i] += x * amp;
  }
}
// short excitation through a ringing resonator (stone, bronze, wood)
function ring(d, sr, t0, freqs, decay, amp) {
  const i0 = Math.floor(t0 * sr);
  for (const [f, a, dk] of freqs) {
    const n = Math.floor((decay * (dk || 1)) * sr * 5), ph = Math.random() * 6.28;
    for (let i = 0; i < n && i0 + i < d.length; i++) {
      const t = i / sr;
      d[i0 + i] += Math.sin(2 * Math.PI * f * t + ph) * Math.exp(-t / (decay * (dk || 1))) * a * amp * Math.min(1, i / 12);
    }
  }
}
function normalize(d, peak = 0.9) {
  let m = 0; for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]));
  if (m > 0) for (let i = 0; i < d.length; i++) d[i] *= peak / m;
}

export function installFoley(Audio) {
  const P = Audio.prototype;

  P.buf = function (sec, fn) {
    const sr = this.ctx.sampleRate, b = this.ctx.createBuffer(1, Math.ceil(sec * sr), sr), d = b.getChannelData(0);
    fn(d, sr); normalize(d); return b;
  };

  P.initFoley = function () {
    if (this.fx || !this.ctx) return;
    const fx = (this.fx = {});
    const many = (n, fn) => Array.from({ length: n }, fn);
    // footsteps on gravel / rock: heel strike, toe roll, lots of tiny grit grains
    const step = (weight, scuff) => this.buf(0.45, (d, sr) => {
      const heel = 0.01, toe = heel + R(0.05, 0.1);
      burst(d, sr, heel, 0.03, 1.4 * weight, [['lp', 160, 0.9]]);
      burst(d, sr, toe, 0.025, 0.6 * weight, [['lp', 260, 0.9]]);
      const grains = Math.floor(22 + weight * 45);
      for (let g = 0; g < grains; g++) {
        const cl = Math.random() < 0.6 ? heel : toe;
        const t = cl + -Math.log(1 - Math.random() * 0.98) * 0.03;
        burst(d, sr, t, R(0.0008, 0.005), R(0.15, 0.6) * Math.exp(-(t - cl) * 12), [['bp', R(1400, 7000), R(1.5, 5)]]);
      }
      if (scuff) burst(d, sr, toe, 0.12, 0.25, [['hp', 1800, 0.7], ['lp', 6000, 0.7]], 'hann');
    });
    fx.walk = many(8, () => step(0.55, false));
    fx.run = many(8, () => step(1, true));
    fx.sneak = many(6, () => step(0.2, false));
    fx.land = many(3, () => this.buf(0.6, (d, sr) => {
      burst(d, sr, 0.005, 0.06, 2.2, [['lp', 120, 0.8]]);
      burst(d, sr, 0.03, 0.05, 1.0, [['lp', 300, 0.8]]);
      for (let g = 0; g < 110; g++) { const t = 0.005 + -Math.log(1 - Math.random() * 0.99) * 0.05; burst(d, sr, t, R(0.001, 0.006), R(0.1, 0.5) * Math.exp(-t * 8), [['bp', R(1200, 6500), R(1.5, 4)]]); }
      burst(d, sr, 0.0, 0.18, 0.2, [['bp', 2500, 0.8]], 'hann'); // cloth
    }));
    // hooves: two sharp keratin clicks with a hollow body
    fx.hoof = many(6, () => this.buf(0.18, (d, sr) => {
      for (const t of [0.005, R(0.03, 0.06)]) {
        burst(d, sr, t, 0.003, 1, [['bp', R(1500, 2400), 6]]);
        burst(d, sr, t, 0.012, 0.6, [['bp', R(600, 900), 4]]);
        for (let g = 0; g < 6; g++) burst(d, sr, t + R(0, 0.03), 0.002, 0.15, [['bp', R(2000, 6000), 3]]);
      }
    }));
    // pebbles bouncing down rock
    const bounce = (base, n, heavy) => this.buf(1.6, (d, sr) => {
      let t = 0.01, gap = R(0.12, 0.26), a = 1;
      for (let k = 0; k < n && t < 1.5; k++) {
        const f = base * R(0.8, 1.25);
        ring(d, sr, t, [[f, 0.5], [f * 2.3, 0.3, 0.6], [f * 3.9, 0.15, 0.4]], 0.012, a);
        burst(d, sr, t, 0.002, a * 0.8, [['hp', 1500, 0.7]]);
        if (heavy) burst(d, sr, t, 0.02, a * 0.7, [['lp', 250, 0.8]]);
        t += gap; gap *= R(0.55, 0.75); a *= R(0.6, 0.8);
        if (gap < 0.012) gap = R(0.01, 0.03);
      }
    });
    fx.pebbles = many(6, () => this.buf(2.2, (d, sr) => {
      const n = Math.floor(R(2, 6));
      for (let s = 0; s < n; s++) {
        const off = R(0, 0.6); let t = off, gap = R(0.08, 0.2), a = R(0.4, 1);
        for (let k = 0; k < 9 && t < 2.1; k++) { const f = R(2500, 5500); ring(d, sr, t, [[f, 0.5], [f * 1.9, 0.25, 0.5]], 0.006, a); burst(d, sr, t, 0.0015, a, [['hp', 2500, 0.7]]); t += gap; gap *= R(0.5, 0.8); a *= 0.7; }
      }
    }));
    fx.stone = many(4, () => bounce(1700, 7, true));
    // arrow into rock: crack, bronze ping, shaft buzz
    fx.arrowRock = many(4, () => this.buf(0.7, (d, sr) => {
      burst(d, sr, 0.002, 0.002, 1.2, [['hp', 3000, 0.7]]);
      const f = R(2600, 3400);
      ring(d, sr, 0.002, [[f, 0.35], [f * 2.32, 0.2, 0.7], [f * 4.25, 0.1, 0.5]], 0.04, 1);
      const bp = new BQ('bp', R(320, 420), 3, sr), i0 = Math.floor(0.004 * sr), wob = R(38, 55);
      for (let i = 0; i < sr * 0.4 && i0 + i < d.length; i++) { const t = i / sr; d[i0 + i] += bp.p(N()) * (0.5 + 0.5 * Math.sin(2 * Math.PI * wob * t)) * Math.exp(-t / 0.09) * 1.4; }
      for (let g = 0; g < 10; g++) burst(d, sr, R(0.004, 0.05), 0.002, 0.3, [['bp', R(2000, 6000), 3]]);
    }));
    // arrow / spear into flesh: meaty thump plus a wet slap
    fx.flesh = many(4, () => this.buf(0.5, (d, sr) => {
      burst(d, sr, 0.003, 0.07, 1.6, [['lp', 240, 0.9]]);
      ring(d, sr, 0.003, [[R(70, 95), 1]], 0.06, 0.9);
      const lp = { y: 0 }; const i0 = Math.floor(0.008 * sr);
      for (let i = 0; i < sr * 0.14; i++) { const t = i / sr, a = 0.5 * Math.exp(-t * 25) + 0.02; lp.y += a * (N() - lp.y); d[i0 + i] += lp.y * Math.exp(-t / 0.05) * 1.2; }
    }));
    // bronze spearhead ringing off stone
    fx.spearRock = many(3, () => this.buf(1.4, (d, sr) => {
      const f = R(820, 1150);
      ring(d, sr, 0.003, [[f, 0.4], [f * 2.76, 0.3, 0.7], [f * 5.4, 0.15, 0.45], [f * 8.93, 0.08, 0.3]], 0.16, 1);
      burst(d, sr, 0.002, 0.003, 1.3, [['hp', 2000, 0.7]]);
      burst(d, sr, 0.004, 0.05, 0.9, [['bp', 300, 3]]); // wooden shaft knock
      let t = 0.12, gap = 0.12; for (let k = 0; k < 4; k++) { burst(d, sr, t, 0.03, 0.5 * Math.pow(0.6, k), [['bp', R(250, 400), 4]]); t += gap; gap *= 0.6; }
    }));
    // bow: stick-slip creak of wood and sinew under load (0.8s, matches the draw time)
    fx.creak = many(3, () => this.buf(0.9, (d, sr) => {
      const rs = [new BQ('bp', R(480, 560), 14, sr), new BQ('bp', R(1150, 1350), 12, sr), new BQ('bp', R(2300, 2600), 10, sr)];
      let next = 0.02;
      for (let i = 0; i < d.length; i++) {
        const t = i / sr; let x = 0;
        if (t >= next && t < 0.82) { x = R(0.5, 1) * (0.4 + t); next = t + 1 / (R(22, 30) + t * 60) * R(0.8, 1.2); }
        d[i] = rs[0].p(x) + rs[1].p(x) * 0.7 + rs[2].p(x) * 0.35;
      }
    }));
    // bowstring release: Karplus-Strong pluck + dull limb thwack
    fx.string = many(3, () => this.buf(0.8, (d, sr) => {
      const f = R(95, 125), L = Math.floor(sr / f), line = Float32Array.from({ length: L }, () => N());
      for (let i = 0, p = 0; i < sr * 0.7; i++) { const a = line[p], b = line[(p + 1) % L]; line[p] = (a + b) * 0.5 * 0.994; d[i] += a * 0.6 * Math.exp(-i / sr / 0.18); p = (p + 1) % L; }
      burst(d, sr, 0, 0.025, 1.6, [['lp', 500, 0.8]]);
      burst(d, sr, 0, 0.004, 0.8, [['hp', 2500, 0.7]]);
    }));
    // human breaths (inhale / exhale), giant breaths, snores
    const breath = (dur, f1, f2, amp, inhale) => this.buf(dur + 0.1, (d, sr) => {
      const a = new BQ('bp', f1, 1.3, sr), b = new BQ('bp', f2, 1.6, sr), h = new BQ('hp', 200, 0.7, sr);
      for (let i = 0; i < dur * sr; i++) {
        const k = i / (dur * sr), env = inhale ? Math.pow(Math.sin(Math.PI * Math.pow(k, 0.7)), 1.5) : Math.pow(Math.sin(Math.PI * Math.pow(k, 0.45)), 2);
        const x = N(); d[i] = h.p(a.p(x) + b.p(x) * 0.6) * env * amp;
      }
    });
    fx.pantIn = many(3, () => breath(R(0.28, 0.36), R(1100, 1400), R(2400, 2900), 1, true));
    fx.pantOut = many(3, () => breath(R(0.3, 0.42), R(800, 1000), R(1700, 2100), 1, false));
    fx.effort = many(3, () => this.buf(0.3, (d, sr) => { // a short "hup"
      const a = new BQ('bp', 700, 4, sr), b = new BQ('bp', 1200, 5, sr); let ph = 0;
      for (let i = 0; i < 0.22 * sr; i++) { const k = i / (0.22 * sr), f = 120 * (1 + 0.2 * Math.sin(k * 3)); ph += f / sr; const g = (ph % 1) < 0.35 ? 1 : 0; const x = g * 0.6 + N() * 0.35; d[i] = (a.p(x) + b.p(x) * 0.7) * Math.sin(Math.PI * Math.pow(k, 0.5)); }
    }));
    fx.gasp = many(2, () => breath(0.35, 1300, 2600, 1, true));
    fx.giantIn = many(3, () => breath(R(1.2, 1.6), R(260, 330), R(620, 760), 1, true));
    fx.giantOut = many(3, () => breath(R(1.6, 2.1), R(200, 260), R(480, 600), 1, false));
    fx.snore = many(3, () => this.buf(2.3, (d, sr) => {
      const f1 = new BQ('bp', R(230, 280), 4, sr), f2 = new BQ('bp', R(600, 720), 5, sr), lp = new BQ('lp', 1400, 0.7, sr);
      let ph = 0; const dur = 1.9;
      for (let i = 0; i < dur * sr; i++) {
        const k = i / (dur * sr), env = Math.pow(Math.sin(Math.PI * Math.pow(k, 0.8)), 1.3);
        const f0 = 28 + 14 * Math.sin(Math.PI * k) + N() * 3; ph += f0 / sr;
        const pulse = Math.pow(Math.max(0, Math.sin(2 * Math.PI * ph)), 8);
        const x = pulse * 1.5 + N() * 0.35 * (0.4 + pulse);
        d[i] = lp.p(f1.p(x) + f2.p(x) * 0.6) * env;
      }
    }));
    // cloth / leather rustle and straw crackle
    fx.rustle = many(4, () => this.buf(0.5, (d, sr) => {
      burst(d, sr, 0, R(0.25, 0.45), 0.4, [['bp', R(1800, 3200), 0.9]], 'hann');
      for (let g = 0; g < 14; g++) burst(d, sr, R(0.02, 0.4), R(0.002, 0.01), 0.2, [['bp', R(2000, 5000), 2]]);
    }));
    fx.straw = many(4, () => this.buf(0.5, (d, sr) => {
      for (let g = 0; g < 70; g++) burst(d, sr, R(0, 0.42) * Math.sin(Math.PI * Math.random() * 0.5 + 0.5), R(0.0006, 0.003), R(0.2, 1), [['bp', R(3000, 9000), R(2, 6)]]);
      burst(d, sr, 0, 0.4, 0.15, [['hp', 3500, 0.7]], 'hann');
    }));
    fx.drag = many(4, () => this.buf(0.6, (d, sr) => { // body sliding over gravel (prone crawl)
      burst(d, sr, 0, 0.5, 0.35, [['bp', 900, 0.8]], 'hann');
      for (let g = 0; g < 60; g++) burst(d, sr, R(0.02, 0.5), R(0.0008, 0.004), R(0.1, 0.5), [['bp', R(1500, 6500), 3]]);
    }));
    fx.scrape = many(4, () => this.buf(0.4, (d, sr) => { // hands on rock while climbing
      burst(d, sr, 0, R(0.15, 0.3), 0.6, [['bp', R(1200, 2200), 1.2]], 'hann');
      burst(d, sr, 0, 0.02, 0.8, [['lp', 300, 0.8]]);
      for (let g = 0; g < 25; g++) burst(d, sr, R(0, 0.25), 0.002, R(0.1, 0.4), [['bp', R(2500, 7000), 3]]);
    }));
    fx.gear = many(3, () => this.buf(0.35, (d, sr) => { // weapon swap: leather, wood tap, arrow rattle
      burst(d, sr, 0, 0.18, 0.4, [['bp', 2200, 1]], 'hann');
      burst(d, sr, R(0.05, 0.12), 0.03, 0.7, [['bp', R(350, 500), 5]]);
      for (let g = 0; g < 5; g++) ring(d, sr, R(0.02, 0.2), [[R(1800, 2600), 0.3]], 0.01, 0.4);
    }));
    // fire: clusters of resinous pops, and a log settling
    fx.crackle = many(8, () => this.buf(0.4, (d, sr) => {
      const n = Math.floor(R(2, 9)); let t = 0.005;
      for (let k = 0; k < n; k++) { burst(d, sr, t, 0.0004, R(0.4, 1.2), [['hp', 800, 0.7]]); burst(d, sr, t, R(0.004, 0.015), R(0.2, 0.7), [['bp', R(900, 4200), R(2, 5)]]); t += R(0.004, 0.05); }
    }));
    fx.logShift = many(2, () => this.buf(1.5, (d, sr) => {
      burst(d, sr, 0.01, 0.08, 1.4, [['bp', R(180, 260), 3]]);
      burst(d, sr, 0.06, 0.05, 0.8, [['bp', R(300, 420), 4]]);
      for (let g = 0; g < 50; g++) burst(d, sr, 0.05 + Math.pow(Math.random(), 2) * 1.2, R(0.001, 0.006), R(0.05, 0.35), [['bp', R(2500, 8000), 3]]);
      burst(d, sr, 0.05, 1.2, 0.15, [['hp', 4000, 0.7]], 'lin');
    }));
    // eating: bone cracks + wet tearing ; chewing cheese
    fx.bone = many(4, () => this.buf(0.35, (d, sr) => {
      for (let k = 0, t = 0.005; k < Math.floor(R(2, 4)); k++, t += R(0.01, 0.04)) { burst(d, sr, t, 0.0015, 1.2, [['hp', 1200, 0.7]]); burst(d, sr, t, 0.02, 0.9, [['bp', R(900, 1600), 2]]); }
      burst(d, sr, 0.003, 0.05, 0.9, [['lp', 200, 0.8]]);
    }));
    fx.squelch = many(3, () => this.buf(0.6, (d, sr) => {
      let y = 0; for (let i = 0; i < 0.5 * sr; i++) { const t = i / sr, c = 0.02 + 0.3 * Math.abs(Math.sin(t * R(18, 24))); y += c * (N() - y); d[i] = y * Math.sin(Math.PI * t / 0.5); }
    }));
    fx.chew = many(3, () => this.buf(0.9, (d, sr) => {
      for (let k = 0; k < 4; k++) { const t = 0.02 + k * 0.2; burst(d, sr, t, 0.1, 0.6, [['bp', R(500, 900), 1.5]], 'hann'); for (let g = 0; g < 8; g++) burst(d, sr, t + R(0, 0.08), 0.002, 0.3, [['bp', R(1500, 4000), 3]]); }
    }));
    fx.hit = many(2, () => this.buf(0.4, (d, sr) => { burst(d, sr, 0.003, 0.09, 2, [['lp', 180, 0.9]]); burst(d, sr, 0.003, 0.2, 0.3, [['bp', 2400, 0.9]], 'hann'); }));
    fx.thud = many(3, () => this.buf(0.5, (d, sr) => { burst(d, sr, 0.004, 0.12, 2, [['lp', 110, 0.9]]); ring(d, sr, 0.004, [[R(45, 60), 1]], 0.08, 0.6); }));
    fx.gull = null; // synthesized live
    this.foleyAmbience();
  };

  // play one of the pre-rendered buffers
  P.sfx = function (name, { pos = null, vol = 1, rate = 1, wet = 0.4, pan = 0, minG = 0, when = 0 } = {}) {
    if (!this.ctx || !this.fx) return null;
    const list = this.fx[name]; if (!list) return null;
    if ((this._voices || 0) > 56 && vol < 0.6) return null;
    const { g: sg, pan: sp } = pos ? this.spatial(pos) : { g: 1, pan: 0 };
    const gain = vol * Math.max(minG, sg);
    if (gain < 0.004) return null;
    const s = this.ctx.createBufferSource(); s.buffer = list[(Math.random() * list.length) | 0];
    s.playbackRate.value = rate * R(0.94, 1.06);
    const g = this.ctx.createGain(); g.gain.value = gain;
    s.connect(g); this.out(g, wet, pos ? sp : pan);
    this._voices = (this._voices || 0) + 1; s.onended = () => { this._voices--; g.disconnect(); };
    s.start(this.ctx.currentTime + when);
    return s;
  };

  // ---- winded breathing: one randomly chosen "phrase" per call, so it never ticks like a metronome.
  // hard = 0..1 (how out of breath). Returns seconds until the next phrase should start.
  P.pantPhrase = function (pos, hard = 0.5, o = {}) {
    const J = (v, a = 0.25) => v * R(1 - a, 1 + a); // jitter
    const base = { pos, minG: o.minG ?? 0.8, wet: o.wet ?? 0.2, lp: o.lp || 0 };
    const vi = (o.vol ?? 1) * (0.12 + 0.18 * hard), vo = (o.vol ?? 1) * (0.14 + 0.2 * hard);
    const pat = [
      ['pair', 5], ['quick', 1.5 + hard * 2.5], ['deep', 1.4], ['groan', 0.5 + hard * 1.2], ['catch', 0.8],
    ].filter(([n]) => n !== this._lastPant || n === 'pair');
    let r = Math.random() * pat.reduce((a, [, w]) => a + w, 0), kind = 'pair';
    for (const [n, w] of pat) { if ((r -= w) < 0) { kind = n; break; } }
    this._lastPant = kind;
    const S = (name, x) => this.sfx(name, { ...base, ...x });
    if (kind === 'quick') {            // "ha-ha-ha": short, higher, clipped
      const n = Math.random() < 0.5 ? 2 : 3; let t = 0;
      for (let i = 0; i < n; i++) { S('pantOut', { vol: J(vo * 0.85), rate: R(1.12, 1.35), when: t, dur: R(0.2, 0.3) }); t += R(0.19, 0.29); }
      return t + R(0.25, 0.5);
    }
    if (kind === 'deep') {             // a big gulp of air and a long slow "haaa"
      S('pantIn', { vol: J(vi * 1.3, 0.15), rate: R(0.82, 0.92) });
      S('pantOut', { vol: J(vo * 1.2, 0.15), rate: R(0.78, 0.88), when: R(0.42, 0.55) });
      return R(1.3, 1.8) - hard * 0.3;
    }
    if (kind === 'groan') {            // exhale that turns into a low tired groan "haa... nnh"
      S('pantIn', { vol: J(vi), rate: R(0.9, 1.05) });
      const w = R(0.3, 0.42);
      if (Math.random() < 0.6) S('relief', { vol: J(vo * 1.1, 0.2), rate: R(0.85, 1.0), when: w, lp: 3500, dur: R(0.55, 0.85) });
      else S('hurt', { vol: J(vo * 0.8, 0.2), rate: R(0.8, 0.95), when: w, lp: 2500, dur: 0.35 });
      return R(1.1, 1.5) - hard * 0.2;
    }
    if (kind === 'catch') {            // tries to steady it: one soft breath, then a longer gap
      S(Math.random() < 0.5 ? 'pantIn' : 'pantOut', { vol: J(vi * 0.7), rate: R(0.92, 1.05) });
      return R(1.1, 1.6) - hard * 0.3;
    }
    // plain "haa-haa" pair, with its own timing, pitch and balance each time
    const inR = R(0.9, 1.15);
    S('pantIn', { vol: J(vi), rate: inR });
    S('pantOut', { vol: J(vo), rate: inR * R(0.9, 1.05), when: R(0.28, 0.42) });
    return R(0.65, 1.1) - hard * 0.3;
  };

  // ---- continuous beds: wind moan through the entrance, sea + wind outside ----------------
  P.foleyAmbience = function () {
    const ctx = this.ctx;
    const loop = (buf, filters, gain) => {
      const s = this.noiseSrc(buf, true); let n = s;
      for (const [ty, f, q] of filters) { const b = ctx.createBiquadFilter(); b.type = ty; b.frequency.value = f; b.Q.value = q; n.connect(b); n = b; }
      const g = ctx.createGain(); g.gain.value = gain; n.connect(g); s.start(0, Math.random() * 2); return { g, n };
    };
    // cave wind: resonant, slowly wandering whistle
    const w = loop(this.noiseBuf, [['bandpass', 380, 7]], 0.0);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.045; const lg = ctx.createGain(); lg.gain.value = 140; lfo.connect(lg).connect(w.n.frequency); lfo.start();
    this.out(w.g, 0.9); this.caveWind = w.g;
    // outside: surf (brown noise swelling) and open-air wind
    const sea = loop(this.brownBuf, [['lowpass', 700, 0.7]], 0.0);
    const swell = ctx.createOscillator(); swell.frequency.value = 0.11; const sg = ctx.createGain(); sg.gain.value = 0.5;
    const seaAmp = ctx.createGain(); seaAmp.gain.value = 0.6; swell.connect(sg).connect(seaAmp.gain); swell.start();
    sea.g.connect(seaAmp); this.out(seaAmp, 0.15); this.seaGain = sea.g;
    const hiss = loop(this.noiseBuf, [['bandpass', 1400, 0.5]], 0.0); this.out(hiss.g, 0.1); this.windGain = hiss.g;
    this.foleyT = { crackle: 0, log: 20, pebble: R(8, 20), settle: R(25, 50), breath: 2, gull: 6, sniff: 0, climb: 0, pant: 0 };
  };

  P.gullCry = function (pan) {
    const ctx = this.ctx, t = ctx.currentTime;
    const calls = Math.floor(R(2, 5));
    for (let k = 0; k < calls; k++) {
      const t0 = t + k * R(0.28, 0.4), f = R(1300, 1700), d = R(0.18, 0.3);
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(f * 0.8, t0); o.frequency.linearRampToValueAtTime(f * 1.15, t0 + d * 0.3); o.frequency.linearRampToValueAtTime(f * 0.7, t0 + d);
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2200; bp.Q.value = 2;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.035, t0 + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
      o.connect(bp).connect(g); this.out(g, 0.2, pan); o.start(t0); o.stop(t0 + d + 0.05);
    }
  };

  // ---- flying projectiles: arrow whistle / spear whoosh / stone whirr with doppler ----------
  P.trackProjectiles = function (list) {
    const ctx = this.ctx, L = this.listener;
    const live = new Set(list); this._flying = this._flying || new Set();
    for (const p of this._flying) if (!live.has(p)) { p.dead = true; list = list.concat([p]); }
    for (const p of list) {
      if (!p._snd && !p.stuck && !p.dead) {
        const s = this.noiseSrc(this.noiseBuf, true);
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
        const base = p.kind === 'arrow' ? 2600 : p.kind === 'spear' ? 520 : 900;
        bp.frequency.value = base; bp.Q.value = p.kind === 'arrow' ? 7 : 1.6;
        const g = ctx.createGain(); g.gain.value = 0;
        s.connect(bp).connect(g); const pn = this.out(g, 0.25); s.start(0, Math.random() * 2);
        p._snd = { s, bp, g, pn, base, last: null }; this._flying.add(p);
      }
      const S = p._snd; if (!S) continue;
      if (p.stuck || p.dead || !L) {
        if (!S.done) { S.done = true; S.g.gain.setTargetAtTime(0, ctx.currentTime, 0.015); S.s.stop(ctx.currentTime + 0.1); }
        this._flying.delete(p);
        continue;
      }
      const { g: sg, pan } = this.spatial(p.pos);
      const dx = p.pos.x - L.pos.x, dy = p.pos.y - L.pos.y, dz = p.pos.z - L.pos.z, dist = Math.hypot(dx, dy, dz) || 1;
      const vr = (p.vel.x * dx + p.vel.y * dy + p.vel.z * dz) / dist; // + = moving away
      const speed = p.vel.length();
      const dop = 343 / (343 + vr);
      const t = ctx.currentTime;
      S.bp.frequency.setTargetAtTime(S.base * dop * (0.8 + speed / 120), t, 0.02);
      const lvl = (p.kind === 'arrow' ? 0.35 : p.kind === 'spear' ? 0.6 : 0.2) * Math.min(1, speed / 25) * sg;
      S.g.gain.setTargetAtTime(lvl * (0.85 + 0.15 * Math.sin(t * 70)), t, 0.02);
      S.pn.pan.setTargetAtTime(pan, t, 0.02);
    }
  };

  // ---- per-frame driver: the game calls this with itself ----------------------------------
  P.updateWorld = function (dt, G) {
    if (!this.ctx) return;
    this.initFoley();
    const T = this.foleyT, Pl = G.player, t = this.ctx.currentTime;
    this._g = G;
    if (!Pl) return;
    // --- player footsteps, synced to the head-bob cycle
    const mv = Pl.moving || 0;
    const stepIdx = Math.floor((Pl.bob || 0) / Math.PI);
    if (this._stepIdx === undefined) this._stepIdx = stepIdx;
    if (stepIdx !== this._stepIdx) {
      this._stepIdx = stepIdx;
      if (Pl.onGround && !Pl.climbing && mv > 0.35 && !Pl.dead) {
        const at = Pl.pos;
        if (Pl.prone) { this.sfx('drag', { pos: at, vol: 0.5, minG: 0.6 }); if (Pl.disguised) this.sfx('straw', { pos: at, vol: 0.5, minG: 0.6 }); }
        else {
          const kind = Pl.crouch ? 'sneak' : Pl.sprinting && mv > 4 ? 'run' : 'walk';
          const heavy = Pl.carrying ? 1.25 : 1;
          this.sfx(kind, { pos: at, vol: (kind === 'run' ? 1.1 : kind === 'walk' ? 0.7 : 0.35) * heavy, rate: Pl.carrying ? 0.85 : 1, minG: 0.65, wet: 0.35 });
          if (kind !== 'walk' || Math.random() < 0.4) this.sfx('rustle', { pos: at, vol: kind === 'run' ? 0.25 : 0.12, minG: 0.6, wet: 0.15 });
          if (Pl.disguised) this.sfx('straw', { pos: at, vol: 0.35, minG: 0.6 });
          if (Pl.carrying && Math.random() < 0.25) this.sfx('creak', { pos: at, vol: 0.12, rate: 0.6, minG: 0.6 });
        }
      }
    }
    // --- jump / landing
    const was = this._onGround;
    if (was === true && !Pl.onGround && Pl.vel.y > 3) { this.sfx('effort', { pos: Pl.pos, vol: 0.18, minG: 0.7, wet: 0.2 }); this.sfx('rustle', { pos: Pl.pos, vol: 0.35, minG: 0.7 }); }
    if (was === false && Pl.onGround && (this._air || 0) > 0.25) {
      const k = Math.min(1.6, this._air * 1.2);
      this.sfx('land', { pos: Pl.pos, vol: 0.5 * k, minG: 0.7 });
      if (this._air > 0.9) this.sfx('effort', { pos: Pl.pos, vol: 0.2, rate: 0.8, minG: 0.7 });
    }
    this._onGround = Pl.onGround; this._air = Pl.airTime || 0;
    // --- climbing: hands and feet scraping rock, grit falling
    if (Pl.climbing) {
      T.climb -= dt;
      if (T.climb < 0) { T.climb = R(0.35, 0.55); this.sfx('scrape', { pos: Pl.pos, vol: 0.5, minG: 0.65 }); if (Math.random() < 0.3) this.sfx('pebbles', { pos: Pl.pos, vol: 0.25, minG: 0.5, when: 0.2 }); }
    }
    // --- breathing when winded
    const st = Pl.stamina ?? 1;
    T.pant -= dt;
    if ((Pl.exhausted || st < 0.4) && !Pl.dead && T.pant < 0) {
      const hard = Pl.exhausted ? 1 : 1 - st / 0.4;
      T.pant = this.pantPhrase(Pl.pos, hard);
    }
    // --- getting hurt
    if (this._hp !== undefined && Pl.hp < this._hp - 0.5) { this.sfx('hit', { vol: 0.9 }); this.sfx('gasp', { vol: 0.35, when: 0.05 }); this.sfx('rustle', { vol: 0.4 }); }
    this._hp = Pl.hp;
    // --- weapon swap
    if (this._weapon !== undefined && this._weapon !== Pl.weapon) this.sfx('gear', { vol: 0.35, wet: 0.1 });
    this._weapon = Pl.weapon;
    // --- things in flight
    this.trackProjectiles(Pl.projectiles || []);

    // --- the giant: breathing while awake, snoring asleep, sniffing when suspicious
    const cy = G.cy, cs = G.cyState;
    if (cy && cy.root.visible && cs) {
      const mouth = cy.mouthWorld ? cy.mouthWorld() : cy.root.position;
      T.breath -= dt;
      if (T.breath < 0) {
        if (cs.mode === 'sleep') {
          T.breath = R(4.2, 5.4);
          this.sfx('snore', { pos: mouth, vol: 1.3, minG: 0.25, wet: 0.6, rate: R(0.85, 1.05) });
          this.sfx('giantOut', { pos: mouth, vol: 0.9, minG: 0.2, wet: 0.6, when: 2.0 });
        } else if (cs.mode !== 'gate' || Math.random() < 0.5) {
          const hard = Math.min(1, (cs.alert || 0) + (cs.walkTarget ? 0.3 : 0));
          T.breath = R(2.8, 3.6) - hard * 0.8;
          this.sfx('giantIn', { pos: mouth, vol: 0.5 + hard * 0.5, minG: 0.15, wet: 0.6, rate: R(0.9, 1.05) });
          this.sfx('giantOut', { pos: mouth, vol: 0.6 + hard * 0.6, minG: 0.15, wet: 0.6, when: 1.4 });
        }
      }
      T.sniff -= dt;
      if (cs.mode === 'tend' && (cs.alert || 0) > 0.3 && (cs.alert || 0) < 1 && T.sniff < 0) {
        T.sniff = R(4, 7);
        for (let k = 0; k < 3; k++) this.sfx('giantIn', { pos: mouth, vol: 0.9, rate: 2.6, minG: 0.2, wet: 0.5, when: k * 0.22 });
      }
    }
    // --- the crew's footsteps
    for (const s of G.soldiers || []) {
      const r = s.root; if (!r || !s.alive || !r.visible) { s._fp = null; continue; }
      const p = r.position;
      if (s._fp) {
        const d = Math.hypot(p.x - s._fp.x, p.z - s._fp.z); s._fd = (s._fd || 0) + d;
        const sp = d / Math.max(dt, 1e-3), stride = sp > 2.5 ? 1.5 : 0.8;
        if (s._fd > stride) { s._fd = 0; this.sfx(sp > 2.5 ? 'run' : 'walk', { pos: p, vol: sp > 2.5 ? 0.7 : 0.4, wet: 0.5 }); }
        s._fp.copy(p);
      } else s._fp = p.clone();
    }
    // --- sheep hooves (only the ones nearby, capped)
    const flock = G.flock?.sheep; this._hoofBudget = Math.min(10, (this._hoofBudget || 0) + dt * 10);
    if (flock && this.listener) {
      const lp = this.listener.pos;
      for (const s of flock) {
        const sp = s.vel.length(); if (sp < 0.25) continue;
        const d = Math.hypot(s.pos.x - lp.x, s.pos.z - lp.z); if (d > 16) continue;
        if (Math.random() < dt * sp * 3.2 && this._hoofBudget >= 1) { this._hoofBudget--; this.sfx('hoof', { pos: s.pos, vol: 0.28, rate: R(0.9, 1.15), wet: 0.4 }); }
      }
    }
    // --- fire: crackle clusters and a log settling now and then
    const fp = G.world?.firePos;
    if (fp) {
      T.crackle -= dt;
      if (T.crackle < 0) { T.crackle = R(0.08, 0.7); this.sfx('crackle', { pos: fp, vol: R(0.25, 0.7), wet: 0.3, rate: R(0.8, 1.3) }); }
      T.log -= dt;
      if (T.log < 0) { T.log = R(14, 32); this.sfx('logShift', { pos: fp, vol: 0.7, wet: 0.4 }); }
    }
    // --- the cave itself: grit trickling down, rock settling; outside: surf, wind, gulls
    const day = G.world?.sky?.material?.uniforms?.uBright?.value ?? 0;
    const outside = Math.min(1, Math.max(0, day));
    this.caveWind.gain.setTargetAtTime(0.05 * (1 - outside * 0.6), t, 1.5);
    this.seaGain.gain.setTargetAtTime(0.5 * outside, t, 1.5);
    this.windGain.gain.setTargetAtTime(0.05 * outside, t, 1.5);
    const L = this.listener;
    if (L) {
      T.pebble -= dt;
      if (T.pebble < 0) {
        T.pebble = R(10, 26);
        const a = Math.random() * 6.28, r = R(5, 14);
        this.sfx('pebbles', { pos: { x: L.pos.x + Math.cos(a) * r, y: L.pos.y + R(1, 5), z: L.pos.z + Math.sin(a) * r }, vol: R(0.3, 0.6), wet: 0.85 });
      }
      T.settle -= dt;
      if (T.settle < 0) { T.settle = R(30, 60); this.sfx('thud', { vol: 0.25, rate: 0.6, wet: 0.95, pan: R(-0.8, 0.8) }); this.sfx('pebbles', { vol: 0.2, wet: 0.95, when: 0.3, pan: R(-0.8, 0.8) }); }
      T.gull -= dt;
      if (outside > 0.35 && T.gull < 0) { T.gull = R(5, 14); this.gullCry(R(-0.9, 0.9)); }
    }
    // stake in the fire: steam spits and pops while it hardens
    if (this._siz && Math.random() < dt * 9) this.sfx('crackle', { vol: 0.35, rate: 1.6, wet: 0.2 });
  };

  // ---- layers on top of the existing sounds --------------------------------------------
  const wrap = (name, fn) => { const orig = P[name]; P[name] = function (...a) { const r = orig?.apply(this, a); if (this.ctx && this.fx) fn.apply(this, a); return r; }; };

  wrap('stomp', function (pos, vol = 1) { // the whole cave reacts to a giant's step
    this.sfx('thud', { pos, vol: 0.9 * vol, rate: 0.55, minG: 0.35, wet: 0.6 });
    this.sfx('land', { pos, vol: 0.6 * vol, rate: 0.45, minG: 0.25, wet: 0.5 });
    if (Math.random() < 0.45) this.sfx('pebbles', { pos: pos && { x: pos.x + R(-4, 4), y: (pos.y || 0) + 4, z: pos.z + R(-4, 4) }, vol: 0.4 * vol, minG: 0.2, wet: 0.8, when: R(0.1, 0.4) });
  });
  wrap('roar', function (pos, o = {}) {
    const vol = o.vol ?? 1;
    if (vol >= 0.9) { // dust and grit shaken loose from the ceiling
      for (let k = 0; k < 2; k++) this.sfx('pebbles', { vol: 0.35 * vol, wet: 0.9, when: R(0.4, 1.6), pan: R(-0.9, 0.9) });
    }
  });
  wrap('rumble', function (dur = 4, vol = 1) { // the door-stone grinding over the floor
    const ctx = this.ctx, t = ctx.currentTime, s = this.noiseSrc(this.noiseBuf, true);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 260; bp.Q.value = 1.2;
    const am = ctx.createGain(); am.gain.value = 0.5; const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 11; const lg = ctx.createGain(); lg.gain.value = 0.35; lfo.connect(lg).connect(am.gain);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5 * vol, t + 0.5); g.gain.setValueAtTime(0.5 * vol, t + dur - 0.6); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(bp).connect(am).connect(g); this.out(g, 0.5); s.start(t, Math.random()); s.stop(t + dur); lfo.start(t); lfo.stop(t + dur);
    for (let k = 0; k < dur * 3; k++) this.sfx(Math.random() < 0.5 ? 'pebbles' : 'crackle', { vol: 0.35 * vol, rate: 0.5, wet: 0.6, when: R(0, dur), pan: R(-0.7, 0.7) });
  });
  P.impact = (function (orig) {
    return function (pos, kind = 'rock') {
      if (!this.ctx) return;
      if (!this.fx) return orig.call(this, pos, kind === 'arrow' || kind === 'spear' || kind === 'stone' ? 'rock' : kind);
      if (kind === 'arrow') return void this.sfx('arrowRock', { pos, vol: 0.8, wet: 0.5, minG: 0.15 });
      if (kind === 'spear') { this.sfx('spearRock', { pos, vol: 0.9, wet: 0.55, minG: 0.15 }); return; }
      if (kind === 'stone') { this.sfx('stone', { pos, vol: 0.9, wet: 0.6, minG: 0.15 }); return; }
      orig.call(this, pos, kind);
      if (kind === 'flesh') this.sfx('flesh', { pos, vol: 1, wet: 0.4, minG: 0.3 });
      else if (kind === 'rock') this.sfx('pebbles', { pos, vol: 0.3, wet: 0.6 });
      else if (kind === 'wood') this.sfx('thud', { pos, vol: 0.4, rate: 1.6, wet: 0.5 });
    };
  })(P.impact);
  wrap('bowDraw', function () { this.sfx('creak', { vol: 0.35, wet: 0.1 }); this.sfx('rustle', { vol: 0.15, wet: 0.1 }); });
  wrap('twang', function (power = 1) { this.sfx('string', { vol: 0.5 + power * 0.4, wet: 0.35, rate: 0.9 + power * 0.2 }); });
  wrap('knock', function (pos) { for (const d of [0, 0.18]) this.sfx('thud', { pos, vol: 0.5, rate: 1.3, wet: 0.7, minG: 0.5, when: d }); });
  wrap('crunch', function (pos) {
    const eatingCheese = this._g && pos === this._g.player?.pos;
    if (eatingCheese) { this.sfx('chew', { vol: 0.5, wet: 0.1 }); return; }
    for (let k = 0; k < 4; k++) this.sfx('bone', { pos, vol: 0.8, minG: 0.4, wet: 0.5, when: k * R(0.12, 0.2) });
    this.sfx('squelch', { pos, vol: 0.7, minG: 0.4, wet: 0.4, when: 0.1 });
  });
  // heartbeat: a real chest thump (low noise body + sub) instead of a bare sine
  P.heartbeat = function (rate) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime; this._hb = this._hb || 0;
    if (rate <= 0 || now < this._hb) return;
    this._hb = now + 60 / rate;
    for (const [dt, v] of [[0, 0.55], [0.17, 0.38]]) {
      const t = now + dt, o = this.ctx.createOscillator(); o.frequency.setValueAtTime(62, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.12);
      const g = this.ctx.createGain(); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2); o.connect(g); this.out(g, 0.05); o.start(t); o.stop(t + 0.22);
      if (this.fx) this.sfx('thud', { vol: v * 0.6, rate: 1.2, wet: 0.05, when: dt });
    }
  };
}
