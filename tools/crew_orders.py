#!/usr/bin/env python3
"""Bake the squad leader's battle orders + the crew's acknowledgements (Gemini TTS, same pipeline as crew_voices.py).

  python3 tools/crew_orders.py          # generate missing takes, merge into public/assets/voice/manifest.json

orders: shouted by the current squad leader (Eurylochus crewC, then Perimedes crewD) or by Odysseus (player).
ack:    short battle cries from the men who obey.
"""
import json, subprocess, concurrent.futures as cf
import numpy as np
import crew_voices as cv

# own folder + manifest: crew_voices.py wipes voice/*.mp3 and rewrites voice/manifest.json when it runs
OUT = cv.OUT / "orders"; OUT.mkdir(exist_ok=True)
COMMAND = ("An adult man with a deep, low, masculine chest voice. A battle commander SCREAMING an order at the absolute top of his lungs "
           "across a huge echoing cave while a man-eating giant rampages. EMOTION 10 out of 10, MAXIMUM: every word roared, "
           "voice straining and cracking, raw and hoarse, desperate fury. Never speaking normally, never calm, never high-pitched, never whispering.")
ORDERS = {
    "attack": ["All together!! <breath> ATTACK!! Go for his LEGS!!", "NOW!! <breath> Everyone, CHARGE!!", "At him, all of you!! NOW!!"],
    "flank": ["Split up!! Half of you draw his eye, <breath> the rest hit him from BEHIND!!", "Surround him!! <breath> Left side with me, right side GO!!", "Get behind him!! <breath> Take his legs from BEHIND!!"],
    "scatter": ["SCATTER!! <breath> Don't bunch up!! SCATTER!!", "Split up!! <breath> Run different ways!!", "Break apart!! <breath> He can't catch us ALL!!"],
    "fallback": ["Fall back!! <breath> FALL BACK!!", "Back off!! <breath> Get out of his REACH!!", "Pull back to the wall!! NOW!!"],
    "regroup": ["On me!! <breath> Form up!! ON ME!!", "Regroup!! <breath> Stay TOGETHER!!", "To me!! <breath> Close ranks!!"],
}
ACK = ["YES!!", "Go, go, GO!!", "With you!!", "TOGETHER!!", "For ITHACA!!", "Hyaaah!!"]
ACK_STYLE = ("An adult man with a deep, rough chest voice, a soldier SCREAMING a battle cry at the top of his lungs in reply to his commander. "
             "EMOTION 10 out of 10, MAXIMUM: adrenaline and terror, voice tearing. Never speaking normally, never high-pitched.")
SPECIAL_ACK = {"maniac": ["HAHAHAHA!! YES!!", "HAHAHA!! <laugh> Let's GO!!"], "zealot": ["For ZEUS!! For ZEUS!!", "The gods are WITH us!!"]}
LEADERS = ["crewC", "crewD", "odysseus"]


def encode(name):
    # pitch left as generated (a deep voice is asked for in the prompt)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(cv.RAW / f"{name}.wav"), "-af",
                    "silenceremove=start_periods=1:start_threshold=-45dB,loudnorm=I=-12:TP=-0.5",
                    "-ar", "24000", "-ac", "1", "-b:a", "80k", str(OUT / f"{name}.mp3")], check=True)


def main():
    jobs, orders = [], {}
    for o, lines in ORDERS.items():
        orders[o] = []
        for v in LEADERS:
            for k, t in enumerate(lines):
                name = f"order_{o}_{k}_{v}"
                jobs.append((name, t, COMMAND, v))
                orders[o].append({"f": name + ".mp3", "v": v, "t": t})
    ack = []
    for k, v in enumerate(cv.BASE_CREW + cv.BASE_CREW[:3]):
        t = ACK[k % len(ACK)]
        name = f"ack_{k:02d}_{v}"
        jobs.append((name, t, ACK_STYLE, v)); ack.append({"f": name + ".mp3", "v": cv.CREW.index(v), "t": t})
    for v, lines in SPECIAL_ACK.items():  # the laughing madman and the shrieking zealot answer in character
        for k, t in enumerate(lines):
            name = f"ack_{v}_{k}"
            jobs.append((name, t, cv.SPECIAL[v]["voice"], v)); ack.append({"f": name + ".mp3", "v": cv.CREW.index(v), "t": t})
    print(len(jobs), "takes", flush=True)
    bad = set()
    with cf.ThreadPoolExecutor(6) as ex:
        futs = {ex.submit(cv.gen_raw, *j): j[0] for j in jobs}
        for f in cf.as_completed(futs):
            try: f.result(); print("ok", futs[f], flush=True)
            except Exception as e: bad.add(futs[f]); print("ERR", futs[f], e, flush=True)
    with cf.ThreadPoolExecutor(8) as ex:
        list(ex.map(lambda j: encode(j[0]), [j for j in jobs if j[0] not in bad]))
    man = {"orders": {o: [x for x in l if x["f"][:-4] not in bad] for o, l in orders.items()},
           "ack": [x for x in ack if x["f"][:-4] not in bad]}
    (OUT / "manifest.json").write_text(json.dumps(man, indent=1, ensure_ascii=False))
    print("failed:", sorted(bad))


if __name__ == "__main__":
    main()
