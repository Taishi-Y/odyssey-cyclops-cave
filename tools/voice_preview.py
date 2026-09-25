#!/usr/bin/env python3
"""Build public/voice-preview.html from public/assets/voice/manifest.json.
Each situation has a 'play all together' button that layers the takes like in-game."""
import json, pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent
m = json.load(open(ROOT / "public/assets/voice/manifest.json"))
JA = {"arrive": "巨人が来る", "sealed": "入口を塞がれる", "grab": "掴まれた本人", "witness": "仲間が掴まれるのを見て", "eaten": "食べられた直後",
      "dropped": "巨人が手を離した", "spotted": "見つかった", "waking": "巨人が起きる", "blind": "目を潰した後"}
AB = "ABCDEFGHI"
h = ["""<html><meta charset=utf-8><meta name=viewport content='width=device-width'><body style='font-family:sans-serif;background:#111;color:#eee;padding:14px'>
<h3>船員の叫び (Gemini 3.8)</h3><p style='color:#999;font-size:13px'>「全員で叫ぶ」はゲーム内と同じように3〜4人を少しずつずらして重ねて再生します。</p>
<script>
const ctx=new (window.AudioContext||window.webkitAudioContext)();const cache={};
async function buf(f){if(!cache[f])cache[f]=await ctx.decodeAudioData(await (await fetch('assets/voice/'+f)).arrayBuffer());return cache[f]}
async function crowd(files){await ctx.resume();const pick=files.sort(()=>Math.random()-.5).slice(0,4);let t=ctx.currentTime+.1;
for(const f of pick){const s=ctx.createBufferSource();s.buffer=await buf(f);const p=ctx.createStereoPanner();p.pan.value=Math.random()*1.6-.8;s.connect(p).connect(ctx.destination);s.start(t);t+=.2+Math.random()*.6}}
</script>"""]
btn = "background:#c9a26a;color:#111;border:0;border-radius:8px;padding:10px 14px;font-size:15px;font-weight:bold;margin:4px 0 8px"
for cat, takes in m["barks"].items():
    files = json.dumps([t["f"] for t in takes])
    h.append(f"<h4 style='margin:24px 0 4px'>{JA.get(cat, cat)}</h4><button style='{btn}' onclick='crowd({files})'>▶ 全員で叫ぶ</button>")
    for t in takes:
        h.append(f"<div style='background:#222;border-radius:8px;padding:6px 8px;margin:4px 0'><small>船員{AB[t['v']]}: {t.get('t','').replace('<','&lt;')}</small><audio controls preload=none style='width:100%;height:36px' src='assets/voice/{t['f']}'></audio></div>")
h.append("<h4 style='margin:28px 0 4px'>ストーリーのセリフ</h4>")
for text, l in m["lines"].items():
    who = "オデュッセウス" if l["v"] < 0 else "船員" + AB[l["v"]]
    h.append(f"<div style='background:#222;border-radius:8px;padding:6px 8px;margin:4px 0'><small>{who}: {text}</small><audio controls preload=none style='width:100%;height:36px' src='assets/voice/{l['f']}'></audio></div>")
(ROOT / "public/voice-preview.html").write_text("".join(h) + "</body></html>")
print("ok")
