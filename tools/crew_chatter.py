#!/usr/bin/env python3
"""Bake the crew's idle chatter with Gemini 3.8 Flash TTS (same designed voices as crew_voices.py).

  python3 tools/crew_chatter.py            # generate everything missing
  python3 tools/crew_chatter.py --force    # regenerate all

Two moods:
  peace : before the giant comes home. Relaxed, cheerful banter of sailors raiding a rich shepherd's store.
  tense : the giant is in the cave but nothing is happening right now. Hushed, scared whispers.
Unlike the barks these are spoken, not screamed, so there is no scream judge: one take each.
Output: public/assets/voice/chat/*.mp3 + public/assets/voice/chat/manifest.json
"""
import base64, json, pathlib, random, subprocess, sys, urllib.request, urllib.error, concurrent.futures as cf

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "assets" / "voice" / "chat"; OUT.mkdir(parents=True, exist_ok=True)
RAW = ROOT / "tools" / ".raw_voice" / "chat"; RAW.mkdir(parents=True, exist_ok=True)
GK = next(l.split("=", 1)[1].strip().strip('"') for l in pathlib.Path("~/Projects/xnobasu/.env.local").expanduser().read_text().splitlines() if l.startswith("GEMINI_API_KEY="))
VID = json.load(open(ROOT / "tools" / "gemini-voices.json"))
CREW = ["deep2", "deep3", "crewC", "crewD", "crewE", "crewF", "tenor", "mid", "wiry"]  # same index as crew_voices.py

PERSONA = {
    "deep2": "a hot-headed, boastful fighter",
    "deep3": "a dry, grumbling pessimist",
    "crewC": "a gruff veteran who likes to be in charge",
    "crewD": "a jumpy, talkative man",
    "crewE": "a loud joker",
    "crewF": "a devout young man",
    "tenor": "an eager young sailor",
    "mid": "an ordinary, easygoing man",
    "wiry": "an old sailor who has seen everything",
}
MALE = "An adult man with a natural, masculine voice."
STYLE = {
    "peace": MALE + " Speaking casually and relaxed at normal volume to his shipmates, in good spirits, a bit of a laugh in his voice. "
             "Greek sailors helping themselves to food in a shepherd's cave. Natural conversation, not acting, not shouting.",
    "tense": MALE + " WHISPERING, hushed and breathy, barely audible, terrified of being heard. A giant is in the same cave. "
             "Short, nervous, never loud.",
}
LINES = {
    "peace": [
        "Look at the size of these cheeses!", "Whoever lives here eats better than we do.", "Smells like a goat's armpit in here.",
        "Elpenor, save some for the rest of us!", "I could get used to this.", "Must be a shepherd. A rich one.",
        "Maybe he'll trade us some wine for it.", "Grab a lamb or two, nobody will miss them.", "Careful with that knot, don't drop it.",
        "Ha! You've got cheese in your beard.", "My wife would never believe this.", "Fill your sacks, lads.",
        "These pens are cleaner than my house.", "Is anyone keeping watch?", "Gods, that's good cheese.",
        "Where's the owner, do you think?", "One more wheel and we go.", "Hand me that bucket.",
    ],
    "tense": [
        "Shh. Keep your voice down.", "Is he asleep?", "I can hear him breathing.", "Don't move. Don't even breathe.",
        "What do we do now?", "Stay close to the wall.", "My legs won't stop shaking.", "Athena, protect us.",
        "Where's Odysseus?", "He can't see us here. Can he?", "I want to go home.", "Quiet! He turned his head.",
        "We should never have come in here.", "How long until morning?", "Stay together.", "Did he hear that?",
    ],
}
TAKES = {"peace": 24, "tense": 22}


def tts(text, style, voice):
    b = {"model": "gemini-3.8-flash-tts",
         "input": [{"type": "user_input", "content": [{"type": "text", "text": text, "annotations": [{"type": "speech_metadata", "style": style}]}]}],
         "response_format": {"type": "audio"}, "generation_config": {"speech_config": [{"voice": VID[voice]}]}, "stream": False}
    err = None
    for _ in range(3):
        try:
            d = json.load(urllib.request.urlopen(urllib.request.Request("https://generativelanguage.googleapis.com/v1beta/interactions", json.dumps(b).encode(), {"x-goog-api-key": GK, "Content-Type": "application/json"}), timeout=180))
            return next(base64.b64decode(c["data"]) for s in d["steps"] for c in s.get("content", []) if c.get("type") == "audio")
        except (urllib.error.URLError, StopIteration, TimeoutError) as e:
            err = e
    raise RuntimeError(err)


def make(job):
    name, text, style, voice, mood = job
    raw = RAW / f"{name}.wav"
    if not raw.exists() or "--force" in sys.argv:
        raw.write_bytes(tts(text, style, voice))
    # whispers are normalised quieter than the peaceful talk; both well under the screamed barks (-14 LUFS)
    lufs = -20 if mood == "peace" else -24
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(raw), "-af",
                    f"silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse,loudnorm=I={lufs}:TP=-2",
                    "-ar", "24000", "-ac", "1", "-b:a", "48k", str(OUT / f"{name}.mp3")], check=True)
    return name


def main():
    rnd = random.Random(11)
    jobs, manifest = [], {}
    for mood, lines in LINES.items():
        manifest[mood] = []
        voices = [CREW[i % len(CREW)] for i in range(TAKES[mood])]; rnd.shuffle(voices)
        order = list(range(len(lines))); rnd.shuffle(order)
        for k, v in enumerate(voices):
            line = lines[order[k % len(order)]]  # every line said at least once, a few twice by different men
            name = f"{mood}_{k:02d}_{v}"
            jobs.append((name, line, f"{STYLE[mood]} He is {PERSONA[v]}.", v, mood))
            manifest[mood].append({"f": name + ".mp3", "v": CREW.index(v), "t": line})
    print(len(jobs), "takes")
    bad = []
    with cf.ThreadPoolExecutor(6) as ex:
        futs = {ex.submit(make, j): j[0] for j in jobs}
        for f in cf.as_completed(futs):
            try: f.result(); print("ok", futs[f], flush=True)
            except Exception as e: bad.append(futs[f]); print("ERR", futs[f], e, flush=True)
    for mood in manifest:
        manifest[mood] = [x for x in manifest[mood] if x["f"][:-4] not in bad]
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=1, ensure_ascii=False))
    print("failed:", bad)


if __name__ == "__main__":
    main()
