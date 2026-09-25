#!/usr/bin/env python3
"""Bake the crew's panic barks + the scripted dialogue with Gemini 3.8 Flash TTS.

  python3 tools/crew_voices.py            # generate everything missing
  python3 tools/crew_voices.py --force    # regenerate all

Voices are designed voices (tools/gemini-voices.json, valid until 2027-09).
Every take is an adult man SHOUTING. The pitch is never changed after generation: a deep voice is asked for
in the prompt (MALE / style text), the audio is only trimmed and loudness-normalised.
Output: public/assets/voice/*.mp3 + public/assets/voice/manifest.json
"""
import numpy as np
import base64, json, pathlib, random, subprocess, sys, tempfile, urllib.request, urllib.error, concurrent.futures as cf

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "assets" / "voice"; OUT.mkdir(parents=True, exist_ok=True)
GK = next(l.split("=", 1)[1].strip().strip('"') for l in pathlib.Path("~/Projects/xnobasu/.env.local").expanduser().read_text().splitlines() if l.startswith("GEMINI_API_KEY="))
VID = json.load(open(ROOT / "tools" / "gemini-voices.json"))
CREW = ["deep2", "deep3", "crewC", "crewD", "crewE", "crewF", "tenor", "mid", "wiry"]  # crew voices A-I, low to high mixed
RAW = ROOT / "tools" / ".raw_voice"; RAW.mkdir(exist_ok=True)
MALE = ("An adult man with a deep, low, masculine chest voice. SCREAMING at the absolute top of his lungs the ENTIRE time, "
        "every single word, a hoarse, raw, guttural yell tearing from the chest, voice straining and cracking. "
        "Never speaking normally, never calm, never conversational, never narrating, never whispering, never high-pitched or shrill.")
SCREAM = "EMOTION 10 out of 10, MAXIMUM. SCREAMING every word, no normal speech anywhere in the line."

# Every bark take = random line x random mood x random intensity, performed by a man with his own personality,
# so no two shouts are delivered the same way. Every mood is an all-out scream: no quiet or numb deliveries.
PERSONA = {
    "deep2": "a hot-headed fighter whose fear comes out as RAGE: snarling, roaring curses at the monster",
    "deep3": "a grim man sure he is about to die, SCREAMING in bitter despair",
    "crewC": "a gruff veteran BELLOWING orders while terrified",
    "crewD": "a jumpy man who explodes into hysterical screaming",
    "crewE": "a loud, hysterical man who completely loses control and SCREAMS at everything",
    "crewF": "a devout young man SCREAMING prayers and sobbing, calling on the gods",
    "tenor": "a young sailor, a coward SCREAMING and begging",
    "mid": "an ordinary man in total disbelief, SCREAMING the same words over and over",
    "wiry": "a nervous old sailor who screams fast and rough",
}
INTENSITY = ["10 out of 10, MAXIMUM, completely unhinged", "10 out of 10, MAXIMUM, voice tearing apart", "10 out of 10, MAXIMUM, screaming his throat raw"]
MOODS = [SCREAM + " Pure terror.", SCREAM + " Hysterical panic, ragged gasps between screams.", SCREAM + " Roaring rage.",
         SCREAM + " Screaming and sobbing at once.", SCREAM + " Desperate, frantic, breathless."]
