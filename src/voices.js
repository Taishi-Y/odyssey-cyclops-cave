// Crew voices baked with Gemini 3.8 Flash TTS (tools/crew_voices.py).
// - lines: the scripted say() dialogue, played automatically when that exact text is shown
// - barks: panic shouts by situation; several nearby men shout over each other in their own voice
const BASE = (import.meta.env?.BASE_URL || '/') + 'assets/voice/';
const R = (a, b) => a + Math.random() * (b - a);
const CREW = ['deep2', 'deep3', 'crewC', 'crewD', 'crewE', 'crewF', 'tenor', 'mid', 'wiry', 'maniac', 'zealot']; // manifest index -> voice name (J laughs like a madman, K shrieks prayers)
export const voiceKey = (v) => (typeof v === 'number' ? CREW[v] : v) ?? 'anon';
const GAP = 0.35;   // a voice rests at least this long between two takes
const BUSY = 8;     // at most this many panic barks sound at once

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
    // idle chatter (tools/crew_chatter.py): stored under 'chat/...' keys in the same buffer table
    try {
      this.chatManifest = await (await fetch(BASE + 'chat/manifest.json')).json();
      await Promise.all(Object.values(this.chatManifest).flat().map(async (c) => {
        c.f = 'chat/' + c.f.replace(/^chat\//, '');
        try { this.crewBufs[c.f] = await this.ctx.decodeAudioData(await (await fetch(BASE + c.f)).arrayBuffer()); } catch (e) { /* skip */ }
      }));
    } catch (e) { console.warn('chatter missing', e); }
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
  P.barkTake = function (cat, v, used = new Set(), at = 0) {
    const all = this.crewManifest?.barks?.[cat]; if (!all?.length) return null;
    const ok = (b) => this.crewBufs[b.f] && !used.has(b.t);
    const mine = all.filter((b) => b.v === v && ok(b));
    const fresh = mine.filter((b) => !this.recentText(b.t));
    const pool = fresh.length ? fresh : mine.length ? mine : all.filter((b) => ok(b) && !this.recentText(b.t) && this.voiceFreeAt(b.v) <= at);
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
  cd[cat] = now + cooldown;
  game._barkAny = now + R(0.2, 0.6);
  let men = who ? [].concat(who) : game.soldiers.filter((s) => s.alive && s.state !== 'grabbed' && s.state !== 'dead');
  if (!who) {
    const c = near || game.player.pos;
    const k = n; // the full crowd shouts, each man on his own
    men = men.map((s) => [s, s.root.position.distanceTo(c) + Math.random() * 6]).sort((a, b) => a[1] - b[1]).map((a) => a[0]).slice(0, k + 5);
    const t1 = A.ctx.currentTime + delay; // men whose voice is free go first, so a busy voice doesn't silence the crowd
    men = men.sort(() => Math.random() - 0.5).sort((x, y) => (A.voiceFreeAt(x.voice) > t1) - (A.voiceFreeAt(y.voice) > t1)).slice(0, k);
  }
  const t0 = A.ctx.currentTime, used = new Set();
  let t = delay + R(0, 0.3);
  for (const s of men) {
    const start = t0 + t;
    if (A.voiceFreeAt(s.voice) > start) continue; // his voice is still going: he stays quiet this time
    if (!who && A.barksPlaying(start) >= BUSY) break;
    const b = A.barkTake(cat, s.voice, used, start); if (!b) continue;
    const dur = A.playVoiceFile(b.f, { pos: s.root.position.clone().setY(s.root.position.y + 1.6), when: t, vol: R(0.9, 1.1) });
    if (!dur) continue;
    used.add(b.t); A.markText(b.t); A.claimVoice(b.v, start, dur); A.claimVoice(s.voice, start, dur);
    A._barkEnds = (A._barkEnds || []).filter((e) => e > t0); A._barkEnds.push(start + dur);
    t += R(0.15, Math.max(spread, 0.4)); // overlapping, uneven starts
  }
}

// Idle chatter, called every frame. When no bark or scripted line is playing the men talk among themselves,
// several little conversations at once in different corners of the crowd:
//   peace : before the giant comes home, relaxed banter (2 conversations)
//   tense : the giant is inside but calm (no alert, nobody being grabbed), whispering (3 conversations)
// A voice never talks over itself and the same sentence is not repeated back to back.
const STREAMS = { peace: 2, tense: 3 };
export function crewChatter(game, dt) {
  const A = game.audio; if (!A.ctx || !A.chatManifest) return;
  const now = A.ctx.currentTime;
  const cy = game.cy, st = game.cyState;
  let mood = null;
  if (game.phase === 'intro' && !cy.root.visible) mood = 'peace';
  else if (cy.root.visible && game.alertSys?.phase === 'NORMAL' && !st.grabbing && st.mode !== 'script') mood = 'tense';
  const S = (game._chat ||= [0, 1, 2].map((i) => ({ t: 1 + i * 1.3, reply: null })));
  if (!mood) { for (const c of S) { c.t = Math.max(c.t, 2); c.reply = null; } return; }
  if ((A._lineSrcEnd || 0) > now || A.barksPlaying(now) > 0) { for (const c of S) c.t = Math.max(c.t, 0.3); return; }
  const pool = A.chatManifest[mood] || [];
  const peace = mood === 'peace';
  const busy = new Set(S.map((c) => c.speaker).filter(Boolean));
  for (let i = 0; i < STREAMS[mood]; i++) {
    const C = S[i];
    C.t -= dt; if (C.t > 0) continue;
    const men = game.soldiers.filter((s) => s.alive && s.state !== 'grabbed' && s.state !== 'dead' && !s.escaped && s.voice != null
      && s.chore?.kind !== 'eat' && A.voiceFreeAt(s.voice) <= now);
    if (!men.length || !pool.length) { C.t = 1; continue; }
    // a reply comes from a man near the last speaker of this conversation; otherwise anyone (nearer the player more likely)
    let cand = C.reply ? men.filter((s) => s !== C.reply && s.root.position.distanceTo(C.reply.root.position) < 8) : [];
    if (!cand.length) cand = men;
    const P = game.player.pos;
    cand = cand.map((s) => [s, s.root.position.distanceTo(P) + Math.random() * 12]).sort((a, b) => a[1] - b[1]).map((a) => a[0]).slice(0, 5);
    const s = cand[(Math.random() * cand.length) | 0];
    const takes = pool.filter((c) => c.v === s.voice && A.crewBufs[c.f] && !A.recentText(c.t));
    if (!takes.length) { C.t = 0.3; C.reply = null; continue; }
    const c = takes[(Math.random() * takes.length) | 0];
    const dur = A.playVoiceFile(c.f, { pos: s.root.position.clone().setY(s.root.position.y + 1.6), vol: peace ? 1.25 : 1.3, minG: peace ? 0.45 : 0.4, wet: 0.3 });
    if (!dur) { C.t = 0.5; continue; }
    A.markText(c.t); A.claimVoice(s.voice, now, dur);
    const answer = Math.random() < 0.6;
    C.reply = answer ? s : null;
    C.t = dur + (answer ? R(0.1, 0.5) : R(0.3, 1.2));
  }
}
