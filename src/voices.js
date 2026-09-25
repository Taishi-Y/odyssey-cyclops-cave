// Crew voices baked with Gemini 3.8 Flash TTS (tools/crew_voices.py).
// - lines: the scripted say() dialogue, played automatically when that exact text is shown
// - barks: panic shouts by situation; several nearby men shout over each other in their own voice
const BASE = (import.meta.env?.BASE_URL || '/') + 'assets/voice/';
const R = (a, b) => a + Math.random() * (b - a);
const CREW = ['deep2', 'deep3', 'crewC', 'crewD', 'crewE', 'crewF', 'tenor', 'mid', 'wiry']; // manifest index -> voice name
export const voiceKey = (v) => (typeof v === 'number' ? CREW[v] : v) ?? 'anon';
const GAP = 0.35;   // a voice rests at least this long between two takes
const BUSY = 2;     // at most this many panic barks sound at once

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

  // ---- one mouth per voice: a voice never starts again before its previous take has finished
  P.voiceFreeAt = function (v) { return (this._vBusy ||= {})[voiceKey(v)] || 0; };
  P.claimVoice = function (v, start, dur) {
    const k = voiceKey(v), b = (this._vBusy ||= {});
    b[k] = Math.max(b[k] || 0, start + dur + GAP);
  };
  P.barksPlaying = function (t) { return (this._barkEnds ||= []).filter((e) => e > t).length; };
  // recently heard texts (any voice), so the same sentence isn't shouted twice in a row
  P.recentText = function (t) { return (this._recentTxt ||= []).includes(t); };
  P.markText = function (t) { const r = (this._recentTxt ||= []); r.push(t); if (r.length > 10) r.shift(); };

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

  // scripted line: waits for its speaker to finish whatever he is shouting (never overlaps himself)
  P.sayVoice = function (text, pos) {
    const l = this.crewManifest?.lines?.[text]; if (!l) return 0;
    const now = this.ctx.currentTime, when = Math.max(0, this.voiceFreeAt(l.v) - now);
    const dur = this.playVoiceFile(l.f, { pos, vol: 1.15, minG: 0.8, wet: 0.25, when });
    this.claimVoice(l.v, now + when, dur);
    this._lineSrcEnd = now + when + dur;
    return 1;
  };

  // a take of `cat` in voice v whose text hasn't been heard lately (null if this voice has nothing fresh)
  P.barkTake = function (cat, v, used = new Set()) {
    const all = this.crewManifest?.barks?.[cat]; if (!all?.length) return null;
    const ok = (b) => this.crewBufs[b.f] && !used.has(b.t);
    const mine = all.filter((b) => b.v === v && ok(b));
    const fresh = mine.filter((b) => !this.recentText(b.t));
    const pool = fresh.length ? fresh : mine.length ? mine : all.filter((b) => ok(b) && !this.recentText(b.t));
    if (!pool.length) return null;
    const last = (this._lastBark ||= {});
    let pick = pool[(Math.random() * pool.length) | 0];
    if (pool.length > 1 && pick.f === last[cat]) pick = pool[(pool.indexOf(pick) + 1) % pool.length];
    last[cat] = pick.f;
    return pick;
  };
}

// Game-side helper: up to `n` men (nearest to `near` first, or `who` explicitly) shout `cat`.
// Kept sparse: usually 1-2 men, random gaps, every man a different sentence, never a voice over itself,
// never more than BUSY panic barks at once.
export function crewBark(game, cat, { n = 3, near = null, who = null, delay = 0, spread = 0.9, cooldown = 4 } = {}) {
  const A = game.audio; if (!A.ctx || !A.crewManifest) return;
  const now = game.time, cd = (game._barkCd ||= {});
  if (cd[cat] > now) return;
  if (!who) {
    if ((game._barkAny || 0) > now) return;          // someone shouted recently: the cave stays quiet a while
    if (Math.random() < 0.35) { cd[cat] = now + R(3, 8); return; } // and often nobody shouts at all
  }
  cd[cat] = now + (who ? cooldown : Math.max(cooldown, 15) + R(0, 12));
  game._barkAny = now + R(9, 18);
  let men = who ? [].concat(who) : game.soldiers.filter((s) => s.alive && s.state !== 'grabbed' && s.state !== 'dead');
  if (!who) {
    const c = near || game.player.pos;
    const k = Math.min(n, Math.random() < 0.8 ? 1 : 2); // most of the time one man, sometimes two
    men = men.map((s) => [s, s.root.position.distanceTo(c) + Math.random() * 6]).sort((a, b) => a[1] - b[1]).map((a) => a[0]).slice(0, k + 2);
    men = men.sort(() => Math.random() - 0.5).slice(0, k);
  }
  const t0 = A.ctx.currentTime, used = new Set();
  let t = delay + R(0, 0.5);
  for (const s of men) {
    const start = t0 + t;
    if (A.voiceFreeAt(s.voice) > start) continue; // his voice is still going: he stays quiet this time
    if (!who && A.barksPlaying(start) >= BUSY) break;
    const b = A.barkTake(cat, s.voice, used); if (!b) continue;
    const dur = A.playVoiceFile(b.f, { pos: s.root.position.clone().setY(s.root.position.y + 1.6), when: t, vol: R(0.9, 1.1) });
    if (!dur) continue;
    used.add(b.t); A.markText(b.t); A.claimVoice(s.voice, start, dur);
    A._barkEnds = (A._barkEnds || []).filter((e) => e > t0); A._barkEnds.push(start + dur);
    t += Math.max(spread, 0.6) * R(0.8, 2.2); // loose, uneven gaps instead of a chorus
  }
}