# category -> (moods, lines). lines: short, exclamatory, no trailing-off "..." (that makes the model go quiet)
BARKS = {
    "arrive": (MOODS, ["What IS that?!! <gasp> The ground, it's SHAKING!!", "Something's COMING!! <gasp> Something HUGE!!", "Gods HELP us!! <gasp> GODS HELP US!!",
                       "Get DOWN!! GET DOWN!!", "Oh no!! <gasp> NO NO NO!!", "Did you HEAR that?!! <gasp> Did you HEAR that?!!", "HIDE!! Anywhere!! Just HIDE!!",
                       "That's not an ANIMAL!! <gasp> That's NOT an ANIMAL!!"]),
    "sealed": (MOODS, ["The DOOR!! <gasp> He's blocking the DOOR!!", "We're TRAPPED!! WE'RE TRAPPED!!", "No!! NO!! Let us OUT!!", "PUSH it!! PUSH!! <gasp> It won't MOVE!!",
                       "We'll never get OUT!! <gasp> NEVER!!", "He's shut us IN!! <gasp> He's shut us in with HIM!!", "It's a TOMB!! <gasp> This is our TOMB!!"]),
    "grab": (MOODS, ["NOOO!! <gasp> LET ME GO!! LET ME GO!!", "HELP ME!! HELP!! <gasp> ODYSSEUS!!", "No no no NO!! PLEASE!! PLEASE!!", "AAAH!! <gasp> GET IT OFF ME!!",
                     "Don't let him TAKE me!! <gasp> DON'T LET HIM!!", "MOTHER!! <gasp> MOTHER!!", "I don't want to DIE!! <gasp> I DON'T WANT TO DIE!!"]),
    "witness": (MOODS, ["He's GOT him!! <gasp> He's GOT HIM!!", "Do something!! DO SOMETHING!!", "Kill it!! KILL IT!!", "Let him GO!! <gasp> LET HIM GO, YOU MONSTER!!",
                        "Gods, NO!! NOT HIM!!", "Don't LOOK!! <gasp> DON'T LOOK!!", "Grab his arm!! <gasp> PULL HIM DOWN!!", "Stab it!! STAB ITS HAND!!"]),
    "eaten": (MOODS, ["He ATE him!! <gasp> He ATE HIM!!", "NO!! <gasp> NO!! Gods have MERCY!!", "We're all going to DIE in here!! <gasp> ALL OF US!!",
                      "I heard his BONES!! <gasp> I HEARD HIS BONES!!", "He was RIGHT THERE!! <gasp> RIGHT THERE!!", "ZEUS, PROTECT US!! <gasp> PLEASE!!"]),
    "dropped": (MOODS, ["He DROPPED him!! <gasp> RUN!! RUN!!", "Get UP!! <gasp> Get up and RUN!!", "Move!! MOVE!! GO GO GO!!", "He's ALIVE!! <gasp> Grab him, GRAB HIM!!",
                        "This WAY!! <gasp> THIS WAY!!"]),
    "spotted": (MOODS, ["He's SEEN us!! <gasp> He's COMING!!", "He's COMING!! AIM FOR THE EYE!!", "LOOK OUT!! <gasp> BEHIND YOU!!", "RUN!! <gasp> RUN FOR YOUR LIVES!!",
                        "He's LOOKING at us!! <gasp> He's LOOKING AT US!!", "Scatter!! SCATTER!!", "Not ME!! <gasp> NOT ME!!"]),
    "waking": (MOODS, ["NO NO NO!! <gasp> He's WAKING UP!!", "He's WAKING!! <gasp> HE'S WAKING!!", "He's MOVING!! <gasp> HE'S MOVING!!", "Get BACK!! <gasp> He's getting UP!!",
                       "His EYE!! <gasp> HIS EYE IS OPEN!!"]),
    "blind": (MOODS, ["He's BLIND!! <gasp> Stay LOW!! STAY LOW!!", "His HANDS!! <gasp> WATCH HIS HANDS!!", "He's gone MAD!! <gasp> Get back!! GET BACK!!",
                      "We DID it!! <gasp> Gods, we DID IT!!", "He's feeling for us!! <gasp> DON'T MOVE!! DON'T MOVE!!"]),
}
TAKES_PER_CAT = {"arrive": 14, "sealed": 12, "grab": 14, "witness": 16, "eaten": 12, "dropped": 10, "spotted": 14, "waking": 10, "blind": 10}


def bark_style(voice, mood, level):
    return f"{MALE} Emotion {level}. You are {PERSONA[voice]}. {mood} A man trapped in a cave with a man-eating giant."

