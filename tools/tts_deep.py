#!/usr/bin/env python3
"""Deepest-voice, max-panic takes with Gemini 3.8 Flash TTS.
Writes public/voice-deep/*.wav and public/voice-preview.html"""
import base64, json, pathlib, subprocess, urllib.request, wave, concurrent.futures as cf
import numpy as np

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "voice-deep"; OUT.mkdir(parents=True, exist_ok=True)
GK = next(l.split("=", 1)[1].strip().strip('"') for l in pathlib.Path("~/Projects/xnobasu/.env.local").expanduser().read_text().splitlines() if l.startswith("GEMINI_API_KEY="))
V = json.load(open("/tmp/tts/voices.json"))
VOICES = {"deep2": V["deep2"], "deep3": V["deep3"], "prev": V["sailor"]}

MAX = ("MAXIMUM emotion, 10 out of 10. Speak in the LOWEST, deepest register of your chest voice the whole time, "
       "even while screaming: a deep, guttural, hoarse ROAR, never high-pitched or shrill. "
       "Total hysterical panic, a man about to be eaten alive: screaming at full volume, voice tearing and cracking, "
       "desperate ragged gasps, trembling, on the verge of sobbing. Completely uncontrolled, not whispering, not acting calm.")
LINES = [
    ("coming", "<gasp> He's- he's COMING!! <gasp> AIM FOR THE EYE!! THE EYE!!"),
    ("run", "He dropped him!! <breath> RUN!! <gasp> RUN!! GO GO GO!!"),
    ("waking", "No... no no no NO NO!! <gasp> He's waking up!! He's WAKING UP!!"),
    ("hide", "HIDE!! <breath> Everyone HIDE, NOW!!"),
]


def gemini(text, voice):
    b = {"model": "gemini-3.8-flash-tts",
         "input": [{"type": "user_input", "content": [{"type": "text", "text": text, "annotations": [{"type": "speech_metadata", "style": MAX}]}]}],
         "response_format": {"type": "audio"}, "generation_config": {"speech_config": [{"voice": voice}]}, "stream": False}
    d = json.load(urllib.request.urlopen(urllib.request.Request("https://generativelanguage.googleapis.com/v1beta/interactions", json.dumps(b).encode(), {"x-goog-api-key": GK, "Content-Type": "application/json"}), timeout=180))
    return next(base64.b64decode(c["data"]) for s in d["steps"] for c in s.get("content", []) if c.get("type") == "audio")


def pitch_down(src, dst, semis=3):
    r = 2 ** (-semis / 12)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(src), "-af", f"asetrate=24000*{r:.5f},aresample=24000,atempo={1/r:.5f}", str(dst)], check=True)


def median_f0(path):
    with wave.open(str(path)) as w:
        sr = w.getframerate(); x = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(float)
    f0 = []
    for i in range(0, len(x) - 2048, 1024):
        fr = x[i:i + 2048]
        if np.sqrt((fr ** 2).mean()) < 800: continue
        ac = np.correlate(fr, fr, "full")[2047:]
        lo, hi = sr // 400, sr // 60
        p = lo + int(np.argmax(ac[lo:hi]))
        if ac[p] > 0.3 * ac[0]: f0.append(sr / p)
    return round(float(np.median(f0))) if f0 else 0


def job(v, lid, text):
    p = OUT / f"{lid}_{v}.wav"; p.write_bytes(gemini(text, VOICES[v])); return p


with cf.ThreadPoolExecutor(6) as ex:
    done = [f.result() for f in cf.as_completed([ex.submit(job, v, l, t) for l, t in LINES for v in VOICES])]
for lid, _ in LINES:  # pitched-down variant of deep2
    pitch_down(OUT / f"{lid}_deep2.wav", OUT / f"{lid}_deep2low.wav")

label = {"deep2": "低い声A", "deep3": "低い声B", "deep2low": "低い声A をさらに3半音下げ", "prev": "前回の声(比較用)"}
html = ["<html><meta charset=utf-8><meta name=viewport content='width=device-width'><body style='font-family:sans-serif;background:#111;color:#eee;padding:14px'><h3>低音 × パニック最大</h3>"]
for lid, t in LINES:
    html.append(f"<h4 style='margin:22px 0 6px'>{t.replace('<','&lt;')}</h4>")
    for k, name in label.items():
        p = OUT / f"{lid}_{k}.wav"; f0 = median_f0(p)
        print(f"{p.name:22s} F0 {f0} Hz")
        html.append(f"<div style='background:#222;border-radius:8px;padding:8px;margin:6px 0'><small>{name} ・ 声の高さ {f0}Hz</small><audio controls preload=none style='width:100%' src='voice-deep/{p.name}'></audio></div>")
(ROOT / "public" / "voice-preview.html").write_text("".join(html) + "</body></html>")
