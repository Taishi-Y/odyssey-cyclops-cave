// Background music: two dark, low ambient tracks by Kevin MacLeod (incompetech.com, CC BY 4.0), always playing.
//  - bed    : "Ossuary 6 - Air", a slow drone of impending doom. Plays the whole game.
//  - tension: "Dark Fog", faded in on top as the tension rises (giant inside, alerts, the blinding...).
// Each loops by overlapping its own tail with a fresh copy (6 s crossfade), so there is never a gap or a click.
const BASE = (import.meta.env?.BASE_URL || '/') + 'assets/music/';
const FADE = 6;

export function installScore(Audio) {
  const P = Audio.prototype;

  P.startScore = function () {
    const ctx = this.ctx;
    const bus = (this.scoreBus = ctx.createGain()); bus.gain.value = 0.9;
    this.out(bus, 0.25); // mostly dry: the tracks carry their own space
    this.scoreLayers = {};
    for (const [key, file, level] of [['bed', 'ossuary6_air.mp3', 1], ['tension', 'dark_fog.mp3', 0]]) {
      const g = ctx.createGain(); g.gain.value = 0; g.connect(bus);
      const L = (this.scoreLayers[key] = { g, level, buf: null, next: 0 });
      fetch(BASE + file).then((r) => r.arrayBuffer()).then((a) => ctx.decodeAudioData(a)).then((b) => {
        L.buf = b; L.next = ctx.currentTime + 0.05;
        g.gain.setTargetAtTime(L.level, ctx.currentTime, 2.5); // fade in on load
      }).catch((e) => console.warn('music missing', file, e));
    }
    this.scoreTension(0);
  };

  // start the next copy of a layer FADE seconds before the current one ends, both faded at the seam
  function schedule(ctx, L) {
    const b = L.buf, t0 = Math.max(L.next, ctx.currentTime + 0.02), len = b.duration;
    const s = ctx.createBufferSource(); s.buffer = b;
    const e = ctx.createGain();
    e.gain.setValueAtTime(0, t0); e.gain.linearRampToValueAtTime(1, t0 + FADE);
    e.gain.setValueAtTime(1, t0 + len - FADE); e.gain.linearRampToValueAtTime(0, t0 + len);
    s.connect(e).connect(L.g); s.start(t0); s.stop(t0 + len + 0.05);
    s.onended = () => e.disconnect();
    L.next = t0 + len - FADE;
  }

  P.scoreTension = function (x) {
    if (!this.scoreLayers) return;
    const t = this.ctx.currentTime, L = this.scoreLayers;
    L.bed.level = 0.85 + x * 0.15;
    L.tension.level = Math.max(0, (x - 0.2) / 0.8) * 0.9; // the second track only once something is wrong
    for (const k in L) if (L[k].buf) L[k].g.gain.setTargetAtTime(L[k].level, t, 3);
  };

  // call every frame: queues the next loop of each layer a few seconds ahead
  P.updateScore = function () {
    if (!this.scoreLayers) return;
    const ctx = this.ctx;
    for (const L of Object.values(this.scoreLayers)) if (L.buf && L.next < ctx.currentTime + 2) schedule(ctx, L);
  };
}