# scripted dialogue: exact say() text -> (voice, style, tts text). every line is screamed too
LINE = SCREAM + " A man trapped in a cave with a man-eating giant, screaming at the others."
LINES = {
    "We followed the sheep and found this… There are bags of cheese hanging on the walls": ("tenor", LINE + " Wild, overexcited.", "We followed the sheep and found THIS!! <gasp> There are bags of CHEESE hanging on the WALLS!!"),
    "Food. Take as much as we can carry back to the ships": ("crewC", LINE + " Bellowing, greedy.", "FOOD!! Take as much as we can CARRY back to the SHIPS!!"),
    "…The ground is shaking": ("crewD", LINE + " Terror.", "<gasp> The GROUND!! The ground is SHAKING!!"),
    "Hide!": ("odysseus", LINE + " A captain roaring an order to his men as a giant arrives.", "HIDE!! <breath> HIDE, NOW!!"),
    "The entrance… he's sealed it with a rock": ("crewC", LINE + " Hysterical panic.", "The ENTRANCE!! <gasp> He's SEALED it with a ROCK!!"),
    "That eye… he only has the one. Aim for it": ("odysseus", LINE + " A captain roaring an order.", "That EYE!! <breath> He only has the ONE!! AIM FOR IT!!"),
    "He's asleep… it's now or never": ("crewC", LINE + " Desperate urgency.", "He's ASLEEP!! <breath> It's NOW or NEVER!!"),
    "It's done! Now he'll guard the door… our only way out is with the sheep": ("odysseus", LINE + " Adrenaline after a desperate fight.", "It's DONE!! <gasp> Now he'll guard the DOOR!! Our only way out is with the SHEEP!!"),
    "He's feeling every sheep as it passes… straw on your back. Go on all fours": ("crewC", LINE + " Frantic.", "He's feeling EVERY SHEEP as it passes!! <breath> Straw on your BACK!! Go on ALL FOURS!!"),
    "It can talk. Why didn't it talk before?": ("tenor", LINE + " Horrified disbelief.", "It can TALK!! <gasp> Why didn't it talk BEFORE?!!"),
    "Do you talk to ants?": ("odysseus", LINE + " Roaring fury.", "Do you talk to ANTS?!!"),
    "Hit the eye! Get away while you can": ("odysseus", LINE + " A captain roaring an order.", "Hit the EYE!! <gasp> Get away while you CAN!!"),
    "Heavy… but sharpened and hardened in the fire…": ("odysseus", LINE + " Straining under a heavy log.", "<breath> HEAVY!! But sharpened and HARDENED in the FIRE!!"),
    "The tip is glowing red. Now": ("odysseus", LINE + " A captain roaring an order.", "The tip is glowing RED!! <breath> NOW!!"),
    "Straw tied on. Crouched, I should pass for a sheep… I hope": ("odysseus", LINE + " Hysterical, the giant is right behind him, SCREAMING at himself in blind panic to keep going.", "STRAW TIED ON!! <gasp> CROUCHED!! I should pass for a SHEEP!! <gasp> GODS, I HOPE!!"),
    "Wait for the moment…": ("odysseus", LINE + " Straining with tension.", "WAIT!! <breath> Wait for the MOMENT!!"),
}


def tts(text, style, voice):
    b = {"model": "gemini-3.8-flash-tts",
         "input": [{"type": "user_input", "content": [{"type": "text", "text": text, "annotations": [{"type": "speech_metadata", "style": style}]}]}],
         "response_format": {"type": "audio"}, "generation_config": {"speech_config": [{"voice": VID[voice]}]}, "stream": False}
    for attempt in range(3):
        try:
            d = json.load(urllib.request.urlopen(urllib.request.Request("https://generativelanguage.googleapis.com/v1beta/interactions", json.dumps(b).encode(), {"x-goog-api-key": GK, "Content-Type": "application/json"}), timeout=180))
            return next(base64.b64decode(c["data"]) for s in d["steps"] for c in s.get("content", []) if c.get("type") == "audio")
        except (urllib.error.URLError, StopIteration, TimeoutError) as e:
            err = e
    raise RuntimeError(err)


import os
MIN_SCORE, TRIES = 9, int(os.environ.get("VOICE_TRIES", 5))
SCORES = RAW / "scores.json"
_scores = json.loads(SCORES.read_text()) if SCORES.exists() else {}
import threading; _lock = threading.Lock()


