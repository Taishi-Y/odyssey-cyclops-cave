#!/usr/bin/env python3
"""Generate character voice lines with Gemini 3.8 Flash TTS.

usage: python3 tools/tts.py tools/voice-lines.json public/assets/voice
Key: GEMINI_API_KEY env, or falls back to ~/Projects/xnobasu/.env.local
"""
import base64, json, os, pathlib, sys, urllib.request

MODEL = os.environ.get("TTS_MODEL", "gemini-3.8-flash-tts")
URL = "https://generativelanguage.googleapis.com/v1beta/interactions"


def api_key():
    k = os.environ.get("GEMINI_API_KEY")
    if k:
        return k
    for line in pathlib.Path("~/Projects/xnobasu/.env.local").expanduser().read_text().splitlines():
        if line.startswith("GEMINI_API_KEY="):
            return line.split("=", 1)[1].strip().strip('"')
    sys.exit("no GEMINI_API_KEY")


def synth(key, text, voice, style):
    body = {
        "model": MODEL,
        "input": [{"type": "user_input", "content": [{
            "type": "text", "text": text,
            "annotations": [{"type": "speech_metadata", "style": style}],
        }]}],
        "response_format": {"type": "audio"},
        "generation_config": {"speech_config": [{"voice": voice}]},
        "stream": False,
    }
    req = urllib.request.Request(URL, json.dumps(body).encode(), {
        "x-goog-api-key": key, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as r:
        d = json.load(r)
    for step in d.get("steps", []):
        for c in step.get("content", []):
            if c.get("type") == "audio":
                return base64.b64decode(c["data"])
    raise RuntimeError(json.dumps(d)[:500])


def main():
    spec = json.load(open(sys.argv[1]))
    out = pathlib.Path(sys.argv[2]); out.mkdir(parents=True, exist_ok=True)
    key = api_key()
    only = set(sys.argv[3:])
    for ln in spec["lines"]:
        if only and ln["id"] not in only:
            continue
        ch = spec["characters"][ln["who"]]
        style = ch["style"] + ". " + ln.get("direction", "")
        wav = synth(key, ln["text"], ch["voice"], style)
        (out / f"{ln['id']}.wav").write_bytes(wav)
        print("ok", ln["id"], len(wav))


if __name__ == "__main__":
    main()
