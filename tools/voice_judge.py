#!/usr/bin/env python3
"""Listen to a baked voice take with Gemini and score how hard the man is SCREAMING (1-10).
Used by crew_voices.py / crew_orders.py to throw away takes that come out as normal speech.

  python3 tools/voice_judge.py file.wav [...]     # print scores
"""
import base64, json, pathlib, sys, urllib.request
import crew_voices as cv

MODEL = "gemini-3.8-flash"
PROMPT = ("You are a strict voice director for a horror game. Listen to this voice clip of a man. "
          "Rate his vocal intensity from 1 to 10: 1-3 = normal conversational speaking or calm narration, "
          "4-6 = raised voice / loud talking / tense but controlled, 7-8 = real shouting, "
          "9-10 = all-out screaming at the top of his lungs with maximum emotion (panic, terror, rage), voice straining or cracking. "
          "Loud, unhinged maniacal laughing and shrill shrieking or frantic screamed praying also count as all-out screaming. "
          "Judge the WHOLE clip: if any sentence is delivered in a normal speaking voice, score it at most 5. "
          'Reply with JSON only: {"intensity": <int>, "calm_parts": "<which words sound like normal talking, or empty>"}')


def judge(path):
    data = base64.b64encode(pathlib.Path(path).read_bytes()).decode()
    mime = "audio/wav" if str(path).endswith(".wav") else "audio/mpeg"
    body = {"contents": [{"parts": [{"inline_data": {"mime_type": mime, "data": data}}, {"text": PROMPT}]}],
            "generationConfig": {"responseMimeType": "application/json", "temperature": 0}}
    for _ in range(3):
        try:
            r = json.load(urllib.request.urlopen(urllib.request.Request(
                f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent",
                json.dumps(body).encode(), {"x-goog-api-key": cv.GK, "Content-Type": "application/json"}), timeout=120))
            j = json.loads(r["candidates"][0]["content"]["parts"][0]["text"])
            return int(j.get("intensity", 0)), j.get("calm_parts", "")
        except Exception as e:
            err = e
    raise RuntimeError(err)


if __name__ == "__main__":
    import concurrent.futures as cf
    with cf.ThreadPoolExecutor(8) as ex:
        for p, (s, c) in zip(sys.argv[1:], ex.map(judge, sys.argv[1:])):
            print(s, pathlib.Path(p).stem, c, flush=True)
