// Crew voices baked with Gemini 3.8 Flash TTS (tools/crew_voices.py).
// - lines: the scripted say() dialogue, played automatically when that exact text is shown
// - barks: panic shouts by situation; several nearby men shout over each other in their own voice
const BASE = (import.meta.env?.BASE_URL || '/') + 'assets/voice/';
const R = (a, b) => a + Math.random() * (b - a);

export function installVoices(Audio) {
  const P = Audio.prototype;

  P.loadCrewVoices = function () {
    if (!this.ctx) return Promise.resolve();
    return (this._crewLoading ||= this._loadCrew());
  };
  P._loadCrew = async function () {
    try { this.crewManifest = await (await fetch(BASE + 'manifest.json')).json(); } catch (e) { console.warn('voice manifest missing', e); return; }
    this.crewBufs = {};
    const files = [...Object.values(this.crewManifest.lines).map((l) => l.f), ...Object.values(this.crewManifest.barks).flat().map((b) => b.f)];
    await Promise.all(files.map(async (f) => {
      try { this.crewBufs[f] = await this.ctx.decodeAudioData(await (await fetch(BASE + f)).arrayBuffer()); } catch (e) { /* skip */ }
    }));
  };

  // play one voice file, spatialised if pos is given (never quieter than minG so shouts carry across the cave)
  P.playVoiceFile = function (f, { pos = null, vol = 1, when = 0, wet = 0.35, minG = 0.45, rate = 1 } = {}) {
    const b = this.crewBufs?.[f]; if (!b) return 0;
    const ctx = this.ctx, t = ctx.currentTime + when;
    const { g: sg, pan } = pos ? this.spatial(pos) : { g: 1, pan: 0 };
    const s = ctx.createBufferSource(); s.buffer = b; s.playbackRate.value = rate; // pitch exactly as generated
    const g = ctx.createGain(); g.gain.value = vol * Math.max(minG, sg);
    s.connect(g); this.out(g, wet, pan * 0.8); s.start(t);
    s.onended = () => g.disconnect();
    return b.duration / rate;
  };

  P.sayVoice = function (text, pos) {
    const l = this.crewManifest?.lines?.[text]; if (!l) return 0;
    this._lineSrcEnd = this.ctx.currentTime + this.playVoiceFile(l.f, { pos, vol: 1.15, minG: 0.8, wet: 0.25 });
    return 1;
  };

  // takes of `cat` recorded by voice v (fallback: any take)
  P.barkTake = function (cat, v) {
    const all = this.crewManifest?.barks?.[cat]; if (!all?.length) return null;
    const mine = all.filter((b) => b.v === v && this.crewBufs[b.f]);
    const pool = mine.length ? mine : all.filter((b) => this.crewBufs[b.f]);
    if (!pool.length) return null;
    const last = (this._lastBark ||= {});
    let pick = pool[(Math.random() * pool.length) | 0];
    if (pool.length > 1 && pick.f === last[cat]) pick = pool[(pool.indexOf(pick) + 1) % pool.length];
    last[cat] = pick.f;
    return pick.f;
  };
}

// Game-side helper: `n` men (nearest to `near` first, or `who` explicitly) shout `cat` over each other.
export function crewBark(game, cat, { n = 3, near = null, who = null, delay = 0, spread = 0.9, cooldown = 4 } = {}) {
  const A = game.audio; if (!A.ctx || !A.crewManifest) return;
  const now = game.time, cd = (game._barkCd ||= {});
  if (cd[cat] > now) return;
  cd[cat] = now + cooldown;
  let men = who ? [].concat(who) : game.soldiers.filter((s) => s.alive && s.state !== 'grabbed' && s.state !== 'dead');
  if (!who) {
    const c = near || game.player.pos;
    men = men.map((s) => [s, s.root.position.distanceTo(c) + Math.random() * 4]).sort((a, b) => a[1] - b[1]).map((a) => a[0]).slice(0, n);
  }
  let t = delay;
  for (const s of men) {
    const f = A.barkTake(cat, s.voice);
    if (f) A.playVoiceFile(f, { pos: s.root.position.clone().setY(s.root.position.y + 1.6), when: t, vol: R(0.9, 1.1) });
    t += R(0.15, spread); // overlap: the next man starts before the previous one is done
  }
}
