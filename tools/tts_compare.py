#!/usr/bin/env python3
import os, sys
"""A/B panic lines: Gemini 3.8 Flash TTS (designed voice) vs Fish Audio S2.1 Pro.
Writes public/voice-test/*.{wav,mp3} and public/voice-preview.html"""
import base64, json, pathlib, plistlib, sys, urllib.request, concurrent.futures as cf

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "voice-test"; OUT.mkdir(parents=True, exist_ok=True)
GK = os.environ.get("GEMINI_API_KEY") or sys.exit("set GEMINI_API_KEY")
FK = plistlib.load(open(pathlib.Path("~/Projects/Inko/Inko/Secrets.plist").expanduser(), "rb"))["FISH_API_KEY"]
GV = json.load(open("/tmp/tts/voices.json"))

# id, gemini text, gemini style, fish text
LINES = [
    ("coming",
     "<gasp> He's- he's COMING!! <gasp> AIM FOR THE EYE!! THE EYE!!",
     "Maximum intensity horror-film performance: a man SCREAMING for his life at the top of his lungs, hysterical, voice cracking and going hoarse, ragged panicked gasps between words. Not whispering, not restrained, completely out of control.",
     "[gasping] He's, he's COMING!! [screaming in terror] AIM FOR THE EYE!! THE EYE!!"),
    ("run",
     "He dropped him!! <breath> RUN!! <gasp> RUN!! GO GO GO!!",
     "Shrieking in blind terror while sprinting for his life, gasping, voice breaking, maximum volume, pure animal panic. Not whispering.",
     "[panicked shouting] He dropped him!! [heavy breathing] RUN!! RUN!! [screaming] GO GO GO!!"),
    ("waking",
     "No... no no no NO NO! <gasp> He's waking up!! He's WAKING UP!!",
     "Starts as a terrified trembling whisper, then escalates into a hysterical scream, voice cracking, near tears.",
     "[whispering in fear] No... no no no [panicked] NO NO! [gasping] He's waking up!! [screaming] He's WAKING UP!!"),
    ("hide",
     "HIDE!! <breath> Everyone HIDE, NOW!!",
     "A captain bellowing an alarmed order with all his strength across a cavern, adrenaline, fear breaking through his authority. Not whispering.",
     "[shouting urgently] HIDE!! [panting] Everyone HIDE, NOW!!"),
]
FISH_VOICES = {  # generic community voices (no celebrity clones)
    "fishA": ("59de2c5351de497b9cb0ec1537a8f2a9", "scream: middle-aged male, dynamic"),
    "fishB": ("99d04b0bd5d7420cba8ba4c61f7dfa76", "9ine: intense screaming male"),
    "fishC": ("ef9c79b62ef34530bf452c0e50e3c260", "horror: deep middle-aged male"),
}


def gemini(text, style, voice):
    b = {"model": "gemini-3.8-flash-tts",
         "input": [{"type": "user_input", "content": [{"type": "text", "text": text, "annotations": [{"type": "speech_metadata", "style": style}]}]}],
         "response_format": {"type": "audio"}, "generation_config": {"speech_config": [{"voice": voice}]}, "stream": False}
    d = json.load(urllib.request.urlopen(urllib.request.Request("https://generativelanguage.googleapis.com/v1beta/interactions", json.dumps(b).encode(), {"x-goog-api-key": GK, "Content-Type": "application/json"}), timeout=180))
    return next(base64.b64decode(c["data"]) for s in d["steps"] for c in s.get("content", []) if c.get("type") == "audio")


def fish(text, ref):
    b = {"text": text, "format": "mp3", "reference_id": ref, "temperature": 0.9}
    return urllib.request.urlopen(urllib.request.Request("https://api.fish.audio/v1/tts", json.dumps(b).encode(), {"Authorization": "Bearer " + FK, "Content-Type": "application/json", "model": "s2.1-pro"}), timeout=180).read()


def job(kind, lid, gt, gs, ft):
    if kind.startswith("fish"):
        name = f"{lid}_{kind}.mp3"; data = fish(ft, FISH_VOICES[kind][0])
    else:
        name = f"{lid}_{kind}.wav"; data = gemini(gt, gs, GV["captain" if lid == "hide" and kind == "gemini" else "sailor"] if kind == "gemini" else "Sadachbia")
    (OUT / name).write_bytes(data); return name


jobs = [(k, *l) for l in LINES for k in ["gemini", "gemini_prebuilt", *FISH_VOICES]]
with cf.ThreadPoolExecutor(6) as ex:
    for f in cf.as_completed([ex.submit(job, *j) for j in jobs]):
        try: print("ok", f.result())
        except Exception as e: print("ERR", e, getattr(e, "read", lambda: b"")()[:300])

label = {"gemini": "Gemini 3.8 (デザインした声)", "gemini_prebuilt": "Gemini 3.8 (既存 Sadachbia)", **{k: f"Fish S2.1 Pro ({v[1]})" for k, v in FISH_VOICES.items()}}
html = ["<html><meta charset=utf-8><meta name=viewport content='width=device-width'><body style='font-family:sans-serif;background:#111;color:#eee;padding:14px'><h3>パニック演技 聴き比べ</h3>"]
for lid, gt, *_ in LINES:
    html.append(f"<h4 style='margin:22px 0 6px'>{gt.replace('<','&lt;')}</h4>")
    for k in label:
        ext = "mp3" if k.startswith("fish") else "wav"
        if (OUT / f"{lid}_{k}.{ext}").exists():
            html.append(f"<div style='background:#222;border-radius:8px;padding:8px;margin:6px 0'><small>{label[k]}</small><audio controls preload=none style='width:100%' src='voice-test/{lid}_{k}.{ext}'></audio></div>")
(ROOT / "public" / "voice-preview.html").write_text("".join(html) + "</body></html>")
print("done")