def gen_raw(name, text, style, voice):
    """generate until the judge hears an all-out scream (>= MIN_SCORE), keep the best of TRIES takes"""
    from voice_judge import judge
    dst = RAW / f"{name}.wav"
    key = f"{name}|{voice}|{text}|{style}"
    if dst.exists() and "--force" not in sys.argv and _scores.get(name, {}).get("key") == key:
        return name
    best = None
    for i in range(TRIES):
        wav = tts(text, style, voice)
        tmp = RAW / f"{name}.try{i}.wav"; tmp.write_bytes(wav)
        sc, calm = judge(tmp)
        print(f"  {name} try{i}: {sc} {calm}", flush=True)
        if not best or sc > best[0]: best = (sc, tmp)
        if sc >= MIN_SCORE: break
    best[1].replace(dst)
    for f in RAW.glob(f"{name}.try*.wav"): f.unlink()
    with _lock:
        _scores[name] = {"key": key, "score": best[0]}
        SCORES.write_text(json.dumps(_scores, indent=1))
    return name


def f0_list(path):
    x = np.frombuffer(subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-f", "s16le", "-ac", "1", "-ar", "24000", "-"], capture_output=True).stdout, np.int16).astype(float)
    sr, out = 24000, []
    for i in range(0, len(x) - 2048, 1024):
        fr = x[i:i + 2048]
        if np.sqrt((fr ** 2).mean()) < 1500: continue
        ac = np.correlate(fr, fr, "full")[2047:]
        lo, hi = sr // 600, sr // 60
        k = lo + int(np.argmax(ac[lo:hi]))
        if ac[k] > 0.4 * ac[0]: out.append(sr / k)
    return out


def encode(name):
    # the pitch is left exactly as generated: a lower voice is asked for in the prompt, never pitched down afterwards
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(RAW / f"{name}.wav"), "-af",
                    "silenceremove=start_periods=1:start_threshold=-45dB,loudnorm=I=-14:TP=-1",
                    "-ar", "24000", "-ac", "1", "-b:a", "64k", str(OUT / f"{name}.mp3")], check=True)


def main():
    rnd = random.Random(7)
    jobs, manifest = [], {"barks": {}, "lines": {}}
    for cat, (moods, lines) in BARKS.items():
        manifest["barks"][cat] = []
        seen = set()
        voices = [CREW[i % len(CREW)] for i in range(TAKES_PER_CAT[cat])]; rnd.shuffle(voices)  # every man gets a turn
        for k, v in enumerate(voices):
            while True:
                li = rnd.randrange(len(lines))
                if (li, v) not in seen: break
            seen.add((li, v))
            name = f"{cat}_{k:02d}_{v}"
            jobs.append((name, lines[li], bark_style(v, rnd.choice(moods), rnd.choice(INTENSITY)), v))
            manifest["barks"][cat].append({"f": name + ".mp3", "v": CREW.index(v), "t": lines[li]})
    for i, (key, (v, style, text)) in enumerate(LINES.items()):
        name = f"line_{i:02d}_{v}"
        jobs.append((name, text, MALE + " " + style, v)); manifest["lines"][key] = {"f": name + ".mp3", "v": CREW.index(v) if v in CREW else -1}
    print(len(jobs), "takes")
    bad = []
    with cf.ThreadPoolExecutor(6) as ex:
        futs = {ex.submit(gen_raw, *j): j[0] for j in jobs}
        for f in cf.as_completed(futs):
            try: f.result(); print("ok", futs[f], flush=True)
            except Exception as e: bad.append(futs[f]); print("ERR", futs[f], e, flush=True)
    for f in OUT.glob("*.mp3"): f.unlink()
    with cf.ThreadPoolExecutor(8) as ex:
        list(ex.map(lambda j: encode(j[0]), [j for j in jobs if j[0] not in bad]))
    for cat in manifest["barks"]:
        manifest["barks"][cat] = [b for b in manifest["barks"][cat] if b["f"][:-4] not in bad]
    manifest["lines"] = {k: v for k, v in manifest["lines"].items() if v["f"][:-4] not in bad}
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=1, ensure_ascii=False))
    print("failed:", bad)


if __name__ == "__main__":
    main()
