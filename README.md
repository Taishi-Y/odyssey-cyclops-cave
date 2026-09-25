# ODYSSEY: The Cave of Polyphemus

A browser 3D game (Three.js) based on the Cyclops cave sequence in Christopher Nolan's The Odyssey.

## Run
    cd ~/Projects/odyssey/game
    npm run dev
Open http://127.0.0.1:5188/ (Chrome recommended). Add `?q=low` if it runs slowly, `?q=high` for the best image.

## Controls
- WASD move / Shift run / Ctrl or C crouch / Space jump
- Left click: hold to draw the bow, release to shoot (spear: throw)
- Right click: aim
- 1 bow / 2 spear / E interact (log, harden the stake, blind the giant, tie on straw, pick up arrows)
- Jump (Space) and aim the bow in mid-air: slow motion like Breath of the Wild. Drains the green stamina wheel (sprinting drains it too)
- Tab (hold): GTA-style weapon wheel, time slows while it is open (bow / spear / stones)
- Z: prone (Metal Gear style crawl, almost invisible in the dark)
- F: knock on a nearby wall to lure the giant; stones (3) make noise where they land
- X: GTA V-style switch to another crewman (sky-cam transition)
- Soliton radar (top right) shows the giant's field of view; getting seen triggers "!" and the ALERT / EVASION / CAUTION phases
- Awareness meter (The Last of Us / Assassin's Creed): fills white, orange, red as the giant notices you; crouch next to a straw pile to hide
- Caught? Mash E / Space (tap on phones) to break free (God of War style). Blinding the giant is a timing strike: press E when the rings meet
- Push into a rock face to climb it (Zelda), eat cheese to heal, pick up arrows and stones
- P: photo mode (free camera, depth of field, filters, save PNG)
- Phones vibrate on footsteps, hits and grabs
- V: switch between third-person (default) and first-person camera

## Story
1. Follow the sheep into the cave. The giant returns and seals the entrance with a boulder.
2. Night: he eats your men. If he spots you he grabs you (shoot his eye to stagger him).
3. He sleeps. Harden the olive-wood stake in the fire and drive it into his eye.
4. Tie straw to your back, crouch, and crawl out among the sheep.
5. Outside, he prays to Poseidon. Your surviving men are counted.

Checkpoints: `?phase=night|sleep|blind|gate`

## Assets and licenses
- Rock textures and props: Poly Haven (CC0)
- Human models: generated with MakeHuman / MPFB (CC0 assets)
- Cyclops loincloth: "Basic Loincloth 1" by Elvaerwyn (CC-BY)
- Animations: X Bot (Mixamo) clips from the three.js examples, retargeted
- Cyclops voice: clip from YouTube cTEaP8VxN6o (film audio, personal use only)
- Cave, sheep, fire and other sounds are generated in code
